import { randomBytes } from 'node:crypto';
import type { Actor } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import sharp, { type Metadata as SharpMetadata } from 'sharp';
import { writeAudit } from './audit.js';
import { urls, type Deps } from './deps.js';
import { addOutbox, flushOutbox } from './outbox.js';
import { loadVenueRow } from './projections.js';
import type { ObjectStorage } from './storage.js';

// Logo uploads (TR-SEC-05, NFR-SEC-06) and the QR poster kit (FR-ADM-12).

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PX = 4096;

function sniff(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Magic-byte check, ≤ 2 MB, ≤ 4096 px, re-encoded to PNG and WebP at 512 px, metadata stripped, random key. */
export async function uploadLogo(deps: Deps, storage: ObjectStorage, actor: Actor, tenantId: string, venueId: string, file: Buffer) {
  if (file.length > MAX_BYTES) throw new AppError('UPLOAD_INVALID', 'Logo must be 2 MB or smaller');
  if (!sniff(file)) throw new AppError('UPLOAD_INVALID', 'Use a PNG, JPEG or WebP image');
  let meta: SharpMetadata;
  try {
    meta = await sharp(file, { limitInputPixels: MAX_PX * MAX_PX }).metadata();
  } catch {
    throw new AppError('UPLOAD_INVALID', 'The image could not be read');
  }
  if (!meta.width || !meta.height || meta.width > MAX_PX || meta.height > MAX_PX) throw new AppError('UPLOAD_INVALID', 'Logo must be at most 4096 × 4096 px');
  const resized = sharp(file).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true });
  const [png, webp] = await Promise.all([resized.clone().png({ compressionLevel: 9 }).toBuffer(), resized.clone().webp({ quality: 90 }).toBuffer()]);
  const id = randomBytes(12).toString('hex');
  const base = `tenants/${tenantId}/logos/${id}`;
  await storage.put('assets', `${base}.png`, png, 'image/png');
  await storage.put('assets', `${base}.webp`, webp, 'image/webp');
  const db = deps.db.forTenant(tenantId);
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('venues').set({ logo_key: `${base}.png` }).where('id', '=', venueId).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor, action: 'venue.updated', tenantId, entityType: 'venue', entityId: venueId, after: { logo: true } });
    outboxId = await addOutbox(tx, 'venue.settings_changed', tenantId, { venueId, emit: { logoUrl: urls(deps.config).logo(`${base}.png`) } });
  });
  await flushOutbox(deps, [outboxId]);
  return { logoUrl: urls(deps.config).logo(`${base}.png`) };
}

/** Console: sets the logo of a tenant's first venue, the one the admin dashboard shows. */
export async function uploadTenantLogo(deps: Deps, storage: ObjectStorage, actor: Actor, tenantId: string, file: Buffer) {
  const venue = await deps.db.forTenant(tenantId).selectFrom('venues').select('id').where('status', '=', 'active').orderBy('created_at').executeTakeFirst();
  if (!venue) throw new AppError('NOT_FOUND');
  return uploadLogo(deps, storage, actor, tenantId, venue.id, file);
}

const POSTER_SIZES = {
  a4: { w: 595.28, h: 841.89, qr: 360 },
  tent: { w: 420.94, h: 297.64, qr: 190 }, // A6 landscape, folded tent card
  door: { w: 297.64, h: 420.94, qr: 200 }, // A6 portrait sticker
} as const;

const POSTER_TEXT: Record<string, { title: string; line: string }> = {
  en: { title: 'Scan to see your order', line: 'Your order number and alerts on your phone' },
};

/**
 * Venue QR poster PDF (FR-ADM-12). pdf-lib's standard fonts cannot shape Arabic, so Arabic posters carry the
 * QR and venue code with English text; the admin app also offers a browser-printed version with Arabic text.
 */
export async function posterPdf(deps: Deps, tenantId: string, venueId: string, kind: keyof typeof POSTER_SIZES, locale: string): Promise<Buffer> {
  const row = await deps.db.forTenant(tenantId).selectFrom('venues').selectAll().where('id', '=', venueId).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  const v = loadVenueRow(row);
  const size = POSTER_SIZES[kind];
  const url = urls(deps.config).venue(row.venue_code);
  const qrPng = await QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 1024 });
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${row.name} — QR poster`);
  const page = pdf.addPage([size.w, size.h]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const qr = await pdf.embedPng(qrPng);
  const hex = v.row.brand_color.replace('#', '');
  const brand = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  const text = POSTER_TEXT[locale] ?? POSTER_TEXT.en!;
  page.drawRectangle({ x: 0, y: size.h - 24, width: size.w, height: 24, color: brand });
  const center = (s: string, f: typeof font, sz: number, y: number) => page.drawText(s, { x: (size.w - f.widthOfTextAtSize(s, sz)) / 2, y, size: sz, font: f, color: rgb(0.1, 0.1, 0.1) });
  const latinName = /^[\x20-\x7e]+$/.test(row.name) ? row.name : row.venue_code;
  center(latinName, font, kind === 'a4' ? 28 : 16, size.h - (kind === 'a4' ? 80 : 50));
  page.drawImage(qr, { x: (size.w - size.qr) / 2, y: (size.h - size.qr) / 2 - (kind === 'a4' ? 10 : 6), width: size.qr, height: size.qr });
  center(text.title, font, kind === 'a4' ? 22 : 12, kind === 'a4' ? 140 : 34);
  center(text.line, regular, kind === 'a4' ? 13 : 8, kind === 'a4' ? 115 : 22);
  center(`${url.replace(/^https?:\/\//, '')}`, regular, kind === 'a4' ? 11 : 7, kind === 'a4' ? 60 : 10);
  await deps.kv.set(`t:${tenantId}:posters`, '1');
  return Buffer.from(await pdf.save());
}

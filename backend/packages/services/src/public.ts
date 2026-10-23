import { AppError } from '@dop/contracts';
import { isOpen, tenantAccess } from '@dop/domain';
import { urls, type Deps } from './deps.js';
import { sanitizeLegalHtml } from './sanitize.js';
import type { ObjectStorage } from './storage.js';
import { isEnabled } from './platform.js';
import { branding, loadVenueRow } from './projections.js';
import { getTenantStatus, } from './tenants.js';
import { publicTicketView, ticketByToken } from './tickets.js';

// Customer-facing reads that are not a single ticket (TRD §12.3).

async function venueByCode(deps: Deps, venueCode: string) {
  const row = await deps.db.platform().selectFrom('venues').select(['id', 'tenant_id']).where('venue_code', '=', venueCode.toUpperCase()).where('status', '=', 'active').executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  const status = await getTenantStatus(deps, row.tenant_id);
  if (!status || tenantAccess(status).customer === 'gone') throw new AppError('NOT_FOUND');
  const venue = loadVenueRow(await deps.db.forTenant(row.tenant_id).selectFrom('venues').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow());
  return { venue, tenantId: row.tenant_id, status };
}

/** Venue page (FR-QR-04): branding and messages; the venue QR never creates tickets (BR-13). */
export async function venuePublic(deps: Deps, venueCode: string) {
  const { venue, tenantId, status } = await venueByCode(deps, venueCode);
  return {
    venue: branding(deps.config, venue, { removePoweredBy: await isEnabled(deps, tenantId, 'remove_powered_by') }),
    claimsMode: venue.settings.claims.mode,
    tenantStatus: status,
  };
}

/** Phone's open tickets at this venue (FR-QR-05, EX-17). Tokens come from the phone's own storage. */
export async function myTicketsAtVenue(deps: Deps, venueCode: string, tokens: string[]) {
  const { venue, tenantId } = await venueByCode(deps, venueCode);
  if (tokens.length === 0) return { tickets: [] };
  const rows = await deps.db
    .forTenant(tenantId)
    .selectFrom('tickets')
    .select(['token', 'display_number', 'status'])
    .where('venue_id', '=', venue.row.id)
    .where('token', 'in', tokens)
    .execute();
  return { tickets: rows.filter((r) => isOpen(r.status)).map((r) => ({ token: r.token, displayNumber: r.display_number, status: r.status })) };
}

/** Per-ticket web app manifest (TR-ALR-02). */
export async function ticketManifest(deps: Deps, token: string) {
  const view = await publicTicketView(deps, token);
  const icon = view.venue.logoUrl;
  return {
    name: `${view.venue.name} order ${view.displayNumber}`,
    short_name: `Order ${view.displayNumber}`,
    id: `/${token}`,
    start_url: `/${token}?src=hs`,
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: view.venue.brandColor,
    icons: icon
      ? [
          { src: icon, sizes: '192x192', type: 'image/png' },
          { src: icon, sizes: '512x512', type: 'image/png' },
        ]
      : [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
  };
}

export async function ticketUrlFor(deps: Deps, token: string) {
  await ticketByToken(deps, token);
  return urls(deps.config).ticket(token);
}

type LegalKind = 'terms' | 'privacy' | 'dpa' | 'customer_privacy';

/**
 * The current published version of a kind for a reader's locale (TR-PRV-09, AS04): the latest published version in
 * that locale, else the latest published version in any locale. The legal pages and the acceptance gate use this
 * one rule, so the version shown is the version recorded as accepted.
 */
export async function currentLegalDocument(deps: Deps, kind: LegalKind, locale: string) {
  const base = () =>
    deps.db.platform().selectFrom('legal_documents').selectAll().where('kind', '=', kind).where('status', '=', 'ready').where('published_at', 'is not', null).orderBy('published_at', 'desc').orderBy('id', 'desc');
  return (await base().where('locale', '=', locale).executeTakeFirst()) ?? (await base().executeTakeFirst());
}

/**
 * The current version for the locale, or with `documentId` that exact published version (the gate links to the
 * version it asks the user to accept), with its sanitised HTML inline (W12).
 */
export async function legalDocument(deps: Deps, kind: LegalKind, locale: string, storage?: ObjectStorage | null, documentId?: string) {
  const doc = documentId
    ? await deps.db.platform().selectFrom('legal_documents').selectAll().where('id', '=', documentId).where('kind', '=', kind).where('status', '=', 'ready').where('published_at', 'is not', null).executeTakeFirst()
    : await currentLegalDocument(deps, kind, locale);
  if (!doc) throw new AppError('NOT_FOUND');
  const body = storage ? await storage.get('assets', doc.content_key).catch(() => null) : null;
  return {
    id: doc.id,
    kind: doc.kind,
    version: doc.version,
    locale: doc.locale,
    url: urls(deps.config).logo(doc.content_key),
    publishedAt: doc.published_at?.toISOString() ?? null,
    html: body ? sanitizeLegalHtml(body.toString('utf8')) : null,
  };
}

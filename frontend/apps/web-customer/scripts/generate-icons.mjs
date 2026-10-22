// Generates the platform fallback icons for the customer app (A29): /icon-192.png, /icon-512.png (manifest
// fallback, TR-ALR-02, and favicon) and /badge-72.png (notification badge: white silhouette on transparent).
// Dependency-free PNG encoder (zlib only). Run: node apps/web-customer/scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BRAND = [0x1f, 0x6f, 0xeb];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA pixels → PNG (colour type 6, 8 bits). */
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Bell silhouette in unit coordinates, kept inside the maskable safe zone (radius 0.4). */
function inBell(x, y) {
  const dx = x - 0.5;
  const ax = Math.abs(dx);
  if (Math.hypot(dx, y - 0.215) <= 0.045) return true; // knob
  if (y <= 0.42 && Math.hypot(dx, y - 0.42) <= 0.2) return true; // dome
  if (y >= 0.42 && y <= 0.66 && ax <= 0.2 + ((y - 0.42) / 0.24) * 0.07) return true; // flaring body
  if (y >= 0.645 && y <= 0.705 && (ax <= 0.28 || Math.hypot(ax - 0.28, y - 0.675) <= 0.03)) return true; // rim
  if (Math.hypot(dx, y - 0.755) <= 0.06) return true; // clapper
  return false;
}

function render(size, { background }) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inBell((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)) hit++;
      const a = hit / (ss * ss);
      const i = (y * size + x) * 4;
      if (background) {
        // White bell over the brand colour, fully opaque.
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(BRAND[c] * (1 - a) + 255 * a);
        px[i + 3] = 255;
      } else {
        px[i] = px[i + 1] = px[i + 2] = 255;
        px[i + 3] = Math.round(a * 255);
      }
    }
  }
  return png(size, px);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), render(192, { background: true }));
writeFileSync(join(out, 'icon-512.png'), render(512, { background: true }));
writeFileSync(join(out, 'badge-72.png'), render(72, { background: false }));
console.log('icons written to', out);

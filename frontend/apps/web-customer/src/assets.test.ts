import { expect, it } from 'vitest';

// A29: the icons the manifest fallback (/m/{token}.webmanifest), the favicon and the service worker point at
// exist as real PNG files of the declared size (Vite copies public/ into dist/).
// The app's tsconfig has no Node types, so fs comes from Node's built-in module registry.
interface Fs {
  existsSync(p: URL): boolean;
  readFileSync(p: URL): Uint8Array;
  readFileSync(p: URL, enc: 'utf8'): string;
}
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as Fs;
const pub = (name: string) => new URL(`../public/${name}`, import.meta.url);

function pngSize(file: URL) {
  const b = fs.readFileSync(file);
  expect(Array.from(b.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(String.fromCharCode(...b.subarray(12, 16))).toBe('IHDR');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

it.each([
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['badge-72.png', 72],
] as const)('%s is a %ipx PNG', (name, size) => {
  expect(fs.existsSync(pub(name))).toBe(true);
  expect(pngSize(pub(name))).toEqual({ w: size, h: size });
});

it('the service worker and index.html reference only icons that exist', () => {
  const text = [fs.readFileSync(new URL('./sw.ts', import.meta.url), 'utf8'), fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')].join('\n');
  const refs = text.match(/\/[\w-]+\.png/g) ?? [];
  expect(refs.length).toBeGreaterThan(0);
  for (const r of refs) expect(fs.existsSync(pub(r.slice(1))), r).toBe(true);
});

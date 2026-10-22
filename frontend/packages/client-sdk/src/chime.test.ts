import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHIME_CODES, chimeCode, chimeNotes, clearChimeCache, playVenueChime } from './chime';

// W11: three distinct built-in chimes, unknown codes → classic, uploaded file with cache and classic fallback.

function fakeCtx(decode: () => Promise<unknown> = async () => ({ duration: 1.5 })) {
  const log = { osc: [] as Array<{ type: string; freq: number }>, buffers: 0, stops: [] as number[] };
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const o = { type: 'sine', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      queueMicrotask(() => log.osc.push({ type: o.type, freq: o.frequency.value }));
      return o;
    },
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    createBufferSource() {
      log.buffers++;
      return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: (t: number) => log.stops.push(t) };
    },
    decodeAudioData: vi.fn(decode),
  };
  return { ctx: ctx as unknown as BaseAudioContext, log, decode: ctx.decodeAudioData };
}

beforeEach(() => {
  clearChimeCache();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('maps unknown codes to classic', () => {
  expect(chimeCode('bell')).toBe('bell');
  expect(chimeCode('soft')).toBe('soft');
  expect(chimeCode('default')).toBe('classic');
  expect(chimeCode(null)).toBe('classic');
});

it('the three patterns are audibly different (rhythm, timbre, pitch)', () => {
  const sig = (c: (typeof CHIME_CODES)[number]) => JSON.stringify(chimeNotes(c, 3).map((n) => [n.freq, n.at, n.type, n.attack]));
  const sigs = CHIME_CODES.map(sig);
  expect(new Set(sigs).size).toBe(3);
  expect(chimeNotes('classic', 3)).toHaveLength(6);
  expect(chimeNotes('bell', 3).some((n) => n.type === 'triangle')).toBe(true);
  expect(chimeNotes('soft', 3).every((n) => n.attack > 0.1)).toBe(true);
  for (const c of CHIME_CODES) for (const n of chimeNotes(c, 2)) expect(n.at + n.dur).toBeLessThanOrEqual(2 + 1e-9);
});

it('synthesises the built-in chime and resolves after the requested time', async () => {
  const { ctx, log } = fakeCtx();
  let done = false;
  void playVenueChime(ctx, { chime: 'soft', chimeUrl: null }, 2).then(() => (done = true));
  await vi.advanceTimersByTimeAsync(1_999);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
  expect(log.osc.map((o) => o.freq)).toEqual([523.25, 659.25, 783.99]);
});

it('plays an uploaded file, fetching and decoding it once', async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetchMock);
  const { ctx, log, decode } = fakeCtx();
  const p1 = playVenueChime(ctx, { chime: 'classic', chimeUrl: 'https://cdn/x.mp3' }, 3);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await p1).toBe('file');
  const p2 = playVenueChime(ctx, { chime: 'classic', chimeUrl: 'https://cdn/x.mp3' }, 3);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await p2).toBe('file');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(log.buffers).toBe(2);
  expect(log.stops[0]).toBe(1.5); // never longer than the file or the slot
  expect(log.osc).toHaveLength(0);
});

it('falls back to the synthesised classic chime when the file cannot be fetched or decoded, and retries later', async () => {
  const fetchMock = vi.fn(async () => {
    throw new TypeError('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
  const { ctx, log } = fakeCtx();
  const p = playVenueChime(ctx, { chime: 'bell', chimeUrl: 'https://cdn/y.mp3' }, 3);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await p).toBe('classic');
  expect(log.osc.map((o) => o.freq)).toEqual([880, 660, 880, 660, 988, 784]);

  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9]))));
  const bad = fakeCtx(async () => {
    throw new Error('EncodingError');
  });
  const p2 = playVenueChime(bad.ctx, { chime: 'bell', chimeUrl: 'https://cdn/y.mp3' }, 3);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await p2).toBe('classic');
  expect(bad.decode).toHaveBeenCalledTimes(1); // the failed fetch was not cached
});

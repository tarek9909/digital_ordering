// Venue chimes (W11, FR-ALR-04, TR-ALR-15): three built-in chimes synthesised with Web Audio (no download, work
// offline) and an optional uploaded file (`chimeUrl`). Shared by the customer page and the display; the caller owns
// the AudioContext, which must already be unlocked by a tap.

export type ChimeCode = 'classic' | 'bell' | 'soft';
export const CHIME_CODES: readonly ChimeCode[] = ['classic', 'bell', 'soft'];

/** The venue's chime choice; unknown codes fall back to 'classic'. */
export const chimeCode = (code: string | null | undefined): ChimeCode => (CHIME_CODES.includes(code as ChimeCode) ? (code as ChimeCode) : 'classic');

export interface ChimeSource {
  chime: string;
  chimeUrl?: string | null;
}

export interface ChimeNote {
  /** Hz */
  freq: number;
  /** Start, seconds from the chime start. */
  at: number;
  /** Length in seconds. */
  dur: number;
  type: OscillatorType;
  /** Peak gain 0–1. */
  peak: number;
  /** Attack in seconds (soft chimes swell, struck ones are instant). */
  attack: number;
}

/**
 * The three patterns, scaled to `seconds`. They differ in rhythm, timbre and envelope so staff and customers can tell
 * them apart: classic = fast two-tone sine alternation; bell = two struck triangle-wave strikes with an inharmonic
 * partial and long ring; soft = slow rising major arpeggio with gentle swells.
 */
export function chimeNotes(code: ChimeCode, seconds: number): ChimeNote[] {
  if (code === 'bell') {
    const strikes = [0, seconds / 2];
    return strikes.flatMap((at) => [
      { freq: 1046.5, at, dur: seconds / 2, type: 'triangle' as const, peak: 1, attack: 0.005 },
      { freq: 1046.5 * 2.76, at, dur: seconds / 4, type: 'sine' as const, peak: 0.35, attack: 0.005 },
    ]);
  }
  if (code === 'soft') {
    const freqs = [523.25, 659.25, 783.99];
    const step = seconds / freqs.length;
    return freqs.map((freq, i) => ({ freq, at: i * step, dur: step, type: 'sine' as const, peak: 0.6, attack: Math.min(0.25, step / 3) }));
  }
  const freqs = [880, 660, 880, 660, 988, 784];
  const step = seconds / freqs.length;
  return freqs.map((freq, i) => ({ freq, at: i * step, dur: step, type: 'sine' as const, peak: 1, attack: 0.02 }));
}

/** Schedules a built-in chime on `ctx` now. */
export function scheduleChime(ctx: BaseAudioContext, code: ChimeCode, seconds: number): void {
  const now = ctx.currentTime;
  for (const n of chimeNotes(code, seconds)) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = n.type;
    o.frequency.value = n.freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = now + n.at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(n.peak, t + n.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur * 0.95);
    o.start(t);
    o.stop(t + n.dur);
  }
}

// Uploaded chime files: the bytes are fetched once (they can be prefetched before audio is unlocked) and decoded once.
const bytes = new Map<string, Promise<ArrayBuffer>>();
const decoded = new Map<string, Promise<AudioBuffer>>();

function fetchBytes(url: string): Promise<ArrayBuffer> {
  let p = bytes.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'omit' }).then((r) => {
      if (!r.ok) throw new Error(`chime ${r.status}`);
      return r.arrayBuffer();
    });
    bytes.set(url, p);
    // A failure (offline, CDN error) is not cached, so a later chime tries again.
    p.catch(() => bytes.delete(url));
  }
  return p;
}

/** Starts downloading an uploaded chime so the first alert does not wait for the network. */
export function prefetchChime(url: string | null | undefined): void {
  if (url) fetchBytes(url).catch(() => undefined);
}

export function loadChimeBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let p = decoded.get(url);
  if (!p) {
    // decodeAudioData detaches its input, so decode a copy and keep the fetched bytes intact.
    p = fetchBytes(url).then((b) => ctx.decodeAudioData(b.slice(0)));
    decoded.set(url, p);
    p.catch(() => decoded.delete(url));
  }
  return p;
}

/**
 * Plays the venue's chime for at most `seconds` and resolves when that time has passed. An uploaded file plays when
 * it loads; on any error (offline, CORS, undecodable) the synthesised classic chime plays instead.
 */
export async function playVenueChime(ctx: BaseAudioContext, src: ChimeSource | null | undefined, seconds: number): Promise<'file' | ChimeCode> {
  let played: 'file' | ChimeCode;
  if (src?.chimeUrl) {
    try {
      const buf = await loadChimeBuffer(ctx, src.chimeUrl);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      node.start();
      node.stop(ctx.currentTime + Math.min(seconds, buf.duration));
      played = 'file';
    } catch {
      scheduleChime(ctx, 'classic', seconds);
      played = 'classic';
    }
  } else {
    played = chimeCode(src?.chime);
    scheduleChime(ctx, played, seconds);
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));
  return played;
}

/** Test hook. */
export function clearChimeCache() {
  bytes.clear();
  decoded.clear();
}

import { playVenueChime, type ChimeSource } from '@dop/client-sdk';

// Live page alert (TRD §11.2, §11.4). The AudioContext is unlocked by a user tap. The venue's chime is used (W11):
// a built-in one is synthesised (works offline, no download); an uploaded one plays from its file, falling back to
// the synthesised classic chime. Loop: 3 s chime, 1 s gap, full gain; vibration where supported.

let ctx: AudioContext | null = null;

export function audioState(): 'running' | 'suspended' | 'none' {
  if (!ctx) return 'none';
  return ctx.state === 'running' ? 'running' : 'suspended';
}

/** Must run inside a user gesture (TR-ALR-12). */
export async function unlockAudio(): Promise<boolean> {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new AC();
    await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** The venue's chime, `seconds` long. Returns when finished (at once when audio is locked). */
export async function playChime(seconds = 3, source?: ChimeSource | null): Promise<void> {
  if (!ctx || ctx.state !== 'running') return;
  await playVenueChime(ctx, source, seconds);
}

/** Short test chime for "Did you hear that?", in the venue's sound. */
export const testChime = (source?: ChimeSource | null) => playChime(1.2, source);

export interface AlertLoop {
  stop(): void;
}

/** Plays the alert until stopped or `maxSeconds` pass (FR-ALR-04: 60 s by default). */
export function startAlertLoop(maxSeconds: number, onEnd: () => void, source?: ChimeSource | null): AlertLoop {
  let stopped = false;
  const deadline = Date.now() + maxSeconds * 1000;
  const loop = async () => {
    while (!stopped && Date.now() < deadline) {
      navigator.vibrate?.([400, 200, 400, 200, 800]);
      await playChime(3, source);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!stopped) onEnd();
  };
  void loop();
  return {
    stop() {
      stopped = true;
      navigator.vibrate?.(0);
    },
  };
}

// Screen wake lock, re-requested when the page becomes visible again (TR-ALR-13).
let wakeLock: { release(): Promise<void> } | null = null;
export async function keepAwake() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && document.visibilityState === 'visible') wakeLock = await wl.request('screen');
  } catch {
    /* not supported or denied */
  }
}
export const releaseAwake = () => void wakeLock?.release().catch(() => undefined);

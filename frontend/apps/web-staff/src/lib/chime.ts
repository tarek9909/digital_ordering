// Short synthesised chime for tickets created by a POS (FR-STF-16). No audio file: works offline and adds no
// download. Browsers only allow audio after a tap, so the board shows a one-time "Enable sound" button.

let ctx: AudioContext | null = null;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** Must run inside a tap. Resolves true when audio can play. */
export async function unlockChime(): Promise<boolean> {
  try {
    const AC = audioCtor();
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state !== 'running') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** Two quick rising tones, about 0.5 s. */
export function playChime() {
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime;
  [660, 880].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const t0 = start + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
}

import { playVenueChime, type ChimeSource } from '@dop/client-sdk';

// Audio for the display (TR-ALR-15 – TR-ALR-18): the venue's chime (built-in ones synthesised, an uploaded one played
// from its file with the synthesised classic as fallback, W11) and speechSynthesis with the voice the platform maps
// to each language (`DisplayBoard.voices`). Both are unlocked by one tap.

let ctx: AudioContext | null = null;

/** Fallback when the board's voice list has no entry for a language. */
const TTS_LANG: Record<string, string> = { ar: 'ar-SA', en: 'en-US' };
export type VoiceMap = Record<string, string> | null | undefined;
/** BCP-47 speech tag for a language: the platform's mapping first, then the built-in one, then the code itself. */
export const ttsLang = (lang: string, voices?: VoiceMap) => voices?.[lang] ?? voices?.[lang.split('-')[0]!] ?? TTS_LANG[lang] ?? TTS_LANG[lang.split('-')[0]!] ?? lang;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** Tries to start audio without a gesture (some TV browsers allow it). */
export async function audioAlreadyAllowed(): Promise<boolean> {
  try {
    const AC = audioCtor();
    if (!AC) return false;
    ctx ??= new AC();
    if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** Must run inside a user gesture. Unlocks AudioContext and speechSynthesis. */
export async function unlockSound(): Promise<boolean> {
  try {
    if (typeof speechSynthesis !== 'undefined') {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* speech not available */
  }
  try {
    const AC = audioCtor();
    if (!AC) return false;
    ctx ??= new AC();
    await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** The venue's chime, `seconds` long (2 s on the display). */
export async function playChime(seconds = 2, source?: ChimeSource | null): Promise<void> {
  if (!ctx || ctx.state !== 'running') return;
  await playVenueChime(ctx, source, seconds);
}

export function findVoice(lang: string, voices?: VoiceMap): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const want = ttsLang(lang, voices).replace('_', '-').toLowerCase();
  const base = want.split('-')[0]!;
  const all = speechSynthesis.getVoices();
  const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
  return all.find((v) => norm(v) === want) ?? all.find((v) => norm(v).split('-')[0] === base) ?? null;
}

/** Voices load asynchronously in most browsers. Resolves once they are known (or after `timeoutMs`). */
export function voicesReady(timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined' || speechSynthesis.getVoices().length > 0) return resolve();
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

/** Speaks and resolves on end. A timeout guards against engines that never fire `end`. */
export function speak(text: string, lang: string, voices?: VoiceMap): Promise<void> {
  return new Promise((resolve) => {
    const voice = findVoice(lang, voices);
    if (!voice) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    const timer = setTimeout(resolve, 4_000 + text.length * 150);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

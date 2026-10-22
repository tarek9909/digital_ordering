// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findVoice, speak, ttsLang } from './sound';

// Display voices: the platform's locale → BCP-47 map (DisplayBoard.voices) picks the voice; the built-in mapping is
// the fallback for a locale the map lacks.
const voice = (lang: string, name = lang) => ({ lang, name }) as SpeechSynthesisVoice;
const spoken: SpeechSynthesisUtterance[] = [];

beforeEach(() => {
  spoken.length = 0;
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  });
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [voice('ar-SA'), voice('ar-EG'), voice('en-US'), voice('en-GB'), voice('fr-FR')],
    speak: (u: SpeechSynthesisUtterance) => {
      spoken.push(u);
      u.onend?.(new Event('end') as SpeechSynthesisEvent);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('uses the platform voice tag when the board provides one', () => {
  const voices = { ar: 'ar-EG', en: 'en-GB' };
  expect(ttsLang('ar', voices)).toBe('ar-EG');
  expect(findVoice('ar', voices)?.lang).toBe('ar-EG');
  expect(findVoice('en', voices)?.lang).toBe('en-GB');
});

it('falls back to the built-in mapping for a locale missing from the map', () => {
  expect(ttsLang('ar', { en: 'en-GB' })).toBe('ar-SA');
  expect(ttsLang('ar', undefined)).toBe('ar-SA');
  expect(findVoice('ar', {})?.lang).toBe('ar-SA');
  expect(ttsLang('fr', {})).toBe('fr');
});

it('speaks with the mapped voice', async () => {
  await speak('رقم 12', 'ar', { ar: 'ar-EG' });
  expect(spoken).toHaveLength(1);
  expect(spoken[0]!.voice?.lang).toBe('ar-EG');
  expect(spoken[0]!.lang).toBe('ar-EG');
});

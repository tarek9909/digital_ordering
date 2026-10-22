// @vitest-environment jsdom
import * as React from 'react';
(globalThis as { React?: unknown }).React = React;
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/display.json';
import en from '@dop/i18n/locales/en/display.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDisplay } from './lib/store';
import { BOARD_KEY, useDisplaySocket } from './useDisplayBoard';

// Display announcements: venue chime + platform voices (W11), and no speech when the tenant has no display_speech
// feature (the server then sends announce.languages = []).
const f = vi.hoisted(() => ({ events: {} as Record<string, (...a: unknown[]) => void>, chime: vi.fn(), speak: vi.fn(), findVoice: vi.fn() }));
vi.mock('@dop/client-sdk', async (orig) => ({
  ...(await orig<object>()),
  connectSocket: () => ({ on: (e: string, fn: (...a: unknown[]) => void) => void (f.events[e] = fn), connected: true, emit: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock('./lib/sound', () => ({ findVoice: f.findVoice, playChime: f.chime, speak: f.speak, voicesReady: async () => undefined }));

const venue = { timeZone: 'Asia/Beirut', chime: 'bell', chimeUrl: null };
function setup(languages: string[], voices: Record<string, string> = {}) {
  const qc = new QueryClient();
  qc.setQueryData(BOARD_KEY, {
    ready: [{ id: 't1', displayNumber: '11', status: 'ready', version: 1, seq: 1, counterId: null, readyAt: null }],
    preparing: [],
    counterIds: null,
    venue,
    voices,
    settings: { announce: { enabled: true, languages, quietHours: [] } },
  });
  function Hook() {
    useDisplaySocket(true);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Hook />
    </QueryClientProvider>,
  );
}
const alert = () => f.events['ticket.alert']!({ id: 't1', displayNumber: '11', round: 1, attempt: 1, manual: false });

beforeEach(async () => {
  vi.clearAllMocks();
  f.events = {};
  f.chime.mockResolvedValue(undefined);
  f.speak.mockResolvedValue(undefined);
  f.findVoice.mockReturnValue({ lang: 'x' });
  await initI18n('display', { ar, en }, 'en');
  useDisplay.getState().setSoundEnabled(true);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('without the display_speech feature (languages = []) the display chimes but speaks nothing', async () => {
  setup([]);
  await act(async () => {
    alert();
    await vi.advanceTimersByTimeAsync(3_100);
  });
  expect(f.chime).toHaveBeenCalledOnce();
  expect(f.speak).not.toHaveBeenCalled();
  expect(useDisplay.getState().missingVoices).toEqual([]);
});

it('plays the venue chime and speaks with the board voice map', async () => {
  const voices = { en: 'en-GB' };
  setup(['en'], voices);
  await act(async () => {
    alert();
    await vi.advanceTimersByTimeAsync(3_100);
  });
  expect(f.chime).toHaveBeenCalledWith(2, expect.objectContaining({ chime: 'bell' }));
  expect(f.findVoice).toHaveBeenCalledWith('en', voices);
  expect(f.speak).toHaveBeenCalledWith('Order 11 is ready', 'en', voices);
});

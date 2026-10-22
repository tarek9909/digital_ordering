// @vitest-environment jsdom
import * as React from 'react';
(globalThis as { React?: unknown }).React = React;
import { ApiError } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/display.json';
import en from '@dop/i18n/locales/en/display.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDisplay } from './lib/store';
import { BOARD_KEY, useDisplaySocket } from './useDisplayBoard';

// Release regressions for CSD04 (stale display after a failed snapshot), CSD05 (Ready announcement lost during a
// resync on a counter-filtered display) and CSD06 (refused handshake never retried).
type Fake = { handlers: any; active: boolean; connected: boolean; events: Record<string, (p: unknown) => void>; on: any; emit: any; disconnect: any; connect: any };
const f = vi.hoisted(() => ({ get: vi.fn(), sockets: [] as Fake[], chime: vi.fn(), speak: vi.fn() }));
vi.mock('@dop/client-sdk', async (orig) => ({
  ...(await orig<object>()),
  connectSocket: (_auth: unknown, handlers: unknown) => {
    const s: Fake = { handlers, active: false, connected: true, events: {}, on: (e: string, fn: (p: unknown) => void) => void (s.events[e] = fn), emit: vi.fn(), disconnect: vi.fn(), connect: vi.fn() };
    f.sockets.push(s);
    return s;
  },
}));
vi.mock('./lib/api', async () => {
  const { ApiError: E } = await import('@dop/client-sdk');
  return { api: { get: f.get }, isUnauthenticated: (e: unknown) => e instanceof E && e.status === 401 };
});
vi.mock('./lib/sound', () => ({ findVoice: () => ({}), playChime: f.chime, speak: f.speak, voicesReady: async () => undefined }));

const t = { id: 't1', displayNumber: '11', status: 'ready', version: 1, seq: 1, counterId: 'counter1', readyAt: '2026-10-22T12:00:00Z' };
const board = (ready: unknown[] = []) => ({
  ready,
  preparing: [],
  counterIds: ['counter1'],
  serverTime: '2026-10-22T12:00:00Z',
  csrfToken: 'csrf',
  venue: { timeZone: 'Asia/Beirut' },
  settings: { announce: { enabled: true, languages: ['en'], quietHours: [] } },
});
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  qc.setQueryData(BOARD_KEY, board());
  function Hook() {
    useDisplaySocket(true);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <Hook />
    </QueryClientProvider>,
  );
  return { qc, s: f.sockets[0]! };
}

beforeEach(async () => {
  vi.clearAllMocks();
  f.sockets.length = 0;
  await initI18n('display', { ar, en }, 'en');
  useDisplay.setState({ connected: true, resyncing: false, stale: false, soundEnabled: true, missingVoices: [] });
  f.chime.mockResolvedValue(undefined);
  f.speak.mockResolvedValue(undefined);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('CSD04: a failed resync keeps the display stale and retries with back-off until a snapshot succeeds', async () => {
  f.get.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', null));
  const { s, qc } = setup();
  await act(async () => {
    s.events['resync.required']!({});
    await vi.advanceTimersByTimeAsync(1_500);
  });
  expect(f.get).toHaveBeenCalledTimes(2); // the request and its one immediate retry
  expect(useDisplay.getState().stale).toBe(true);
  // Still failing: further attempts are made, spaced out (bounded back-off), and the stale flag stays.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  const during = f.get.mock.calls.length;
  expect(during).toBeGreaterThan(2);
  expect(during).toBeLessThan(12);
  expect(useDisplay.getState().stale).toBe(true);
  // The last list stays on screen meanwhile (EX-10).
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(0);
  f.get.mockResolvedValue(board([t]));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(1);
  expect(useDisplay.getState().stale).toBe(false);
  // Healthy again: no more polling.
  const after = f.get.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(f.get.mock.calls.length).toBe(after);
});

it('CSD04: the retry waits while offline and runs as soon as the browser is back online', async () => {
  f.get.mockRejectedValue(new ApiError(0, 'NETWORK', null));
  const { s } = setup();
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await act(async () => {
    s.events['resync.required']!({});
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(f.get).toHaveBeenCalledTimes(2);
  onLine.mockReturnValue(true);
  f.get.mockResolvedValue(board([t]));
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(f.get).toHaveBeenCalledTimes(3);
  expect(useDisplay.getState().stale).toBe(false);
  onLine.mockRestore();
});

it('CSD05: a Ready alert that arrives during a snapshot reload is announced against the fresh filtered board', async () => {
  let resolve: (b: unknown) => void = () => undefined;
  f.get.mockImplementation(() => new Promise((r) => (resolve = r)));
  const { s, qc } = setup();
  await act(async () => {
    s.events['resync.required']!({});
  });
  await act(async () => {
    s.events['ticket.updated']!({ ticket: t });
    s.events['ticket.alert']!({ id: 't1', displayNumber: '11', round: 1, attempt: 1 });
    resolve(board([t]));
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(1);
  expect(f.chime).toHaveBeenCalled();
  expect(f.speak).toHaveBeenCalledWith(expect.stringContaining('11'), 'en', undefined);
  expect(useDisplay.getState().highlightId).toBe('t1');
});

it('CSD05: an alert for a ticket another counter owns is still filtered out after the reload', async () => {
  let resolve: (b: unknown) => void = () => undefined;
  f.get.mockImplementation(() => new Promise((r) => (resolve = r)));
  const { s } = setup();
  await act(async () => {
    s.events['resync.required']!({});
  });
  await act(async () => {
    s.events['ticket.alert']!({ id: 'other', displayNumber: '99', round: 1, attempt: 1 });
    resolve(board([t]));
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(f.chime).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});

it('CSD06: a refused display handshake is revalidated over HTTP and retried', async () => {
  f.get.mockResolvedValue(board([t]));
  const { s, qc } = setup();
  await act(async () => {
    s.handlers.onError(new Error('RATE_LIMITED'));
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(useDisplay.getState().connected).toBe(false);
  expect(f.get).toHaveBeenCalled();
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(1);
  expect(s.connect).toHaveBeenCalled();
});

it('CSD06: a display that HTTP reports unpaired (401) stops retrying the socket', async () => {
  f.get.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', null));
  const { s } = setup();
  await act(async () => {
    s.handlers.onError(new Error('UNAUTHENTICATED'));
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(s.connect).not.toHaveBeenCalled();
  expect(f.get).toHaveBeenCalledOnce();
});

import { initI18n } from '@dop/i18n';
import ar from '../../../frontend/packages/i18n/locales/ar/display.json';
import en from '../../../frontend/packages/i18n/locales/en/display.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BOARD_KEY, useDisplaySocket } from '../../../frontend/apps/web-display/src/useDisplayBoard';
import { useDisplay } from '../../../frontend/apps/web-display/src/lib/store';
import { useBoardSocket } from '../../../frontend/apps/web-staff/src/board/boardData';
import { useStaff } from '../../../frontend/apps/web-staff/src/lib/store';
const f = vi.hoisted(() => ({ get: vi.fn(), sockets: [] as any[], chime: vi.fn(), speak: vi.fn() }));
vi.mock('@dop/client-sdk', async (orig) => ({ ...(await orig<object>()), connectSocket: (_auth: unknown, handlers: any) => {
  const s = { handlers, active: false, connected: true, events: {} as any, on: (e: string, fn: any) => { s.events[e] = fn; }, emit: vi.fn(), disconnect: vi.fn(), connect: vi.fn() };
  f.sockets.push(s);
  return s;
} }));
vi.mock('../../../frontend/apps/web-display/src/lib/api', () => ({ api: { get: f.get }, isUnauthenticated: () => false }));
vi.mock('../../../frontend/apps/web-staff/src/lib/api', () => ({ api: { get: f.get }, isApiError: () => false, venueId: null, vq: (s: string) => s }));
vi.mock('../../../frontend/apps/web-display/src/lib/sound', () => ({ findVoice: () => ({}), playChime: f.chime, speak: f.speak, voicesReady: async () => undefined }));
const t = { id: 't1', displayNumber: '11', status: 'ready', version: 1, seq: 1, counterId: 'counter1', readyAt: '2026-10-22T12:00:00Z' };
const board = () => ({ ready: [], preparing: [], counterIds: ['counter1'], serverTime: '2026-10-22T12:00:00Z', csrfToken: 'csrf', venue: { timeZone: 'Asia/Beirut' }, settings: { announce: { enabled: true, languages: ['en'], quietHours: [] } } });
function setupDisplay() {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  qc.setQueryData(BOARD_KEY, board());
  function Hook() { useDisplaySocket(true); return null; }
  render(<QueryClientProvider client={qc}><Hook /></QueryClientProvider>);
  return { qc, s: f.sockets[0] };
}
beforeEach(async () => {
  vi.clearAllMocks(); f.sockets.length = 0;
  await initI18n('display', { ar, en }, 'en');
  useDisplay.setState({ connected: true, resyncing: false, soundEnabled: true, missingVoices: [] });
  useStaff.setState({ socketUp: true, needsReload: false, signedOut: false });
  f.chime.mockResolvedValue(undefined); f.speak.mockResolvedValue(undefined);
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('reproduces a display remaining stale after transient resync failure with an established socket', async () => {
  f.get.mockRejectedValue(new Error('temporary HTTP 500'));
  const { s } = setupDisplay();
  await act(async () => { s.events['resync.required']({}); await vi.advanceTimersByTimeAsync(2500); });
  expect(f.get).toHaveBeenCalledTimes(2);
  f.get.mockResolvedValue({ ...board(), ready: [t] });
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(f.get).toHaveBeenCalledTimes(2);
  expect(useDisplay.getState()).toMatchObject({ connected: true, resyncing: false });
});
it('reproduces loss of the new Ready announcement while a filtered display snapshot reloads', async () => {
  let resolve: (b: unknown) => void = () => undefined;
  f.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { s, qc } = setupDisplay();
  await act(async () => { s.events['resync.required']({}); });
  await act(async () => {
    s.events['ticket.updated']({ ticket: t });
    s.events['ticket.alert']({ id: 't1', displayNumber: '11', round: 1, attempt: 1 });
    resolve({ ...board(), ready: [t] });
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(1);
  expect(f.chime).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});
it('reproduces a staff board that never retries a refused socket handshake', async () => {
  const qc = new QueryClient();
  function Hook() { useBoardSocket(true); return null; }
  render(<QueryClientProvider client={qc}><Hook /></QueryClientProvider>);
  const s = f.sockets[0];
  await act(async () => { s.handlers.onError(new Error('temporary auth dependency failure')); await vi.advanceTimersByTimeAsync(120_000); });
  expect(useStaff.getState()).toMatchObject({ socketUp: false, needsReload: true });
  expect(s.connect).not.toHaveBeenCalled();
  expect(f.get).not.toHaveBeenCalled();
});

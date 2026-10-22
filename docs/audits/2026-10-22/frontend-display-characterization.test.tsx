import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '@dop/i18n';
import ar from '../../../frontend/packages/i18n/locales/ar/display.json';
import en from '../../../frontend/packages/i18n/locales/en/display.json';
import { BOARD_KEY, useDisplaySocket } from '../../../frontend/apps/web-display/src/useDisplayBoard';
import { useDisplay } from '../../../frontend/apps/web-display/src/lib/store';
const f = vi.hoisted(() => ({ events: {} as Record<string, (...args: any[]) => void>, chime: vi.fn(), speak: vi.fn() }));
vi.mock('../../../frontend/packages/client-sdk/src/index', async (original) => {
  const actual = await original<any>();
  return { ...actual, connectSocket: () => ({ on: (event: string, fn: (...args: any[]) => void) => { f.events[event] = fn; }, connected: true, emit: vi.fn(), disconnect: vi.fn() }) };
});
vi.mock('../../../frontend/apps/web-display/src/lib/sound', () => ({ findVoice: () => ({ lang: 'en-US' }), playChime: f.chime, speak: f.speak, voicesReady: async () => undefined }));
function Hook() { useDisplaySocket(true); return null; }
function ticket(status = 'ready', id = 'food-ticket', counterId = 'food') { return { id, displayNumber: id === 'food-ticket' ? '11' : '22', status, version: 1, seq: 1, counterId, readyAt: new Date().toISOString() }; }
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(BOARD_KEY, { ready: [ticket()], preparing: [], counterIds: ['food'], venue: { timeZone: 'Asia/Beirut' }, settings: { announce: { enabled: true, languages: ['en'], quietHours: [] } } });
  render(<QueryClientProvider client={qc}><Hook /></QueryClientProvider>);
  return qc;
}
beforeEach(async () => { vi.clearAllMocks(); f.events = {}; f.chime.mockResolvedValue(undefined); f.speak.mockResolvedValue(undefined); await initI18n('display', { ar, en }, 'en'); useDisplay.getState().setSoundEnabled(true); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
// A27 (REPORT.md): asserts the corrected behaviour; fails on the code the audit characterised.
// The hook's seq tracker is module state, so each Undo event uses a fresh, higher seq.
let lastSeq = 1;
const nextSeq = () => ++lastSeq;
it('A27: Ready then Undo within the merge window cancels the pending announcement', async () => {
  const qc = setup();
  await act(async () => { f.events['ticket.alert']!({ id: 'food-ticket', displayNumber: '11', round: 1, attempt: 1, manual: false }); f.events['ticket.updated']!({ ticket: { ...ticket('preparing'), seq: nextSeq() }, reason: 'undo' }); });
  expect(qc.getQueryData<any>(BOARD_KEY).ready).toHaveLength(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(f.chime).not.toHaveBeenCalled();
  expect(f.speak).not.toHaveBeenCalled();
});
it('A27: only the ticket that left Ready is dropped from a merged announcement', async () => {
  const qc = setup();
  qc.setQueryData<any>(BOARD_KEY, (b: any) => ({ ...b, ready: [...b.ready, ticket('ready', 'other-ticket')] }));
  await act(async () => {
    f.events['ticket.alert']!({ id: 'food-ticket', displayNumber: '11', round: 1, attempt: 1, manual: false });
    f.events['ticket.alert']!({ id: 'other-ticket', displayNumber: '22', round: 1, attempt: 1, manual: false });
    f.events['ticket.updated']!({ ticket: { ...ticket('preparing'), seq: nextSeq() }, reason: 'undo' });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(f.chime).toHaveBeenCalledOnce();
  expect(f.speak).toHaveBeenCalledWith('Order 22 is ready', 'en', undefined);
  expect(f.speak).not.toHaveBeenCalledWith(expect.stringContaining('11'), 'en');
});
it('A27: a ticket still Ready is announced after the merge window', async () => {
  setup();
  await act(async () => { f.events['ticket.alert']!({ id: 'food-ticket', displayNumber: '11', round: 1, attempt: 1, manual: false }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(f.chime).toHaveBeenCalledOnce();
  expect(f.speak).toHaveBeenCalledWith('Order 11 is ready', 'en', undefined);
});
it('counter filtering works: unrelated counter ticket events never enter the list or speech queue', async () => {
  const qc = setup();
  await act(async () => { f.events['ticket.updated']!({ ticket: ticket('ready', 'drinks-ticket', 'drinks') }); f.events['ticket.alert']!({ id: 'drinks-ticket', displayNumber: '22', round: 1, attempt: 1, manual: false }); await vi.advanceTimersByTimeAsync(3001); });
  expect(qc.getQueryData<any>(BOARD_KEY).ready.map((t: any) => t.id)).toEqual(['food-ticket']);
  expect(f.speak).not.toHaveBeenCalled();
});

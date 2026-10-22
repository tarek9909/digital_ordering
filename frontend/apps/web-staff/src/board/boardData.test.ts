import type { StaffTicket } from '@dop/contracts';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pruneRecent, type Board } from '../lib/ticketState';
import { BOARD_KEY, closedSeenAt, putTicket } from './boardData';

// W16: a live closure is stamped when the board sees it, so Recent drops it 30 minutes later like a reload would.
const T0 = Date.parse('2026-10-22T12:00:00Z');
const t = (over: Partial<StaffTicket>): StaffTicket =>
  ({ id: 'c1', token: 'tok', displayNumber: '5', number: 5, status: 'cancelled', version: 2, seq: 2, counterId: null, note: null, externalRef: null, waitMinutes: null, waitBaseAt: null, alertLevel: 'none', acknowledgedAt: null, checkCode: 'A', claimCode: 'B', readyRound: 0, autoAlertsSent: 0, manualAlertsSent: 0, source: 'staff', createdAt: new Date(T0 - 600_000).toISOString(), readyAt: null, collectedAt: null, closedAt: null, businessDate: '2026-10-22', cancelReason: null, lastChangedBy: null, ...over }) as StaffTicket;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

it('stamps live closures and clears the stamp when the ticket reopens', () => {
  const qc = new QueryClient();
  qc.setQueryData<Partial<Board>>(BOARD_KEY, { open: [t({ status: 'preparing', seq: 1 })], recent: [] });
  putTicket(qc, t({}));
  expect(closedSeenAt('c1')).toBe(T0);
  const board = qc.getQueryData<Board>(BOARD_KEY)!;
  expect(pruneRecent(board.recent, T0 + 30 * 60_000, closedSeenAt)).toHaveLength(1);
  expect(pruneRecent(board.recent, T0 + 30 * 60_000 + 1, closedSeenAt)).toHaveLength(0);
  putTicket(qc, t({ status: 'preparing', seq: 3 }));
  expect(closedSeenAt('c1')).toBeUndefined();
});

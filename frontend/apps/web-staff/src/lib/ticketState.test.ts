import type { StaffTicket } from '@dop/contracts';
import { describe, expect, it } from 'vitest';
import { applyTicket, canReopen, cardFlags, countTickets, pruneRecent, RECENT_WINDOW_MS, resetTimeOf, showReceivedColumn, ticketBusinessDate, ticketUrl, toColumns } from './ticketState';

const T0 = Date.parse('2026-10-22T12:00:00Z');
const iso = (msFromT0: number) => new Date(T0 + msFromT0).toISOString();

function ticket(over: Partial<StaffTicket> = {}): StaffTicket {
  return {
    id: 'id-1',
    token: 'tok',
    displayNumber: '12',
    number: 12,
    status: 'preparing',
    version: 1,
    seq: 1,
    counterId: null,
    note: null,
    externalRef: null,
    waitMinutes: null,
    waitBaseAt: null,
    alertLevel: 'none',
    acknowledgedAt: null,
    checkCode: 'ABCD',
    claimCode: 'WXYZ',
    readyRound: 0,
    autoAlertsSent: 0,
    manualAlertsSent: 0,
    source: 'staff',
    createdAt: iso(0),
    readyAt: null,
    collectedAt: null,
    closedAt: null,
    businessDate: '2026-10-22',
    cancelReason: null,
    lastChangedBy: null,
    ...over,
  };
}

describe('cardFlags', () => {
  it('computes age in whole minutes', () => {
    expect(cardFlags(ticket(), T0 + 7.9 * 60_000).ageMinutes).toBe(7);
  });

  it('marks a preparing ticket late after waitBaseAt + waitMinutes', () => {
    const t = ticket({ waitMinutes: 10, waitBaseAt: iso(0) });
    expect(cardFlags(t, T0 + 9 * 60_000).late).toBe(false);
    expect(cardFlags(t, T0 + 11 * 60_000).late).toBe(true);
    expect(cardFlags({ ...t, status: 'ready' }, T0 + 11 * 60_000).late).toBe(false);
  });

  it('shows "call out" only for the current ready round and while not acknowledged', () => {
    const t = ticket({ status: 'ready', readyRound: 2, readyAt: iso(0) });
    expect(cardFlags(t, T0).callOut).toBe(false);
    expect(cardFlags(t, T0, 1).callOut).toBe(false);
    expect(cardFlags(t, T0, 2).callOut).toBe(true);
    expect(cardFlags({ ...t, acknowledgedAt: iso(1000) }, T0, 2).callOut).toBe(false);
  });

  it('flags acknowledged ready tickets as "Coming"', () => {
    expect(cardFlags(ticket({ status: 'ready', acknowledgedAt: iso(0) }), T0).acknowledged).toBe(true);
  });
});

describe('board updates', () => {
  it('moves collected tickets to recent and back when reopened', () => {
    const b0 = { open: [ticket()], recent: [] as StaffTicket[] };
    const b1 = applyTicket(b0, ticket({ status: 'collected', collectedAt: iso(0), version: 3 }));
    expect(b1.open).toHaveLength(0);
    expect(b1.recent[0]?.status).toBe('collected');
    const b2 = applyTicket(b1, ticket({ status: 'ready', version: 4 }));
    expect(b2.open[0]?.version).toBe(4);
    expect(b2.recent).toHaveLength(0);
  });

  it('puts received tickets in Preparing unless the Received column is on', () => {
    const open = [ticket({ id: 'a', status: 'received' }), ticket({ id: 'b' }), ticket({ id: 'c', status: 'ready', readyAt: iso(0) })];
    expect(toColumns(open, false).preparing.map((t) => t.id)).toEqual(['a', 'b']);
    expect(toColumns(open, true).received.map((t) => t.id)).toEqual(['a']);
    expect(countTickets({ open, recent: [] }, true)).toEqual({ received: 1, preparing: 1, ready: 1, collected: 0, collectedScope: 'recent' });
  });

  it('allows reopening only within 30 minutes of collection', () => {
    const t = ticket({ status: 'collected', collectedAt: iso(0) });
    expect(canReopen(t, T0 + 29 * 60_000)).toBe(true);
    expect(canReopen(t, T0 + 31 * 60_000)).toBe(false);
  });
});

describe('helpers', () => {
  it('reads showReceivedColumn from untyped settings', () => {
    expect(showReceivedColumn({ ticketFlow: { showReceivedColumn: true } })).toBe(true);
    expect(showReceivedColumn(null)).toBe(false);
    expect(showReceivedColumn({ ticketFlow: 'x' })).toBe(false);
  });

  it('builds the ticket URL from the venue URL origin', () => {
    expect(ticketUrl('https://t.example.com/v/ABC123', 'tok22')).toBe('https://t.example.com/tok22');
  });
});

// W16 (FR-STF-01, FR-STF-05): live closures age out of Recent and its count exactly like the server's window.
describe('pruneRecent', () => {
  const MIN = 60_000;
  it('drops collected tickets 30 minutes after collection, using collectedAt', () => {
    const a = ticket({ id: 'a', status: 'collected', collectedAt: iso(0) });
    const b = ticket({ id: 'b', status: 'collected', collectedAt: iso(10 * MIN) });
    const seen = () => undefined;
    expect(pruneRecent([b, a], T0 + RECENT_WINDOW_MS, seen).map((t) => t.id)).toEqual(['b', 'a']);
    expect(pruneRecent([b, a], T0 + RECENT_WINDOW_MS + 1, seen).map((t) => t.id)).toEqual(['b']);
    expect(pruneRecent([b, a], T0 + 41 * MIN, seen)).toEqual([]);
  });

  it('ages cancelled/expired tickets from when the board saw them close', () => {
    const c = ticket({ id: 'c', status: 'cancelled' });
    const seen = (id: string) => (id === 'c' ? T0 + 5 * MIN : undefined);
    expect(pruneRecent([c], T0 + 35 * MIN, seen)).toHaveLength(1);
    expect(pruneRecent([c], T0 + 35 * MIN + 1, seen)).toHaveLength(0);
  });

  it('a live board and a reloaded board report the same "collected" count', () => {
    // Live: ticket x was collected 40 min ago and appended to Recent; the reload's 30-minute window excludes it.
    let live = { open: [] as StaffTicket[], recent: [] as StaffTicket[] };
    live = applyTicket(live, ticket({ id: 'x', status: 'collected', collectedAt: iso(0) }));
    live = applyTicket(live, ticket({ id: 'y', status: 'collected', collectedAt: iso(20 * MIN) }));
    const now = T0 + 40 * MIN;
    const pruned = { open: live.open, recent: pruneRecent(live.recent, now, () => undefined) };
    const reloaded = { open: [], recent: [ticket({ id: 'y', status: 'collected', collectedAt: iso(20 * MIN) })] };
    expect(countTickets(pruned, false).collected).toBe(1);
    expect(countTickets(pruned, false).collected).toBe(countTickets(reloaded, false).collected);
  });
});

describe('closedAt ageing', () => {
  it('ages Recent from the server closedAt when present (cancelled tickets included)', () => {
    const c = ticket({ id: 'c', status: 'cancelled', closedAt: iso(0) });
    const seen = () => T0 + 20 * 60_000; // a later local stamp must not extend the window
    expect(pruneRecent([c], T0 + RECENT_WINDOW_MS, seen)).toHaveLength(1);
    expect(pruneRecent([c], T0 + RECENT_WINDOW_MS + 1, seen)).toHaveLength(0);
  });
});

// FR-STF-01: "Collected today" is the server's business-date total, kept live.
describe('collectedToday', () => {
  const venue = { timeZone: 'Asia/Riyadh', settings: {} }; // T0 = 15:00 local, after the 04:00 reset
  const board = (n: number, over: Partial<StaffTicket> = {}) => ({
    open: [ticket({ id: 'a', status: 'ready', ...over })],
    recent: [] as StaffTicket[],
    collectedToday: n,
    businessDate: '2026-10-22',
    venue,
  });

  it('computes the business date like the server (before the reset time belongs to the previous day)', () => {
    expect(ticketBusinessDate('2026-10-22T12:00:00Z', 'Asia/Riyadh')).toBe('2026-10-22');
    expect(ticketBusinessDate('2026-10-22T00:30:00Z', 'Asia/Riyadh')).toBe('2026-10-21'); // 03:30 local
    expect(ticketBusinessDate('2026-10-22T00:30:00Z', 'Asia/Riyadh', '03:00')).toBe('2026-10-22');
    expect(resetTimeOf({ resetTime: '05:30' })).toBe('05:30');
    expect(resetTimeOf({})).toBe('04:00');
  });

  it('counts a collection of today and uncounts it on reopen', () => {
    const b1 = applyTicket(board(4), ticket({ id: 'a', status: 'collected', collectedAt: iso(0), closedAt: iso(0) }));
    expect(b1.collectedToday).toBe(5);
    expect(countTickets(b1, false)).toMatchObject({ collected: 5, collectedScope: 'today' });
    const b2 = applyTicket(b1, ticket({ id: 'a', status: 'ready' }));
    expect(b2.collectedToday).toBe(4);
    // A repeated collected event does not double count.
    const b3 = applyTicket(applyTicket(b2, ticket({ id: 'a', status: 'collected' })), ticket({ id: 'a', status: 'collected', seq: 9 }));
    expect(b3.collectedToday).toBe(5);
  });

  it('ignores tickets of another business date and boards without the field', () => {
    const old = board(4, { businessDate: '2026-10-21' });
    expect(applyTicket(old, ticket({ id: 'a', status: 'collected', businessDate: '2026-10-21' })).collectedToday).toBe(4);
    // The server's businessDate wins over the creation time, e.g. for a ticket created just before the reset time.
    expect(applyTicket(board(4), ticket({ id: 'a', status: 'collected', createdAt: '2026-10-21T12:00:00Z', businessDate: '2026-10-22' })).collectedToday).toBe(5);
    // An older API without businessDate falls back to the creation time.
    expect(applyTicket(board(4, { businessDate: '' }), ticket({ id: 'a', status: 'collected', createdAt: '2026-10-21T12:00:00Z', businessDate: '' })).collectedToday).toBe(4);
    const legacy = applyTicket({ open: [ticket({ id: 'a', status: 'ready' })], recent: [] as StaffTicket[] }, ticket({ id: 'a', status: 'collected' }));
    expect('collectedToday' in legacy).toBe(false);
    expect(countTickets(legacy, false)).toMatchObject({ collected: 1, collectedScope: 'recent' });
  });
});

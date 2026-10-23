import type { StaffTicket } from '@dop/contracts';
import { expect, it } from 'vitest';
import { cardFlags } from './ticketState';

// CSD07: a fresh or reloaded board restores "Not collected — call out" from the snapshot's server flag, without
// a prior live `ticket.overdue` event; the event still accelerates it on an open board.
const readyAt = Date.parse('2026-10-22T12:00:00Z');
const ticket = (over: Partial<StaffTicket> = {}) =>
  ({
    status: 'ready',
    readyAt: new Date(readyAt).toISOString(),
    createdAt: new Date(readyAt).toISOString(),
    readyRound: 1,
    autoAlertsSent: 3,
    acknowledgedAt: null,
    overdueRound: null,
    waitBaseAt: null,
    waitMinutes: null,
    ...over,
  }) as StaffTicket;
const hourLater = readyAt + 60 * 60_000;

it('CSD07: a snapshot flagged for the current round is call-out red with no live event', () => {
  expect(cardFlags(ticket({ overdueRound: 1 }), hourLater).callOut).toBe(true);
});

it('CSD07: the live event still marks an open board before the next projection', () => {
  expect(cardFlags(ticket(), hourLater, 1).callOut).toBe(true);
  expect(cardFlags(ticket(), hourLater).callOut).toBe(false);
});

it('CSD07: a flag from an earlier round, an acknowledgement or leaving Ready clears the call-out', () => {
  expect(cardFlags(ticket({ overdueRound: 1, readyRound: 2 }), hourLater).callOut).toBe(false);
  expect(cardFlags(ticket({ overdueRound: 1, acknowledgedAt: new Date(hourLater).toISOString() }), hourLater).callOut).toBe(false);
  expect(cardFlags(ticket({ overdueRound: 1, status: 'collected' }), hourLater).callOut).toBe(false);
});

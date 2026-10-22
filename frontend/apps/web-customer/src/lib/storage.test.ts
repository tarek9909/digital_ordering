// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closedAtOf, forgetTicket, markClosed, rememberTicket, storedTickets } from './storage';

// W15 / TR-FE-09: closed tickets leave the phone 24 h after they were seen closed; nothing lingers forever.
const T0 = Date.parse('2026-10-22T12:00:00Z');
const A = 'AAAAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBBBB';
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

it('prunes a closed ticket 24 h after it was marked closed', () => {
  rememberTicket(A, 'V1');
  markClosed(A);
  expect(closedAtOf(A)).toBe(T0);
  vi.setSystemTime(T0 + 23 * 3600_000);
  expect(storedTickets().map((t) => t.token)).toEqual([A]);
  vi.setSystemTime(T0 + 24 * 3600_000);
  expect(storedTickets()).toEqual([]);
});

it('prunes an entry never seen closed after 48 h (the nightly auto-close has closed it by then)', () => {
  rememberTicket(A, 'V1');
  vi.setSystemTime(T0 + 47 * 3600_000);
  rememberTicket(B, 'V1');
  expect(storedTickets().map((t) => t.token)).toEqual([A, B]);
  vi.setSystemTime(T0 + 48 * 3600_000);
  expect(storedTickets().map((t) => t.token)).toEqual([B]);
});

it('forgets a ticket the server no longer knows', () => {
  rememberTicket(A, 'V1');
  rememberTicket(B, 'V1');
  forgetTicket(A);
  expect(storedTickets().map((t) => t.token)).toEqual([B]);
});

it('a reopened ticket clears its closed time when remembered again', () => {
  rememberTicket(A, 'V1');
  markClosed(A);
  rememberTicket(A, 'V1');
  expect(closedAtOf(A)).toBeUndefined();
});

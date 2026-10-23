import type { StaffBoard, StaffTicket, TicketStatus } from '@dop/contracts';

// Pure board logic (no React, no I/O) so it can be unit-tested.

export type Board = StaffBoard & { csrfToken: string; venueUrl: string };

export const REOPEN_WINDOW_MS = 30 * 60_000;
const OPEN: readonly TicketStatus[] = ['received', 'preparing', 'ready'];

export const isOpenStatus = (s: TicketStatus) => OPEN.includes(s);

/** Board fields that keep "Collected today" live; absent on an older API, in which case nothing is counted here. */
export interface TodayCount {
  collectedToday?: number;
  businessDate?: string;
  venue?: { timeZone: string; settings?: unknown };
}

/**
 * Replace a ticket by id, moving it between the open list and the recent list as its status requires, and keep
 * `collectedToday` in step: +1 when a ticket of the board's business date becomes Collected, −1 when it is
 * reopened (FR-STF-01). A snapshot reload replaces the number with the server's.
 */
export function applyTicket<B extends Pick<StaffBoard, 'open' | 'recent'> & TodayCount>(board: B, t: StaffTicket): B {
  const prev = findTicket(board, t.id);
  const open = board.open.filter((x) => x.id !== t.id);
  const recent = board.recent.filter((x) => x.id !== t.id);
  if (isOpenStatus(t.status)) open.push(t);
  else recent.unshift(t);
  const next = { ...board, open, recent };
  if (typeof board.collectedToday === 'number' && board.businessDate && board.venue) {
    const today = (x: StaffTicket) => businessDateOf(x, board.venue!) === board.businessDate;
    const was = prev?.status === 'collected' && today(prev) ? 1 : 0;
    const now = t.status === 'collected' && today(t) ? 1 : 0;
    if (now !== was) next.collectedToday = Math.max(0, board.collectedToday + now - was);
  }
  return next;
}

/** Venue-local date and HH:MM of an instant. */
function zoned(iso: string, timeZone: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * Fallback only (an API without `StaffTicket.businessDate`): the venue-local date of creation, minus one day before
 * the reset time (§9.1), with the reset time from the venue settings when present, else the platform default 04:00.
 */
export function ticketBusinessDate(createdAt: string, timeZone: string, resetTime = DEFAULT_RESET_TIME): string {
  try {
    const { date, time } = zoned(createdAt, timeZone);
    if (time >= resetTime) return date;
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/** The ticket's business date from the server; an older API without it falls back to `ticketBusinessDate`. */
export function businessDateOf(t: StaffTicket, venue: { timeZone: string; settings?: unknown }): string {
  return t.businessDate || ticketBusinessDate(t.createdAt, venue.timeZone, resetTimeOf(venue.settings));
}

export const DEFAULT_RESET_TIME = '04:00';
export function resetTimeOf(settings: unknown): string {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).resetTime : undefined;
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : DEFAULT_RESET_TIME;
}

/** Finds a ticket anywhere on the board. */
export const findTicket = (board: Pick<StaffBoard, 'open' | 'recent'> | undefined, id: string) =>
  board?.open.find((t) => t.id === id) ?? board?.recent.find((t) => t.id === id);

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export interface Columns {
  received: StaffTicket[];
  preparing: StaffTicket[];
  ready: StaffTicket[];
}

/** Oldest first (FR-STF-01). Without a Received column, received tickets sit with Preparing. */
export function toColumns(open: StaffTicket[], showReceived: boolean): Columns {
  const byCreated = (a: StaffTicket, b: StaffTicket) => time(a.createdAt) - time(b.createdAt);
  const byReady = (a: StaffTicket, b: StaffTicket) => time(a.readyAt ?? a.createdAt) - time(b.readyAt ?? b.createdAt);
  return {
    received: showReceived ? open.filter((t) => t.status === 'received').sort(byCreated) : [],
    preparing: open.filter((t) => t.status === 'preparing' || (!showReceived && t.status === 'received')).sort(byCreated),
    ready: open.filter((t) => t.status === 'ready').sort(byReady),
  };
}

export interface CardFlags {
  ageMinutes: number;
  /** Past the wait estimate (amber, "Taking longer"). */
  late: boolean;
  /** Ready and past the last automatic alert + 60 s (red, "Call out"). */
  callOut: boolean;
  acknowledged: boolean;
}

/**
 * `overdueRound` is the round of the last live `ticket.overdue` event for this ticket, if any. The snapshot's own
 * `t.overdueRound` (the server's persisted flag) is authoritative, so a fresh or reloaded board shows the call-out
 * too; the live event only makes an open board show it before the next projection arrives (CSD07).
 */
export function cardFlags(t: StaffTicket, nowMs: number, overdueRound?: number): CardFlags {
  const ageMinutes = Math.max(0, Math.floor((nowMs - time(t.createdAt)) / 60_000));
  const late =
    (t.status === 'received' || t.status === 'preparing') &&
    t.waitBaseAt !== null &&
    t.waitMinutes !== null &&
    nowMs > time(t.waitBaseAt) + t.waitMinutes * 60_000;
  const flagged = (t.overdueRound !== null && t.overdueRound !== undefined && t.overdueRound === t.readyRound) || overdueRound === t.readyRound;
  const callOut = t.status === 'ready' && flagged && !t.acknowledgedAt;
  return { ageMinutes, late, callOut, acknowledged: t.status === 'ready' && t.acknowledgedAt !== null };
}

/** Collected tickets can be reopened within 30 minutes (BR-22). */
export const canReopen = (t: StaffTicket, nowMs: number) =>
  t.status === 'collected' && t.collectedAt !== null && nowMs - time(t.collectedAt) <= REOPEN_WINDOW_MS;

/** The ticket page lives on the same host as the venue page: `{origin}/{token}`. */
export function ticketUrl(venueUrl: string, token: string): string {
  try {
    return `${new URL(venueUrl).origin}/${token}`;
  } catch {
    return token;
  }
}

export interface Counts {
  received: number;
  preparing: number;
  ready: number;
  collected: number;
  /** 'today' when the server's business-date total is available, else the Recent (30 min) count. */
  collectedScope: 'today' | 'recent';
}

export function countTickets(board: Pick<StaffBoard, 'open' | 'recent'> & { collectedToday?: number }, showReceived: boolean): Counts {
  const c = toColumns(board.open, showReceived);
  const today = typeof board.collectedToday === 'number';
  return {
    received: c.received.length,
    preparing: c.preparing.length,
    ready: c.ready.length,
    collected: today ? board.collectedToday! : board.recent.filter((t) => t.status === 'collected').length,
    collectedScope: today ? 'today' : 'recent',
  };
}

/** Reads `ticketFlow.showReceivedColumn` from the untyped venue settings blob. */
export function showReceivedColumn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const flow = (settings as Record<string, unknown>).ticketFlow;
  if (!flow || typeof flow !== 'object') return false;
  return (flow as Record<string, unknown>).showReceivedColumn === true;
}

export const BLOCKED_TENANT = ['trial_expired', 'cancelled', 'deleted'] as const;
export const isTenantBlocked = (s: string) => (BLOCKED_TENANT as readonly string[]).includes(s);

/** Reads `a.b` from the untyped venue settings blob. */
function settingAt(settings: unknown, group: string, key?: string): unknown {
  if (!settings || typeof settings !== 'object') return undefined;
  const g = (settings as Record<string, unknown>)[group];
  if (key === undefined) return g;
  return g && typeof g === 'object' ? (g as Record<string, unknown>)[key] : undefined;
}

/** `checkCode` setting (FR-TKT-06); defaults to off. */
export function checkCodeMode(settings: unknown): 'off' | 'optional' | 'mandatory' {
  const v = settingAt(settings, 'checkCode');
  return v === 'optional' || v === 'mandatory' ? v : 'off';
}

/** `claims.mode` (FR-TKT-07, FR-STF-15); defaults to 'code'. */
export function claimsMode(settings: unknown): 'off' | 'code' | 'staff_approval' {
  const v = settingAt(settings, 'claims', 'mode');
  return v === 'off' || v === 'staff_approval' ? v : 'code';
}

/** `staff.soundOnApiTicket` (FR-STF-16); defaults to false. */
export const soundOnApiTicket = (settings: unknown) => settingAt(settings, 'staff', 'soundOnApiTicket') === true;

/** A ticket made by a POS or connector, not on this board (FR-STF-16). */
export const isPosTicket = (t: Pick<StaffTicket, 'source'>) => t.source === 'api' || t.source === 'connector';

/** The server's Recent window (board snapshot: closed tickets updated in the last 30 minutes, FR-STF-05). */
export const RECENT_WINDOW_MS = 30 * 60_000;

/**
 * When a closed ticket entered Recent: the server's `closedAt`. An older API without it falls back to
 * `collectedAt`, then to when this board first saw it closed (`seenAt`).
 */
export function recentSince(t: StaffTicket, seenAt: number | undefined): number | undefined {
  if (t.closedAt) return time(t.closedAt);
  if (t.status === 'collected' && t.collectedAt) return time(t.collectedAt);
  return seenAt;
}

/**
 * Recent list as the server would return it now: closed tickets inside the 30-minute window, newest first.
 * Live-appended tickets age out exactly like a reload would drop them, so counts do not drift (FR-STF-01/05).
 */
export function pruneRecent(recent: readonly StaffTicket[], nowMs: number, seenAt: (id: string) => number | undefined): StaffTicket[] {
  return recent.filter((t) => {
    const since = recentSince(t, seenAt(t.id));
    return since === undefined || nowMs - since <= RECENT_WINDOW_MS;
  });
}

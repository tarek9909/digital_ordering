// Venue-local time helpers (TRD §9.1, TR-ALG-01, TR-ALG-16). Uses the IANA data bundled with Node via Intl.

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function toZoned(instant: Date, tz: string): LocalDateTime {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, tz: string): number {
  const z = toZoned(instant, tz);
  const asUtc = Date.parse(`${z.date}T${z.time}Z`);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a venue-local wall time to a UTC instant. A time inside a daylight-saving gap is shifted forward by the
 * gap length; an ambiguous time (autumn overlap) resolves to the later of its two instants (TR-ALG-01).
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  const naive = Date.parse(`${date}T${t}Z`);
  // Offsets in force a day either side of the wall time cover both sides of any transition near it (BW08); offsets
  // sampled only around the naive instant can both lie on the same side of an autumn overlap.
  const offsets = new Set<number>();
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000]) {
    const o = offsetMs(new Date(probe), tz);
    offsets.add(o);
    offsets.add(offsetMs(new Date(naive - o), tz));
  }
  const candidates = [...offsets].map((o) => naive - o).sort((a, b) => b - a);
  for (const c of candidates) {
    const z = toZoned(new Date(c), tz);
    if (z.date === date && z.time === t) return new Date(c); // the latest instant showing this wall time
  }
  // Gap: no wall time matches; the offset before the transition shifts it forward by the gap length (Temporal
  // "compatible" disambiguation).
  return new Date(candidates[0]!);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function normaliseTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t.slice(0, 8);
}

export interface ResetTimes {
  resetTime: string; // HH:MM[:SS]
  pendingResetTime?: string | null;
  /** A changed time zone, applying from `pendingFromDate` like the reset time (A13). */
  pendingTimeZone?: string | null;
  pendingFromDate?: string | null;
}

function pendingApplies(nowUtc: Date, tz: string, t: ResetTimes): string | null {
  if (!t.pendingFromDate || (!t.pendingResetTime && !t.pendingTimeZone)) return null;
  const local = toZoned(nowUtc, t.pendingTimeZone ?? tz);
  const reset = normaliseTime(t.pendingResetTime ?? t.resetTime);
  const withPending = local.time < reset ? addDays(local.date, -1) : local.date;
  return withPending >= t.pendingFromDate ? withPending : null;
}

/**
 * Business date of a venue (§9.1): the local date, minus one day before the reset time.
 * A pending reset time or time zone applies only from `pendingFromDate` (BR-27, TR-ALG-16).
 */
export function businessDate(nowUtc: Date, tz: string, times: ResetTimes | string): string {
  const t: ResetTimes = typeof times === 'string' ? { resetTime: times } : times;
  const local = toZoned(nowUtc, tz);
  const current = local.time < normaliseTime(t.resetTime) ? addDays(local.date, -1) : local.date;
  return pendingApplies(nowUtc, tz, t) ?? current;
}

/** The time zone in force now: the pending zone once its business date has started, else the current one. */
export function effectiveTimeZone(nowUtc: Date, tz: string, t: ResetTimes): string {
  return t.pendingTimeZone && pendingApplies(nowUtc, tz, t) ? t.pendingTimeZone : tz;
}

/** Next UTC instant strictly after `after` at which the venue-local clock shows `time` (an overlap's later instant). */
export function nextOccurrence(after: Date, tz: string, time: string): Date {
  const local = toZoned(after, tz);
  // From the previous local date on: inside an autumn overlap the clock can already show a later wall time than the
  // repeated occurrence that is still to come (BW08).
  for (let k = -1; k <= 2; k++) {
    const candidate = zonedToUtc(addDays(local.date, k), time, tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return zonedToUtc(addDays(local.date, 3), time, tz);
}

/** A daily wall time (such as the auto-close time) with a change that applies from a business date (BR-27). */
export interface PendingDailySchedule {
  timeZone: string;
  resetTime: string;
  /** The daily wall time in force now. */
  time: string;
  pendingTimeZone?: string | null;
  pendingResetTime?: string | null;
  pendingTime?: string | null;
  pendingFromDate?: string | null;
}

/**
 * Next instant strictly after `after` of a daily time whose time, reset or zone change applies from
 * `pendingFromDate` (BW05, TR-ALG-10/16, EX-18). An occurrence belongs to the new schedule when its business date,
 * under the new zone and reset time, is on or after that date, otherwise to the current schedule. The earliest
 * occurrence that is valid for its own schedule wins, so the first effective day of a change is never skipped, on
 * either side of the reset time.
 */
export function nextScheduledOccurrence(after: Date, s: PendingDailySchedule): Date {
  const from = s.pendingFromDate;
  if (!from || (!s.pendingTime && !s.pendingResetTime && !s.pendingTimeZone)) return nextOccurrence(after, s.timeZone, s.time);
  const zone = s.pendingTimeZone ?? s.timeZone;
  const reset = normaliseTime(s.pendingResetTime ?? s.resetTime);
  const time = s.pendingTime ?? s.time;
  const underNewSchedule = (i: Date) => {
    const l = toZoned(i, zone);
    return (l.time < reset ? addDays(l.date, -1) : l.date) >= from;
  };
  let best: Date | null = null;
  // The current schedule's next occurrence, unless the new schedule has taken over by then.
  const cur = nextOccurrence(after, s.timeZone, s.time);
  if (!underNewSchedule(cur)) best = cur;
  // The new schedule's first occurrence on or after its effective business date.
  const base = toZoned(after, zone).date;
  const start = base < from ? addDays(from, -1) : addDays(base, -1);
  for (let k = 0; k <= 4; k++) {
    const i = zonedToUtc(addDays(start, k), time, zone);
    if (i.getTime() <= after.getTime() || !underNewSchedule(i)) continue;
    if (!best || i.getTime() < best.getTime()) best = i;
    break;
  }
  return best ?? nextOccurrence(after, zone, time);
}

export const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

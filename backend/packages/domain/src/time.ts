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
 * Converts a venue-local wall time to a UTC instant. A time inside a daylight-saving gap
 * resolves to the later valid instant; an ambiguous time (overlap) resolves to the later one too (TR-ALG-01).
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  const naive = Date.parse(`${date}T${t}Z`);
  // Try both candidate offsets around the instant and pick the one that round-trips.
  const o1 = offsetMs(new Date(naive), tz);
  const o2 = offsetMs(new Date(naive - o1), tz);
  const candidates = [naive - o1, naive - o2].sort((a, b) => b - a);
  for (const c of candidates) {
    const z = toZoned(new Date(c), tz);
    if (z.date === date && z.time === t) return new Date(c);
  }
  // Gap: no wall time matches; shift forward by the gap length (Temporal "compatible" disambiguation).
  return new Date(Math.max(naive - o1, naive - o2));
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

/** Next UTC instant strictly after `after` at which the venue-local clock shows `time`. */
export function nextOccurrence(after: Date, tz: string, time: string): Date {
  const local = toZoned(after, tz);
  let candidate = zonedToUtc(local.date, time, tz);
  if (candidate.getTime() <= after.getTime()) candidate = zonedToUtc(addDays(local.date, 1), time, tz);
  return candidate;
}

export const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

import { describe, expect, it } from 'vitest';
import { nextOccurrence, nextScheduledOccurrence, toZoned, zonedToUtc } from '../src/time.js';

// Regressions for the 2026-10-22 completeness repairs BW08 (DST overlap) and BW05 (first effective day of a
// changed auto-close time, reset or zone). They assert the repaired behaviour.

const NY = 'America/New_York';
const iso = (d: Date) => d.toISOString();

describe('BW08 zonedToUtc / nextOccurrence around DST transitions (TR-ALG-01)', () => {
  it('resolves an autumn-overlap wall time to the later instant', () => {
    // 2026-11-01: New York falls back 02:00 EDT → 01:00 EST, so 01:30 happens at 05:30Z and again at 06:30Z.
    expect(iso(zonedToUtc('2026-11-01', '01:30', NY))).toBe('2026-11-01T06:30:00.000Z');
    expect(toZoned(zonedToUtc('2026-11-01', '01:30', NY), NY)).toEqual({ date: '2026-11-01', time: '01:30:00' });
    // Unambiguous times either side of the overlap are unchanged.
    expect(iso(zonedToUtc('2026-11-01', '00:30', NY))).toBe('2026-11-01T04:30:00.000Z');
    expect(iso(zonedToUtc('2026-11-01', '02:30', NY))).toBe('2026-11-01T07:30:00.000Z');
  });

  it('keeps the spring-gap behaviour: a missing wall time moves forward by the gap', () => {
    // 2026-03-08: New York springs forward 02:00 EST → 03:00 EDT; 02:30 does not exist and becomes 03:30 EDT.
    expect(iso(zonedToUtc('2026-03-08', '02:30', NY))).toBe('2026-03-08T07:30:00.000Z');
    expect(iso(zonedToUtc('2026-03-29', '02:30', 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedToUtc('2026-03-08', '01:30', NY))).toBe('2026-03-08T06:30:00.000Z');
  });

  it('does not skip the later repeated occurrence while the clock is inside the overlap', () => {
    // 05:45Z is 01:45 EDT, between the two 01:30s: the later one (06:30Z) is still to come today.
    expect(iso(nextOccurrence(new Date('2026-11-01T05:45:00Z'), NY, '01:30'))).toBe('2026-11-01T06:30:00.000Z');
    expect(iso(nextOccurrence(new Date('2026-11-01T05:00:00Z'), NY, '01:30'))).toBe('2026-11-01T06:30:00.000Z');
    expect(iso(nextOccurrence(new Date('2026-11-01T06:30:00Z'), NY, '01:30'))).toBe('2026-11-02T06:30:00.000Z');
    // Spring gap: the next 02:30 on the transition day is 03:30 EDT.
    expect(iso(nextOccurrence(new Date('2026-03-08T05:00:00Z'), NY, '02:30'))).toBe('2026-03-08T07:30:00.000Z');
    // Zones without DST are unaffected.
    expect(iso(nextOccurrence(new Date('2026-10-22T09:00:00Z'), 'Asia/Riyadh', '22:00'))).toBe('2026-10-22T19:00:00.000Z');
  });
});

describe('BW05 nextScheduledOccurrence: a pending change runs from its first effective day', () => {
  const riyadh = { timeZone: 'Asia/Riyadh', resetTime: '04:00:00', time: '22:00:00', pendingFromDate: '2026-10-23' };

  it('22:00 → 10:00 from tomorrow: today still closes at 22:00, tomorrow at 10:00', () => {
    const s = { ...riyadh, pendingTime: '10:00:00' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), s))).toBe('2026-10-22T19:00:00.000Z');
    // After today's 22:00 close, the next close is tomorrow's 10:00, not tomorrow's 22:00.
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T19:00:00Z'), s))).toBe('2026-10-23T07:00:00.000Z');
  });

  it('an auto-close time after midnight but before the reset belongs to the previous business date', () => {
    // 02:00 with a 04:00 reset closes business date D at D+1 02:00.
    const later = { ...riyadh, pendingTime: '02:00:00' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), later))).toBe('2026-10-22T19:00:00.000Z');
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T19:00:00Z'), later))).toBe('2026-10-23T23:00:00.000Z'); // 24 Oct 02:00
    // The other way: current 02:00 → 22:00. 23 Oct 02:00 still closes 22 Oct; then 23 Oct closes at 22:00.
    const earlier = { ...riyadh, time: '02:00:00', pendingTime: '22:00:00' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), earlier))).toBe('2026-10-22T23:00:00.000Z');
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T23:00:00Z'), earlier))).toBe('2026-10-23T19:00:00.000Z');
  });

  it('a changed reset time decides which business date an occurrence belongs to', () => {
    // Auto-close 05:00, reset moves 04:00 → 06:00 from 23 Oct. Under the new reset, 23 Oct 05:00 still belongs to
    // business date 22 Oct, so it closes the current day; the new schedule's first close (business date 23 Oct) is
    // 24 Oct 05:00 — never 23 Oct 05:00 twice and never a day skipped.
    const s = { ...riyadh, time: '05:00:00', pendingResetTime: '06:00:00' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), s))).toBe('2026-10-23T02:00:00.000Z');
    expect(iso(nextScheduledOccurrence(new Date('2026-10-23T02:00:00Z'), s))).toBe('2026-10-24T02:00:00.000Z');
    // Reset 04:00 → 00:00 with auto-close 02:00: 23 Oct 02:00 now falls inside business date 23 Oct, the first
    // effective day, and closes it.
    const midnight = { ...riyadh, time: '02:00:00', pendingResetTime: '00:00:00' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), midnight))).toBe('2026-10-22T23:00:00.000Z');
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T23:00:00Z'), midnight))).toBe('2026-10-23T23:00:00.000Z');
  });

  it('a changed zone closes the first effective day at the new zone’s wall time', () => {
    // Riyadh (UTC+3) → Dubai (UTC+4), 22:00 kept: 23 Oct closes at 22:00 Dubai = 18:00Z, an hour before 22:00 Riyadh.
    const s = { ...riyadh, pendingTimeZone: 'Asia/Dubai' };
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T19:00:00Z'), s))).toBe('2026-10-23T18:00:00.000Z');
  });

  it('without a pending change it is the plain next occurrence', () => {
    expect(iso(nextScheduledOccurrence(new Date('2026-10-22T09:00:00Z'), { timeZone: 'Asia/Riyadh', resetTime: '04:00:00', time: '22:00:00' }))).toBe('2026-10-22T19:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import {
  base62,
  businessDate,
  canTenantTransition,
  checkPin,
  checkSlug,
  chooseLocale,
  displayNumber,
  downgradeExcess,
  followerLevel,
  histogramPercentile,
  addToHistogram,
  emptyHistogram,
  mergeHistograms,
  newTicketCodes,
  newTicketToken,
  newVenueCode,
  nextOccurrence,
  percentile,
  pickNextNumber,
  pushServiceOf,
  classifyPushResult,
  staffOperationAllowed,
  statusAfterPayment,
  statusAfterReactivation,
  tenantAccess,
  ticketLevel,
  trialLimitExceeded,
  uuidv7,
  waitRemaining,
  zonedToUtc,
  SEED_PLANS,
  SEED_PRICES,
  CODE_ALPHABET,
  messagesFor,
  plainDomain,
} from '../src/index.js';

describe('business date (§9.1)', () => {
  it('rolls back a day before the reset time in the venue zone', () => {
    // 00:30 UTC = 03:30 Riyadh, before the 04:00 reset → previous date
    expect(businessDate(new Date('2026-10-22T00:30:00Z'), 'Asia/Riyadh', '04:00')).toBe('2026-10-21');
    expect(businessDate(new Date('2026-10-22T01:30:00Z'), 'Asia/Riyadh', '04:00')).toBe('2026-10-22');
  });

  it('applies a pending reset time only from its start date (BR-27)', () => {
    const t = { resetTime: '04:00', pendingResetTime: '02:00', pendingFromDate: '2026-10-23' };
    // 02:30 local on the 22nd: current rule says 21st, pending not yet active
    expect(businessDate(new Date('2026-10-21T23:30:00Z'), 'Asia/Riyadh', t)).toBe('2026-10-21');
    // 02:30 local on the 23rd: pending rule active → 23rd
    expect(businessDate(new Date('2026-10-22T23:30:00Z'), 'Asia/Riyadh', t)).toBe('2026-10-23');
  });

  it('handles daylight-saving gaps by taking the later instant', () => {
    // Europe/Berlin springs forward 2026-03-29 02:00 → 03:00
    const d = zonedToUtc('2026-03-29', '02:30', 'Europe/Berlin');
    expect(d.toISOString()).toBe('2026-03-29T01:30:00.000Z'); // shifted forward by the gap (03:30 local)
    expect(zonedToUtc('2026-07-01', '04:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T02:00:00.000Z');
  });

  it('finds the next auto-close occurrence', () => {
    const after = new Date('2026-10-22T02:00:00Z'); // 05:00 Riyadh
    expect(nextOccurrence(after, 'Asia/Riyadh', '04:00').toISOString()).toBe('2026-10-23T01:00:00.000Z');
    expect(nextOccurrence(new Date('2026-10-22T00:00:00Z'), 'Asia/Riyadh', '04:00').toISOString()).toBe('2026-10-22T01:00:00.000Z');
  });
});

describe('number allocation (§9.2)', () => {
  const rules = { rangeStart: 1, rangeEnd: 5, skipNumbers: [3] };
  it('skips blocked and open numbers and wraps', () => {
    expect(pickNextNumber(0, rules, new Set())).toBe(1);
    expect(pickNextNumber(2, rules, new Set())).toBe(4);
    expect(pickNextNumber(5, rules, new Set([1]))).toBe(2);
  });
  it('returns null when exhausted', () => {
    expect(pickNextNumber(0, rules, new Set([1, 2, 4, 5]))).toBeNull();
  });
  it('formats display numbers without leading zeros', () => {
    expect(displayNumber('A', 27)).toBe('A27');
    expect(displayNumber(null, 7)).toBe('7');
  });
});

describe('codes and tokens', () => {
  it('generates 22-char base62 tokens and unambiguous codes', () => {
    const t = newTicketToken();
    expect(t).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(base62(Buffer.alloc(16, 0xff), 22)).toHaveLength(22);
    expect(newVenueCode()).toMatch(new RegExp(`^[${CODE_ALPHABET}]{6}$`));
    for (let i = 0; i < 200; i++) {
      const c = newTicketCodes();
      expect(c.checkCode).not.toBe(c.claimCode);
    }
  });
  it('generates time-ordered UUIDv7', () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('tenant lifecycle (§8.2)', () => {
  it('allows only the drawn arrows (TR-TEN-18)', () => {
    expect(canTenantTransition('trial', 'active')).toBe(true);
    expect(canTenantTransition('trial_expired', 'trial')).toBe(false);
    expect(canTenantTransition('deleted', 'active')).toBe(false);
  });
  it('lifts billing suspensions only by payment and platform ones only by reactivation', () => {
    expect(statusAfterPayment({ status: 'suspended', suspendedBy: 'billing', statusBeforeSuspension: 'past_due' })).toBe('active');
    expect(statusAfterPayment({ status: 'suspended', suspendedBy: 'platform', statusBeforeSuspension: 'trial' })).toBeNull();
    expect(statusAfterReactivation({ status: 'suspended', suspendedBy: 'platform', statusBeforeSuspension: 'trial' })).toBe('trial');
    expect(statusAfterReactivation({ status: 'suspended', suspendedBy: 'billing', statusBeforeSuspension: 'active' })).toBeNull();
  });
  it('lets a suspended tenant finish open tickets but not create new ones (BR-18, EX-14)', () => {
    expect(staffOperationAllowed('suspended', 'create')).toEqual({ ok: false, code: 'TENANT_SUSPENDED' });
    expect(staffOperationAllowed('suspended', 'transition', 'ready')).toEqual({ ok: true });
    expect(staffOperationAllowed('suspended', 'transition', 'collected')).toEqual({ ok: true });
    expect(staffOperationAllowed('suspended', 'transition', 'preparing')).toEqual({ ok: false, code: 'TENANT_SUSPENDED' });
    expect(staffOperationAllowed('cancelled', 'transition', 'collected')).toEqual({ ok: false, code: 'TENANT_INACTIVE' });
    expect(tenantAccess('suspended').display).toBe(true);
    expect(tenantAccess('trial_expired').customer).toBe('closed_only');
  });
});

describe('alert level (§9.6)', () => {
  it('ranks push > live > closed > none', () => {
    expect(followerLevel({ hasActivePush: false, present: true, wasLive: true })).toBe('live');
    expect(followerLevel({ hasActivePush: false, present: false, wasLive: true })).toBe('closed');
    expect(ticketLevel(['closed', 'push', 'live'])).toBe('push');
    expect(ticketLevel([])).toBe('none');
  });
  it('recognises push services and classifies results', () => {
    expect(pushServiceOf('https://fcm.googleapis.com/fcm/send/abc')).toBe('fcm');
    expect(pushServiceOf('https://web.push.apple.com/xyz')).toBe('apns');
    expect(pushServiceOf('https://evil.example.com/x')).toBeNull();
    expect(pushServiceOf('http://fcm.googleapis.com/x')).toBeNull();
    expect(classifyPushResult(201)).toBe('success');
    expect(classifyPushResult(410)).toBe('revoke');
    expect(classifyPushResult(503)).toBe('retry');
  });
});

describe('rules', () => {
  it('computes remaining wait and overdue', () => {
    const base = new Date('2026-10-22T12:00:00Z');
    expect(waitRemaining(10, base, new Date('2026-10-22T12:04:30Z'))).toEqual({ remainingMinutes: 6, overdue: false });
    expect(waitRemaining(10, base, new Date('2026-10-22T12:11:00Z'))).toEqual({ remainingMinutes: 0, overdue: true });
    expect(waitRemaining(null, null, base)).toEqual({ remainingMinutes: null, overdue: false });
  });
  it('validates slugs (TR-URL-04)', () => {
    expect(checkSlug('burger-house')).toBe('ok');
    expect(checkSlug('admin')).toBe('reserved');
    expect(checkSlug('-bad')).toBe('invalid');
    expect(checkSlug('ab')).toBe('invalid');
    expect(checkSlug('Upper')).toBe('invalid');
  });
  it('refuses weak PINs (TR-SEC-06)', () => {
    expect(checkPin('4821')).toBe('ok');
    expect(checkPin('1234')).toBe('weak');
    expect(checkPin('9876')).toBe('weak');
    expect(checkPin('1111')).toBe('weak');
    expect(checkPin('12a4')).toBe('format');
  });
  it('detects trial limit and downgrade excess', () => {
    expect(trialLimitExceeded('trial', 201, 200)).toBe(true);
    expect(trialLimitExceeded('active', 5000, 200)).toBe(false);
    // A tighter plan than the single Standard plan, to exercise the check.
    const standard = { limits: { ...SEED_PLANS.find((p) => p.code === 'standard')!.limits, maxCountersPerVenue: 1 } };
    const excess = downgradeExcess(
      { venues: 1, maxCountersInAVenue: 3, maxLanguagesInAVenue: 2, maxDisplaysInAVenue: 1, maxStaffDevicesInAVenue: 2, maxApiKeysInAVenue: 0 },
      standard.limits,
    );
    expect(excess).toEqual([{ limit: 'maxCountersPerVenue', current: 3, allowed: 1 }]);
  });
  it('seeds OI-02 prices', () => {
    const p = (plan: string, period: string) => SEED_PRICES.find((x) => x.plan === plan && x.period === period)!.amountMinor;
    expect(p('standard', 'month')).toBe(2700);
    expect(p('standard', 'quarter')).toBe(7290);
    expect(p('pro', 'year')).toBe(171840);
  });
  it('chooses locales and falls back for messages (TR-L10N-02/03)', () => {
    expect(chooseLocale(['ar', 'en'], ['en-GB', 'fr'])).toBe('en');
    expect(chooseLocale(['ar', 'en'], ['de'])).toBe('ar');
    expect(messagesFor({ ar: { welcome: 'أهلا', collection: 'x' }, en: { welcome: 'Hi' } }, 'en', 'ar')).toEqual({ welcome: 'Hi', collection: 'x' });
    expect(plainDomain('https://www.example.com/menu?a=1')).toBe('example.com');
  });
});

describe('report histograms (TR-RPT-07)', () => {
  it('merges and computes percentiles within one bucket', () => {
    const h1 = emptyHistogram();
    [20, 40, 70, 100].forEach((s) => addToHistogram(h1, s));
    const h2 = emptyHistogram();
    [700, 9000].forEach((s) => addToHistogram(h2, s));
    const m = mergeHistograms([h1, h2]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(6);
    expect(histogramPercentile(m, 50)).toBe(75); // 3rd value 70 s → bucket [60,75)
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(histogramPercentile(emptyHistogram(), 50)).toBeNull();
  });
});

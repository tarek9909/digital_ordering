import { describe, expect, it } from 'vitest';
import { claimAgeMinutes, claimsReducer, liveClaims, type ClaimItem } from './claims';
import { checkCodeMode, claimsMode, isPosTicket, soundOnApiTicket } from './ticketState';

const T0 = Date.parse('2026-10-22T12:00:00Z');
const claim = (id: string, msFromT0: number, over: Partial<ClaimItem> = {}): ClaimItem => ({
  claimId: id,
  displayNumber: id.toUpperCase(),
  createdAt: new Date(T0 + msFromT0).toISOString(),
  ...over,
});

describe('claimsReducer', () => {
  it('adds live claims oldest first without duplicates, keeping the snapshot ticket id', () => {
    const s0 = [claim('b', 1000, { ticketId: 't-b' })];
    const s1 = claimsReducer(s0, { type: 'requested', claim: claim('a', 0) });
    expect(s1.map((c) => c.claimId)).toEqual(['a', 'b']);
    const s2 = claimsReducer(s1, { type: 'requested', claim: claim('b', 1000) });
    expect(s2).toHaveLength(2);
    expect(s2.find((c) => c.claimId === 'b')?.ticketId).toBe('t-b');
  });

  it('removes a claim on claim.decided', () => {
    expect(claimsReducer([claim('a', 0), claim('b', 0)], { type: 'decided', claimId: 'a' }).map((c) => c.claimId)).toEqual(['b']);
  });

  it('drops claims older than 5 minutes', () => {
    const s = [claim('old', 0), claim('new', 4 * 60_000)];
    expect(liveClaims(s, T0 + 5 * 60_000).map((c) => c.claimId)).toEqual(['new']);
    expect(claimsReducer(s, { type: 'expire', nowMs: T0 + 9 * 60_000 })).toEqual([]);
  });

  it('computes the age in whole minutes', () => {
    expect(claimAgeMinutes(claim('a', 0), T0 + 150_000)).toBe(2);
    expect(claimAgeMinutes(claim('a', 5000), T0)).toBe(0);
  });
});

describe('venue settings readers', () => {
  it('reads check-code and claim modes with safe defaults', () => {
    expect(checkCodeMode({ checkCode: 'mandatory' })).toBe('mandatory');
    expect(checkCodeMode(null)).toBe('off');
    expect(claimsMode({ claims: { mode: 'staff_approval' } })).toBe('staff_approval');
    expect(claimsMode({})).toBe('code');
  });

  it('plays the POS sound only when enabled and only for api/connector tickets', () => {
    expect(soundOnApiTicket({ staff: { soundOnApiTicket: true } })).toBe(true);
    expect(soundOnApiTicket({ staff: {} })).toBe(false);
    expect(isPosTicket({ source: 'api' })).toBe(true);
    expect(isPosTicket({ source: 'connector' })).toBe(true);
    expect(isPosTicket({ source: 'staff' })).toBe(false);
  });
});

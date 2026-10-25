import { describe, expect, it } from 'vitest';
import { jsonValue } from './format';
import { majorToMinor, minorToMajor } from './money';
import { DEFAULT_LIMITS, parseFeatures, parsePlanLimits } from './planLimits';
import { keysOf, normalizeDay } from './platformReport';
import { can } from './roles';
import { cleanCode, isLive, isMine, type SupportSession } from './support';

describe('money', () => {
  it('shows minor units as major with two decimals', () => {
    expect(minorToMajor(1999)).toBe('19.99');
    expect(minorToMajor(5)).toBe('0.05');
    expect(minorToMajor(200000)).toBe('2000.00');
    expect(minorToMajor(0)).toBe('0.00');
  });
  it('parses major amounts into minor units', () => {
    expect(majorToMinor('19.99')).toBe(1999);
    expect(majorToMinor('20')).toBe(2000);
    expect(majorToMinor('0.5')).toBe(50);
    expect(majorToMinor(' 7,25 ')).toBe(725);
    expect(majorToMinor('1.005')).toBeNull();
    expect(majorToMinor('-1')).toBeNull();
    expect(majorToMinor('abc')).toBeNull();
    expect(majorToMinor('')).toBeNull();
  });
  it('round-trips', () => {
    for (const n of [0, 1, 99, 100, 12345, 990000]) expect(majorToMinor(minorToMajor(n))).toBe(n);
  });
});

describe('jsonValue', () => {
  it('parses stored JSON text and falls back on bad input', () => {
    expect(jsonValue('{"a":1}', {})).toEqual({ a: 1 });
    expect(jsonValue('broken', { x: 1 })).toEqual({ x: 1 });
  });
});

describe('plan limits JSON', () => {
  it('accepts a complete limits object', () => {
    expect(parsePlanLimits(JSON.stringify(DEFAULT_LIMITS))).toEqual({ ok: true, value: DEFAULT_LIMITS });
  });
  it('reports syntax errors, missing, wrong and unknown keys', () => {
    expect(parsePlanLimits('{')).toMatchObject({ ok: false, error: 'syntax' });
    const { maxVenues: _omit, ...missing } = DEFAULT_LIMITS;
    expect(parsePlanLimits(JSON.stringify(missing))).toEqual({ ok: false, error: 'shape', keys: ['maxVenues'] });
    expect(parsePlanLimits(JSON.stringify({ ...DEFAULT_LIMITS, maxVenues: 1.5 }))).toEqual({ ok: false, error: 'shape', keys: ['maxVenues'] });
    expect(parsePlanLimits(JSON.stringify({ ...DEFAULT_LIMITS, maxLanguages: 0 }))).toEqual({ ok: false, error: 'shape', keys: ['maxLanguages'] });
    expect(parsePlanLimits(JSON.stringify({ ...DEFAULT_LIMITS, extra: 1 }))).toEqual({ ok: false, error: 'shape', keys: ['extra'] });
    expect(parsePlanLimits('[]')).toMatchObject({ ok: false, error: 'shape' });
  });
  it('parses feature lists', () => {
    expect(parseFeatures('webhooks\n api , webhooks,,')).toEqual(['webhooks', 'api']);
  });
});

describe('platform report rows', () => {
  it('normalises JSON text and numbers', () => {
    const d = normalizeDay({ metric_date: '2026-10-01T00:00:00.000Z', tenants_by_status: '{"active":3,"trial":"2"}', tenants_by_plan: { pro: 1 }, signups: '4', cancellations: null, mrr_minor: { SAR: 19900 }, tickets: 50 });
    expect(d).toEqual({ date: '2026-10-01', byStatus: { active: 3, trial: 2 }, byPlan: { pro: 1 }, signups: 4, cancellations: 0, mrr: { SAR: 19900 }, tickets: 50 });
    expect(keysOf([d, { ...d, mrr: { AED: 1 } }], 'mrr')).toEqual(['AED', 'SAR']);
  });
});

describe('support sessions and R1.1 roles', () => {
  const s: SupportSession = { id: '1', status: 'active', kind: 'normal', reason: 'x', agentName: 'Sara', requestedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T02:00:00Z', endedAt: null };
  it('knows own and live sessions and cleans codes', () => {
    expect(isMine(s, 'Sara')).toBe(true);
    expect(isMine(s, undefined)).toBe(false);
    expect(isLive(s, Date.parse('2026-01-01T01:00:00Z'))).toBe(true);
    expect(isLive(s, Date.parse('2026-01-01T03:00:00Z'))).toBe(false);
    expect(cleanCode('1234 5678 9')).toBe('12345678');
  });
  it('mirrors TRD §14.2 grants', () => {
    expect(can('support', 'notes')).toBe(true);
    expect(can('support', 'support')).toBe(true);
    expect(can('support', 'support.emergency')).toBe(false);
    expect(can('support', 'commercial')).toBe(false);
    expect(can('finance', 'notes')).toBe(false);
    expect(can('finance', 'reports')).toBe(true);
  });
});

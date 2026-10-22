import { describe, expect, it } from 'vitest';
import { forgetPurpose, getPurpose, PURPOSE_TTL_MS, purposeHeaders, rememberPurpose, type PurposeStorage } from './purpose';

function memory(): PurposeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('purpose memory (TR-FE-25)', () => {
  it('remembers a purpose per tenant for one hour', () => {
    const s = memory();
    rememberPurpose('t1', 'billing', s, 1_000);
    expect(getPurpose('t1', s, 1_000 + PURPOSE_TTL_MS - 1)).toBe('billing');
    expect(getPurpose('t2', s, 1_000)).toBeNull();
  });

  it('expires after one hour and removes the entry', () => {
    const s = memory();
    rememberPurpose('t1', 'support', s, 0);
    expect(getPurpose('t1', s, PURPOSE_TTL_MS)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it('ignores corrupt or unknown values', () => {
    const s = memory();
    s.setItem('dop.console.purpose.t1', 'not json');
    expect(getPurpose('t1', s, 0)).toBeNull();
    s.setItem('dop.console.purpose.t1', JSON.stringify({ purpose: 'curiosity', at: 0 }));
    expect(getPurpose('t1', s, 0)).toBeNull();
  });

  it('works without storage and can be forgotten', () => {
    expect(getPurpose('t1', null, 0)).toBeNull();
    const s = memory();
    rememberPurpose('t1', 'legal', s, 0);
    forgetPurpose('t1', s);
    expect(getPurpose('t1', s, 0)).toBeNull();
  });

  it('builds the X-Purpose header', () => {
    expect(purposeHeaders('security')).toEqual({ 'X-Purpose': 'security' });
  });
});

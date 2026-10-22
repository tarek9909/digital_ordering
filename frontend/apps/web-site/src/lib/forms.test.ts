import { describe, expect, it } from 'vitest';
import { mapFieldErrors, prefillName } from './forms';

describe('mapFieldErrors', () => {
  it('maps known paths to fields and keeps the rest', () => {
    const r = mapFieldErrors({ email: 'taken', 'password.0': 'breached', other: 'x' }, ['email', 'password'] as const);
    expect(r.fields).toEqual([
      ['email', 'taken'],
      ['password', 'breached'],
    ]);
    expect(r.rest).toEqual(['other: x']);
  });
});

describe('prefillName', () => {
  it('reads the trimmed, length-limited name from the query', () => {
    expect(prefillName('?name=%20Abu%20Ali%20')).toBe('Abu Ali');
    expect(prefillName('')).toBe('');
    expect(prefillName(`?name=${'x'.repeat(200)}`)).toHaveLength(120);
  });
});

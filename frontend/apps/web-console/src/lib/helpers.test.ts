import { describe, expect, it } from 'vitest';
import { isPublicPath } from './api';
import { fmtDuration, parseIdList } from './format';
import { can } from './roles';
import { parseSettingJson } from './settingJson';

describe('setting JSON editor', () => {
  it('accepts JSON of the same shape', () => {
    expect(parseSettingJson('21', 14)).toEqual({ ok: true, value: 21 });
    expect(parseSettingJson('{"enabled":true}', { enabled: false })).toEqual({ ok: true, value: { enabled: true } });
  });
  it('rejects syntax errors and shape changes', () => {
    expect(parseSettingJson('{', {})).toMatchObject({ ok: false, error: 'syntax' });
    expect(parseSettingJson('"14"', 14)).toEqual({ ok: false, error: 'shape', expected: 'number' });
    expect(parseSettingJson('{}', [])).toEqual({ ok: false, error: 'shape', expected: 'array' });
  });
});

describe('roles', () => {
  it('mirrors the console grants', () => {
    expect(can('super_admin', 'platform_users')).toBe(true);
    expect(can('support', 'tenants.read')).toBe(true);
    expect(can('support', 'tenants.lifecycle')).toBe(false);
    expect(can('finance', 'reports')).toBe(true);
    expect(can(undefined, 'tenants.read')).toBe(false);
  });
});

describe('helpers', () => {
  it('formats durations and parses id lists', () => {
    expect(fmtDuration(125)).toBe('2:05');
    expect(fmtDuration(null)).toBe('—');
    expect(parseIdList('a, b\nb  c')).toEqual(['a', 'b', 'c']);
  });
  it('knows the public paths', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/accept')).toBe(true);
    expect(isPublicPath('/tenants')).toBe(false);
  });
});

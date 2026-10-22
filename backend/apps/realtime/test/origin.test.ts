import { describe, expect, it } from 'vitest';
import { appOriginCheck } from '../src/server.js';

// I-3: sockets only from the app's own origin on the customer or a tenant host (docs/security/2026-10-22/REMEDIATION.md).

describe('realtime Origin rule (I-3)', () => {
  const ok = appOriginCheck('tanbeeh.app');
  it('accepts same-origin customer and tenant pages', () => {
    expect(ok('https://t.tanbeeh.app', 't.tanbeeh.app')).toBe(true);
    expect(ok('https://burger-house.tanbeeh.app', 'burger-house.tanbeeh.app')).toBe(true);
  });
  it('refuses other platform hosts, cross-origin pages and foreign sites', () => {
    expect(ok('https://files.tanbeeh.app', 'files.tanbeeh.app')).toBe(false);
    expect(ok('https://www.tanbeeh.app', 'www.tanbeeh.app')).toBe(false);
    expect(ok('https://admin.tanbeeh.app', 'admin.tanbeeh.app')).toBe(false);
    expect(ok('https://other-cafe.tanbeeh.app', 'burger-house.tanbeeh.app')).toBe(false);
    expect(ok('https://evil.example', 'burger-house.tanbeeh.app')).toBe(false);
    expect(ok('https://a.b.tanbeeh.app', 'a.b.tanbeeh.app')).toBe(false);
    expect(ok(undefined, 't.tanbeeh.app')).toBe(false);
    expect(ok('not a url', 't.tanbeeh.app')).toBe(false);
  });
});

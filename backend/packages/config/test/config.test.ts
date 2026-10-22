import { describe, expect, it } from 'vitest';
import { clientAddress, loadEnv, normalizeIp, parseIpRules, trustedProxiesOf } from '../src/index.js';

// Regression tests for the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md).

const base = {
  PLATFORM_DOMAIN: 'tanbeeh.test',
  DATABASE_URL: 'mysql://u:p@db:3306/x',
  REDIS_CACHE_URL: 'redis://r:6379/0',
  REDIS_QUEUE_URL: 'redis://r:6379/1',
  CDN_BASE_URL: 'https://files.tanbeeh.test/a',
  SESSION_PEPPER: 'x'.repeat(40),
  DATA_KEY: Buffer.alloc(32, 1).toString('base64'),
};
const prod = { ...base, NODE_ENV: 'production', APP_ENV: 'production' };

describe('no payment processor configuration', () => {
  it('ignores leftover Stripe variables from an old .env', () => {
    const env = loadEnv({ ...prod, STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    expect(env).not.toHaveProperty('STRIPE_SECRET_KEY');
  });
});

describe('production guards do not depend on APP_ENV alone (L-9)', () => {
  it('refuses a production build that claims to be local', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'local' })).toThrow(/APP_ENV/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/APP_ENV/);
  });
  it('refuses example secrets and development keys in deployed environments', () => {
    for (const APP_ENV of ['dev', 'staging', 'production']) {
      const env = { ...prod, APP_ENV };
      expect(() => loadEnv({ ...env, SESSION_PEPPER: 'local-dev-pepper-change-me-0123456789' })).toThrow(/SESSION_PEPPER/);
      expect(() => loadEnv({ ...env, SESSION_PEPPER: 'CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME' })).toThrow(/SESSION_PEPPER/);
      expect(() => loadEnv({ ...env, LOCAL_DATA_KEY: 'x' })).toThrow(/LOCAL_DATA_KEY/);
      expect(() => loadEnv({ ...env, INSECURE_COOKIES: 'true' })).toThrow(/INSECURE_COOKIES/);
    }
  });
});

describe('client address and proxy trust (M-7, H-2)', () => {
  it('trusts nobody by default when deployed, loopback locally, and refuses TRUST_PROXY=true when deployed', () => {
    expect(trustedProxiesOf({ APP_ENV: 'production' }).has('172.30.0.10')).toBe(false);
    expect(trustedProxiesOf({ APP_ENV: 'local' }).has('127.0.0.1')).toBe(true);
    expect(() => trustedProxiesOf({ APP_ENV: 'production', TRUST_PROXY: 'true' })).toThrow();
    expect(() => loadEnv({ ...prod, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    expect(() => loadEnv({ ...prod, TRUST_PROXY: '172.30.0.300' })).toThrow();
    expect(trustedProxiesOf({ APP_ENV: 'production', TRUST_PROXY: '172.30.0.10' }).has('::ffff:172.30.0.10')).toBe(true);
  });
  it('uses X-Forwarded-For only from a trusted peer, and only up to the first untrusted hop', () => {
    const caddy = parseIpRules(['172.30.0.10']);
    expect(clientAddress('203.0.113.9', '6.6.6.6', caddy)).toBe('203.0.113.9'); // direct client: header ignored
    expect(clientAddress('172.30.0.10', '203.0.113.9', caddy)).toBe('203.0.113.9');
    expect(clientAddress('::ffff:172.30.0.10', '6.6.6.6, 203.0.113.9', caddy)).toBe('203.0.113.9'); // spoofed left entry ignored
    expect(clientAddress('172.30.0.10', undefined, caddy)).toBe('172.30.0.10');
    expect(clientAddress('172.30.0.10', 'not-an-ip', caddy)).toBe('172.30.0.10');
  });
});

describe('IP rules (M-18)', () => {
  it('parses IPv4/IPv6 addresses and ranges and normalises mapped addresses', () => {
    const r = parseIpRules(['203.0.113.0/24', '2001:db8::/32', '198.51.100.7']);
    expect(r.has('203.0.113.200')).toBe(true);
    expect(r.has('::ffff:203.0.113.5')).toBe(true);
    expect(r.has('::ffff:cb00:7105')).toBe(true); // hex form of 203.0.113.5
    expect(r.has('2001:db8:1::1')).toBe(true);
    expect(r.has('198.51.100.8')).toBe(false);
    expect(r.has('garbage')).toBe(false);
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
  });
  it('rejects malformed rules', () => {
    for (const bad of ['10.0.0.0/33', '10.0.0', 'example.com', '2001:db8::/129', '10.0.0.0/8/1', '1.2.3.4/']) expect(() => parseIpRules([bad])).toThrow();
  });
});

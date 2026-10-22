import { describe, expect, it } from 'vitest';
import { can, checkPassword, currentTotp, newTotpSecret, totpStepOf, type Actor } from '../src/index.js';

// Regression tests for the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md).

describe('breached-password list (L-3)', () => {
  it('loads the bundled top-100,000 entries, not only the built-in ones', () => {
    expect(checkPassword('blahblahblah')).toBe('breached');
    expect(checkPassword('bladerunner')).toBe('breached');
    expect(checkPassword('BlackStone')).toBe('breached'); // case-insensitive
    expect(checkPassword('a-long-unique-passphrase')).toBeNull();
  });
});

describe('TOTP time step (L-1)', () => {
  it('returns the step a code belongs to, within the ±1 window, and null for wrong codes', () => {
    const secret = newTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    expect(totpStepOf(secret, currentTotp(secret), now)).toBe(step);
    expect(totpStepOf(secret, currentTotp(secret, 1), now)).toBe(step + 1);
    expect(totpStepOf(secret, currentTotp(secret, -1), now)).toBe(step - 1);
    expect(totpStepOf(secret, 'abcdef', now)).toBeNull();
    expect(totpStepOf(secret, currentTotp(secret), now + 5 * 60_000)).toBeNull();
  });
});

describe('support sessions never obtain lasting staff credentials or billing changes (M-9, M-13, L-10)', () => {
  const support: Actor = { kind: 'support', platformUserId: 'p', tenantId: 't', supportSessionId: 's', agentName: 'Agent' };
  const manager: Actor = { kind: 'user', userId: 'u', tenantId: 't', role: 'manager', sessionId: 's', mfaVerified: true };
  const owner: Actor = { ...manager, role: 'owner' };
  it('keeps device and display oversight but not link, PIN or pairing', () => {
    expect(can(support, 'venue.staff_access')).toBe(true);
    expect(can(support, 'venue.staff_credentials')).toBe(false);
    expect(can(manager, 'venue.staff_credentials')).toBe(true);
  });
  it('creating venues and moderating ratings are for the owner', () => {
    for (const p of ['billing.manage', 'ratings.moderate'] as const) {
      expect(can(owner, p)).toBe(true);
      expect(can(manager, p)).toBe(false);
      expect(can(support, p)).toBe(false);
    }
  });
});

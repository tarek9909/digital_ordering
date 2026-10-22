import { describe, expect, it } from 'vitest';
import { authorize, can, checkPassword, currentTotp, decrypt, encrypt, hashSecret, newTotpSecret, requireFreshMfa, staticKeyProvider, tokenHash, verifySecret, verifyTotp, } from '../src/index.js';
const owner = { kind: 'user', userId: 'u', tenantId: 't', role: 'owner', sessionId: 's', mfaVerified: false };
const manager = { ...owner, role: 'manager' };
const support = { kind: 'support', platformUserId: 'p', tenantId: 't', supportSessionId: 'ss', agentName: 'Sam' };
const device = { kind: 'staff_device', deviceId: 'd', tenantId: 't', venueId: 'v', deviceName: 'iPad' };
describe('permissions (§14.2)', () => {
    it('matches the role table', () => {
        expect(can(owner, 'billing.manage')).toBe(true);
        expect(can(manager, 'billing.manage')).toBe(false);
        expect(can(manager, 'team.invite_managers')).toBe(true);
        expect(can(manager, 'team.manage')).toBe(false);
        expect(can(device, 'tickets.write')).toBe(true);
        expect(can(device, 'venue.settings')).toBe(false);
        expect(can({ kind: 'display', displayId: 'x', tenantId: 't', venueId: 'v' }, 'tickets.write')).toBe(false);
    });
    it('blocks support sessions from billing, keys, ownership, deletion, export and approvals (TR-AUTH-10)', () => {
        for (const p of ['billing.manage', 'integrations.manage', 'team.manage', 'tenant.delete', 'tenant.export', 'support.decide']) {
            expect(can(support, p), p).toBe(false);
        }
        expect(can(support, 'billing.view')).toBe(true);
    });
    it('separates platform roles', () => {
        const fin = { kind: 'platform', platformUserId: 'p', role: 'finance', sessionId: 's', mfaVerifiedAt: new Date() };
        expect(can(fin, 'console.billing.read')).toBe(true);
        expect(can(fin, 'console.tenants.lifecycle')).toBe(false);
        expect(() => authorize({ kind: 'anonymous' }, 'board.view')).toThrow(/Sign-in/);
        expect(() => authorize(fin, 'console.audit')).toThrow(/Not allowed/);
    });
    it('requires a fresh MFA check for destructive console actions', () => {
        const now = new Date('2026-10-22T12:00:00Z');
        const stale = { kind: 'platform', platformUserId: 'p', role: 'super_admin', sessionId: 's', mfaVerifiedAt: new Date(now.getTime() - 16 * 60_000) };
        expect(() => requireFreshMfa(stale, now)).toThrow();
        expect(() => requireFreshMfa({ ...stale, mfaVerifiedAt: new Date(now.getTime() - 60_000) }, now)).not.toThrow();
    });
});
describe('crypto', () => {
    it('hashes and verifies with argon2id', async () => {
        const h = await hashSecret('correct horse battery');
        expect(h.startsWith('$argon2id$v=19$')).toBe(true);
        expect(h).toContain('m=19456');
        expect(h).toContain('t=2');
        expect(h).toContain('p=1');
        expect(await verifySecret(h, 'correct horse battery')).toBe(true);
        expect(await verifySecret(h, 'wrong')).toBe(false);
    });
    it('peppers token hashes', () => {
        expect(tokenHash('pepper-a', 'tok')).not.toBe(tokenHash('pepper-b', 'tok'));
        expect(tokenHash('pepper-a', 'tok')).toMatch(/^[0-9a-f]{64}$/);
    });
    it('round-trips AES-256-GCM and detects tampering', async () => {
        const keys = staticKeyProvider(Buffer.alloc(32, 7).toString('base64'));
        const blob = await encrypt(keys, 'staff-key-value');
        expect(await decrypt(keys, blob)).toBe('staff-key-value');
        blob[blob.length - 1] ^= 1;
        await expect(decrypt(keys, blob)).rejects.toThrow();
    });
    it('checks password rules and TOTP', () => {
        expect(checkPassword('short')).toBe('too_short');
        expect(checkPassword('password123')).toBe('breached');
        expect(checkPassword('a-long-unique-passphrase')).toBeNull();
        const secret = newTotpSecret();
        expect(verifyTotp(secret, currentTotp(secret))).toBe(true);
        expect(verifyTotp(secret, '000000')).toBe(false);
    });
});

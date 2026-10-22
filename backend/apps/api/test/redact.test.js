import { describe, expect, it } from 'vitest';
import { redactPath, redactUrl } from '../src/http/redact.js';
// M-3: no bearer secret from a URL reaches the request log (docs/security/2026-10-22/REMEDIATION.md).
const TICKET = 'AbCdEfGhIjKlMnOpQrStUv';
const SECRET = 'q1W2e3R4t5Y6u7I8o9P0aSdFgHjKlZxCvBnM-_1234';
const UUID = '0193e4a2-7c1b-7d2e-9f00-123456789abc';
describe('request URL redaction (M-3)', () => {
    it('masks ticket, manifest and invitation tokens in paths', () => {
        for (const url of [
            `/api/public/v1/tickets/${TICKET}`,
            `/api/public/v1/tickets/${TICKET}/manifest`,
            `/m/${TICKET}.webmanifest`,
            `/api/auth/v1/invitations/${SECRET}`,
            `/api/auth/v1/invitations/${SECRET}/accept`,
            `/api/auth/v1/platform-invitations/${SECRET}/accept`,
            `/api/anything/${SECRET}`,
        ]) {
            const out = redactUrl(url);
            expect(out).not.toContain(TICKET);
            expect(out).not.toContain(SECRET);
        }
        expect(redactPath(`/m/${TICKET}.webmanifest`)).toBe('/m/AbCd….webmanifest');
    });
    it('masks every query value except harmless filters', () => {
        const out = redactUrl(`/api/auth/v1/oauth/google/callback?code=${SECRET}&state=${SECRET}&scope=openid`);
        expect(out).not.toContain(SECRET);
        expect(out).toBe('/api/auth/v1/oauth/google/callback?code=[redacted]&state=[redacted]&scope=[redacted]');
        expect(redactUrl(`/api/public/v1/claims/${UUID}?clientId=${TICKET}`)).not.toContain(TICKET);
        expect(redactUrl(`/api/admin/v1/reports/today?venueId=${UUID}`)).toBe(`/api/admin/v1/reports/today?venueId=${UUID}`);
    });
    it('keeps plain record IDs and routes readable', () => {
        expect(redactUrl(`/api/staff/v1/tickets/${UUID}/transition`)).toBe(`/api/staff/v1/tickets/${UUID}/transition`);
        expect(redactUrl(`/api/admin/v1/invitations/${UUID}`)).toBe(`/api/admin/v1/invitations/${UUID}`);
        expect(redactUrl('/api/admin/v1/venues')).toBe('/api/admin/v1/venues');
    });
});

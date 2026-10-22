import { describe, expect, it } from 'vitest';
import { allowedTargets, canAcknowledge, canRate, checkTransition, overdueAfterSec, repeatSchedule, transitionEffects, } from '../src/index.js';
const now = new Date('2026-10-22T12:00:00Z');
const base = {
    from: 'preparing',
    to: 'ready',
    actor: 'staff_device',
    now,
    collectedAt: null,
    checkCodeMode: 'off',
    ticketCheckCode: 'AB3K',
};
const times = {
    status: 'preparing',
    readyRound: 0,
    preparingAt: now,
    readyAt: null,
    firstReadyAt: null,
    collectedAt: null,
    cancelledAt: null,
    expiredAt: null,
    acknowledgedAt: null,
    autoAlertsSent: 0,
    alertLevel: 'push',
    alertLevelAtReady: null,
};
describe('ticket transitions (§8.1)', () => {
    it('allows the main flow for staff', () => {
        expect(checkTransition(base)).toEqual({ ok: true, idempotent: false });
        expect(checkTransition({ ...base, from: 'received', to: 'ready' }).ok).toBe(true);
        expect(checkTransition({ ...base, from: 'ready', to: 'collected' }).ok).toBe(true);
    });
    it('treats a transition to the current status as idempotent (TR-TKT-02)', () => {
        expect(checkTransition({ ...base, from: 'ready', to: 'ready' })).toEqual({ ok: true, idempotent: true });
    });
    it('refuses transitions not in the table', () => {
        const v = checkTransition({ ...base, from: 'cancelled', to: 'ready' });
        expect(v).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
        expect(checkTransition({ ...base, from: 'preparing', to: 'expired' }).ok).toBe(false); // only system
        expect(checkTransition({ ...base, from: 'preparing', to: 'expired', actor: 'system' }).ok).toBe(true);
    });
    it('lets only devices, users and support reopen, within 30 minutes (BR-22)', () => {
        const reopen = { ...base, from: 'collected', to: 'ready', collectedAt: new Date(now.getTime() - 29 * 60_000) };
        expect(checkTransition(reopen).ok).toBe(true);
        expect(checkTransition({ ...reopen, actor: 'api_key' }).ok).toBe(false);
        expect(checkTransition({ ...reopen, collectedAt: new Date(now.getTime() - 31 * 60_000) })).toMatchObject({
            ok: false,
            code: 'REOPEN_WINDOW_PASSED',
        });
    });
    it('requires a cancel reason', () => {
        expect(checkTransition({ ...base, to: 'cancelled' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
        expect(checkTransition({ ...base, to: 'cancelled', cancelReason: 'refunded' }).ok).toBe(true);
    });
    it('enforces mandatory check codes on the board but not the integration API (BR-15)', () => {
        const collect = { ...base, from: 'ready', to: 'collected', checkCodeMode: 'mandatory' };
        expect(checkTransition(collect)).toMatchObject({ ok: false, code: 'CHECK_CODE_REQUIRED' });
        expect(checkTransition({ ...collect, suppliedCheckCode: 'zzzz' })).toMatchObject({ ok: false, code: 'CHECK_CODE_INVALID' });
        expect(checkTransition({ ...collect, suppliedCheckCode: 'ab3k' }).ok).toBe(true);
        expect(checkTransition({ ...collect, actor: 'api_key', viaIntegrationApi: true }).ok).toBe(true);
        expect(checkTransition({ ...collect, checkCodeMode: 'optional' }).ok).toBe(true);
    });
    it('lists buttons per actor', () => {
        expect(allowedTargets('ready', 'staff_device').sort()).toEqual(['cancelled', 'collected', 'preparing']);
        expect(allowedTargets('collected', 'api_key')).toEqual([]);
    });
});
describe('transition side effects', () => {
    it('starts alerts on entering ready and records the level at ready', () => {
        const e = transitionEffects(times, 'ready', now);
        expect(e.startAlerts).toBe(true);
        expect(e.webhook).toBe('ticket.ready');
        expect(e.patch).toMatchObject({ readyRound: 1, autoAlertsSent: 0, acknowledgedAt: null, alertLevelAtReady: 'push', firstReadyAt: now });
    });
    it('marks undo and stops alerts on ready → preparing', () => {
        const e = transitionEffects({ ...times, status: 'ready', readyRound: 1 }, 'preparing', now);
        expect(e.kind).toBe('undo');
        expect(e.stopsAlerts).toBe(true);
        expect(e.patch.preparingAt).toBeUndefined();
    });
    it('reopens without automatic alerts and keeps first_ready_at', () => {
        const first = new Date('2026-10-22T11:00:00Z');
        const e = transitionEffects({ ...times, status: 'collected', readyRound: 1, firstReadyAt: first, collectedAt: now }, 'ready', now);
        expect(e.kind).toBe('reopen');
        expect(e.startAlerts).toBe(false);
        expect(e.patch.collectedAt).toBeNull();
        expect(e.patch.firstReadyAt).toBeUndefined();
        expect(e.patch.readyRound).toBe(2);
    });
});
describe('customer actions and repeats', () => {
    it('acknowledges only while ready, once per round', () => {
        expect(canAcknowledge('ready', null)).toBe('ok');
        expect(canAcknowledge('ready', now)).toBe('idempotent');
        expect(canAcknowledge('preparing', null)).toBe('invalid');
        expect(canRate('collected', false)).toBe(true);
        expect(canRate('collected', true)).toBe(false);
    });
    it('limits repeats to maxAutoAlerts − 1 and flags overdue 60 s after the last', () => {
        expect(repeatSchedule([120, 300], 3)).toEqual([120, 300]);
        expect(repeatSchedule([120, 300], 2)).toEqual([120]);
        expect(repeatSchedule([120, 300], 1)).toEqual([]);
        expect(overdueAfterSec([120, 300], 3)).toBe(360);
        expect(overdueAfterSec([120, 300], 1)).toBe(60);
    });
});

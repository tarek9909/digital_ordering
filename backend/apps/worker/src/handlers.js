import { createHash } from 'node:crypto';
import { JOB_SCHEMAS } from '@dop/jobs';
import { autoCloseVenue, buildExport, deliverWebhook, fanOutWebhook, fetchPoster, expireClaims, expireSupport, maintainPartitions, platformDailyRollup, releaseOldSlugs, weeklySummaries, getEmailTemplate, firstAlert, graceCheck, integrityCheck, jobIds, resumePurges, sweepWebhookDeliveries, markDeleted, overdueFlag, processDeletionWindow, purgeTenant, pushCleanup, reconcileAlerts, reconcilePresence, relayOutbox, renderEmail, repeatAlert, retentionMisc, retentionTickets, rollupTargets, rollupVenueDay, trialCheck, venuesDueForAutoClose, } from '@dop/services';
export const JOB_HANDLERS = {
    'push.send': (d, raw) => firstAlert(d, d.push, JOB_SCHEMAS['push.send'].parse(raw)),
    'alert.repeat': (d, raw) => repeatAlert(d, d.push, JOB_SCHEMAS['alert.repeat'].parse(raw)),
    'alert.overdue-flag': (d, raw) => overdueFlag(d, JOB_SCHEMAS['alert.overdue-flag'].parse(raw)),
    'email.send': async (d, raw) => {
        const j = JOB_SCHEMAS['email.send'].parse(raw);
        // Console-edited texts override the built-in subject and blocks (TR-EML-03).
        const override = await getEmailTemplate(d, j.template, j.locale);
        const r = renderEmail(j.template, j.locale, j.data, override ?? undefined);
        await d.mailer.send({ to: j.to, ...r });
    },
    'tenant.export': async (d, raw) => {
        const j = JOB_SCHEMAS['tenant.export'].parse(raw);
        await buildExport(d, j.tenantId, j.exportId, d.storage);
    },
    'tenant.purge': async (d, raw) => {
        const { tenantId } = JOB_SCHEMAS['tenant.purge'].parse(raw);
        // A failure fails the job, which retries; the purge sweep re-enqueues it after the retries run out.
        await purgeTenant(d, tenantId, d.storage);
    },
    'image.process-logo': async () => undefined, // logos are processed in the upload request (see services/assets.ts)
    'webhook.fanout': async (d, raw) => {
        const j = JOB_SCHEMAS['webhook.fanout'].parse(raw);
        // Stable event ID per outbox row, so a re-processed row does not create a second event (TR-WH-02).
        const h = createHash('sha256').update(j.eventKey).digest('hex');
        const eventId = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
        const ids = await fanOutWebhook(d, j.tenantId, j.venueId, j.type, j.data, eventId);
        for (const id of ids)
            await d.jobs.add('webhook.deliver', { tenantId: j.tenantId, deliveryId: id }, { jobId: jobIds.webhookDeliver(id) });
    },
    'webhook.deliver': async (d, raw) => {
        const j = JOB_SCHEMAS['webhook.deliver'].parse(raw);
        const r = await deliverWebhook(d, j.tenantId, j.deliveryId, fetchPoster);
        if (r.status === 'failed' && r.nextAttemptAt) {
            const attempt = Math.round((r.nextAttemptAt.getTime() - d.now().getTime()) / 1000);
            await d.jobs.add('webhook.deliver', j, { jobId: jobIds.webhookDeliver(j.deliveryId, r.nextAttemptAt.getTime()), delayMs: Math.max(0, attempt * 1000) });
        }
    },
};
/** Repeatable maintenance jobs (§18) run by the scheduler leader. Name → handler and cadence. */
export const SCHEDULE = [
    {
        name: 'venues.autoclose-sweep',
        every: 60_000,
        run: async (d) => {
            let n = 0;
            for (const v of await venuesDueForAutoClose(d))
                n += await autoCloseVenue(d, v.tenant_id, v.id);
            return n;
        },
    },
    { name: 'alert.reconcile', every: 60_000, run: (d) => reconcileAlerts(d) },
    { name: 'presence.reconcile', every: 30_000, run: (d) => reconcilePresence(d) },
    { name: 'claims.expire', every: 60_000, run: (d) => expireClaims(d) },
    { name: 'support.expire', every: 60_000, run: (d) => expireSupport(d) },
    { name: 'reports.weekly-email', pattern: '0 * * * *', run: (d) => weeklySummaries(d) },
    { name: 'reports.platform-daily', pattern: '0 1 * * *', run: (d) => platformDailyRollup(d, new Date(d.now().getTime() - 86_400_000).toISOString().slice(0, 10)) },
    { name: 'partitions.maintain', pattern: '30 0 * * *', run: (d) => maintainPartitions(d) },
    { name: 'push.cleanup', every: 3_600_000, run: (d) => pushCleanup(d) },
    { name: 'billing.grace-check', every: 15 * 60_000, run: (d) => graceCheck(d) },
    { name: 'webhooks.sweep', every: 5 * 60_000, run: (d) => sweepWebhookDeliveries(d) },
    { name: 'tenants.purge-resume', every: 3_600_000, run: (d) => resumePurges(d) },
    { name: 'tenants.trial-check', every: 15 * 60_000, run: (d) => trialCheck(d) },
    { name: 'tenants.deletion-window', every: 15 * 60_000, run: (d) => processDeletionWindow(d) },
    {
        name: 'tenants.purge-check',
        pattern: '0 2 * * *',
        run: async (d) => {
            const due = await d.db.platform().selectFrom('tenants').select(['id']).where('purge_after', '<', d.now()).where('status', 'in', ['trial_expired', 'cancelled']).execute();
            for (const t of due)
                await markDeleted(d, t.id, { kind: 'system' });
            return due.length;
        },
    },
    {
        name: 'reports.rollup-hour',
        pattern: '5 * * * *',
        run: async (d) => {
            let n = 0;
            for (const t of await rollupTargets(d))
                n += await rollupVenueDay(d, t.tenantId, t.venueId, t.businessDate);
            return n;
        },
    },
    { name: 'retention.tickets', pattern: '0 3 * * *', run: (d) => retentionTickets(d) },
    {
        name: 'retention.misc',
        pattern: '30 3 * * *',
        run: async (d) => {
            await retentionMisc(d, d.storage);
            await releaseOldSlugs(d);
        },
    },
    { name: 'integrity.tenant-check', pattern: '30 4 * * *', run: (d) => integrityCheck(d) },
];
export { relayOutbox };

import { json, sql } from '@dop/db';
import { PUSH_MAX_CONSECUTIVE_FAILURES, classifyPushResult, messagesFor, overdueAfterSec, repeatSchedule } from '@dop/domain';
import { EVENTS_CHANNEL, keys } from './kv.js';
import { jobIds } from './outbox.js';
import { loadVenueRow } from './projections.js';
import { recomputeAlertLevel } from './tickets.js';
const PUSH_TEXT = {
    ar: { title: (v, n) => `${v}: طلبك رقم ${n} جاهز`, body: 'تفضّل باستلامه' },
    en: { title: (v, n) => `${v}: order ${n} is ready`, body: 'Please collect it' },
};
async function publish(deps, e) {
    await deps.kv.publish(EVENTS_CHANNEL, JSON.stringify({ outboxId: 0, ...e }));
}
/** Attempt key of an alert: '1', '2' … for automatic alerts, 'm1' … for "Alert again". */
export const alertAttemptKey = (d) => (d.manual ? `m${d.attempt}` : String(d.attempt));
/** Thrown when some recipients got a retryable push-service answer; the queue retries the job (TR-ALR-09). */
export class RetryablePushError extends Error {
    pending;
    retryable = true;
    constructor(pending) {
        super(`push service unavailable for ${pending} recipient(s)`);
        this.pending = pending;
    }
}
/**
 * `push.send`: sends to every follower's active subscription and emits `ticket.alert` for live pages and the
 * display. Attempt 1 is the Ready alert; later attempts come from repeats or "Alert again".
 *
 * Retry-safe (A08, A31): each recipient's outcome is stored per attempt, so a retried job sends only to recipients
 * whose push service answered with a retryable error, and the live/display alert is published once per attempt.
 * When any recipient is still retryable, the job throws after recording everything and the queue retries it.
 */
export async function sendTicketAlert(deps, sender, d) {
    const db = deps.db.forTenant(d.tenantId);
    const t = await db.selectFrom('tickets').selectAll().where('id', '=', d.ticketId).executeTakeFirst();
    if (!t || t.status !== 'ready' || t.ready_round !== d.round)
        return { sent: 0, failed: 0, skipped: 'state' };
    if (!d.manual && t.acknowledged_at)
        return { sent: 0, failed: 0, skipped: 'acknowledged' };
    const venue = loadVenueRow(await db.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
    const attemptKey = alertAttemptKey(d);
    const at = { tenant_id: d.tenantId, ticket_id: t.id, round: d.round, attempt: attemptKey };
    await db.insertInto('alert_attempts').ignore().values(at).execute();
    const finished = new Set((await db.selectFrom('alert_deliveries').select(['subscription_id', 'outcome']).where('ticket_id', '=', t.id).where('round', '=', d.round).where('attempt', '=', attemptKey).execute())
        .filter((r) => r.outcome !== 'retry')
        .map((r) => r.subscription_id));
    const ttlSec = 600;
    const followers = await db.selectFrom('ticket_followers').select(['client_id', 'push_subscription_id', 'locale']).where('ticket_id', '=', t.id).where('push_subscription_id', 'is not', null).execute();
    const subIds = followers.map((f) => f.push_subscription_id);
    const subs = subIds.length
        ? await deps.db.platform().selectFrom('push_subscriptions').selectAll().where('id', 'in', subIds).where('revoked_at', 'is', null).execute()
        : [];
    let sent = 0;
    let failed = 0;
    let retry = 0;
    let revoked = false;
    const started = Date.now();
    const record = (subscriptionId, outcome, statusCode) => db
        .insertInto('alert_deliveries')
        .values({ ...at, subscription_id: subscriptionId, outcome, status_code: statusCode })
        .onDuplicateKeyUpdate({ outcome, status_code: statusCode, tries: sql `tries + 1` })
        .execute();
    for (const s of subs) {
        if (finished.has(s.id))
            continue; // delivered, or failed for good, on an earlier try of this attempt
        const f = followers.find((x) => x.push_subscription_id === s.id);
        const text = PUSH_TEXT[f.locale] ?? PUSH_TEXT.en;
        const msgs = messagesFor(venue.messages, f.locale, venue.locales[0] ?? 'ar');
        const payload = JSON.stringify({
            v: 1,
            type: 'ticket.ready',
            ticketToken: t.token,
            title: text.title(venue.row.name, t.display_number),
            body: msgs.collection ?? text.body,
            icon: venue.row.logo_key ? `${deps.config.cdnBaseUrl}/${venue.row.logo_key}` : undefined,
            tag: `ticket-${t.token}`,
            renotify: true,
            round: d.round,
            attempt: d.attempt,
        });
        let status;
        try {
            status = await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }, payload, ttlSec, topic: `t${t.id.replace(/-/g, '').slice(0, 30)}` });
        }
        catch (e) {
            status = e.statusCode ?? 599;
        }
        const verdict = classifyPushResult(status);
        const pdb = deps.db.platform();
        if (verdict === 'success') {
            sent++;
            await pdb.updateTable('push_subscriptions').set({ last_success_at: deps.now(), failure_count: 0 }).where('id', '=', s.id).execute();
            await record(s.id, 'sent', status);
        }
        else if (verdict === 'revoke') {
            failed++;
            revoked = true;
            await pdb.updateTable('push_subscriptions').set({ revoked_at: deps.now() }).where('id', '=', s.id).execute();
            await record(s.id, 'gone', status);
        }
        else {
            failed++;
            if (verdict === 'payload_bug')
                deps.log.error({ ticketId: t.id }, 'push payload too large');
            const n = s.failure_count + 1;
            await pdb
                .updateTable('push_subscriptions')
                .set({ failure_count: n, ...(n >= PUSH_MAX_CONSECUTIVE_FAILURES && { revoked_at: deps.now() }) })
                .where('id', '=', s.id)
                .execute();
            if (n >= PUSH_MAX_CONSECUTIVE_FAILURES)
                revoked = true;
            const again = verdict === 'retry' && n < PUSH_MAX_CONSECUTIVE_FAILURES;
            if (again)
                retry++;
            await record(s.id, again ? 'retry' : 'gone', status);
        }
    }
    // TR-NFR-02: time from job start to hand-off, exported as push_handoff_seconds by the worker.
    deps.log.info({ metric: 'push_handoff_seconds', value: (Date.now() - started) / 1000, sent, failed, retry }, 'push sent');
    // Live pages and the display alert once per attempt, also when push delivery is retried.
    const live = await db.selectFrom('alert_attempts').select('live_published_at').where('ticket_id', '=', t.id).where('round', '=', d.round).where('attempt', '=', attemptKey).executeTakeFirst();
    if (!live?.live_published_at) {
        await publish(deps, {
            topic: 'ticket.alert',
            tenantId: d.tenantId,
            venueId: t.venue_id,
            ticketId: t.id,
            token: t.token,
            payload: { token: t.token, id: t.id, displayNumber: t.display_number, round: d.round, attempt: d.attempt, manual: d.manual },
        });
        await db.updateTable('alert_attempts').set({ live_published_at: deps.now() }).where('ticket_id', '=', t.id).where('round', '=', d.round).where('attempt', '=', attemptKey).execute();
    }
    if (revoked)
        await recomputeAlertLevel(deps, d.tenantId, t.id);
    if (retry > 0)
        throw new RetryablePushError(retry);
    return { sent, failed };
}
/** `alert.repeat` (TR-ALR-20): acts only when status = ready, the round matches and nobody acknowledged. */
export async function repeatAlert(deps, sender, d) {
    const db = deps.db.forTenant(d.tenantId);
    const t = await db.selectFrom('tickets').select(['status', 'ready_round', 'acknowledged_at', 'auto_alerts_sent', 'tenant_id', 'id']).where('id', '=', d.ticketId).executeTakeFirst();
    if (!t || t.status !== 'ready' || t.ready_round !== d.round || t.acknowledged_at)
        return { skipped: true };
    // n counts automatic alerts including the first. The counter and event are written once (the claim); a retried
    // job finds its own claim and continues the same attempt, which sends only to recipients not yet delivered (A08).
    const r = await db
        .updateTable('tickets')
        .set({ auto_alerts_sent: d.n, seq: sql `seq + 1` })
        .where('id', '=', d.ticketId)
        .where('auto_alerts_sent', '<', d.n)
        .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
        // Only the attempt that was claimed last may continue; a later repeat supersedes older ones.
        if (t.auto_alerts_sent !== d.n)
            return { skipped: true };
    }
    else {
        await db.insertInto('ticket_events').values({ tenant_id: d.tenantId, ticket_id: d.ticketId, type: 'alert_auto', actor_type: 'system', actor_id: null, data: json({ round: d.round, n: d.n }) }).execute();
    }
    return sendTicketAlert(deps, sender, { tenantId: d.tenantId, ticketId: d.ticketId, round: d.round, attempt: d.n, manual: false });
}
/** First alert counts as automatic alert 1. */
export async function firstAlert(deps, sender, d) {
    if (!d.manual && d.attempt === 1) {
        await deps.db.forTenant(d.tenantId).updateTable('tickets').set({ auto_alerts_sent: 1 }).where('id', '=', d.ticketId).where('ready_round', '=', d.round).where('auto_alerts_sent', '<', 1).execute();
    }
    return sendTicketAlert(deps, sender, d);
}
/** `alert.overdue-flag` (TR-ALR-21): marks the board card "not collected — call out". No status change. */
export async function overdueFlag(deps, d) {
    const t = await deps.db.forTenant(d.tenantId).selectFrom('tickets').select(['status', 'ready_round', 'acknowledged_at', 'venue_id']).where('id', '=', d.ticketId).executeTakeFirst();
    if (!t || t.status !== 'ready' || t.ready_round !== d.round)
        return false;
    await publish(deps, { topic: 'ticket.overdue', tenantId: d.tenantId, venueId: t.venue_id, ticketId: d.ticketId, payload: { id: d.ticketId, round: d.round } });
    return true;
}
/**
 * `alert.reconcile` every minute (TR-JOB-05): ready, unacknowledged tickets whose next automatic alert is more
 * than 30 s overdue get the missing repeat job (deterministic ID), so repeats survive loss of the queue store.
 */
export async function reconcileAlerts(deps) {
    const rows = await deps.db
        .platform()
        .selectFrom('tickets')
        .innerJoin('venues', 'venues.id', 'tickets.venue_id')
        .select(['tickets.id', 'tickets.tenant_id', 'tickets.ready_round', 'tickets.ready_at', 'tickets.auto_alerts_sent', 'venues.settings'])
        .where('tickets.status', '=', 'ready')
        .where('tickets.acknowledged_at', 'is', null)
        .where('tickets.ready_at', 'is not', null)
        .limit(5000)
        .execute();
    let enqueued = 0;
    const now = deps.now().getTime();
    for (const r of rows) {
        const v = loadVenueRow({ settings: r.settings });
        const offsets = repeatSchedule(v.settings.alerts.repeatOffsetsSec, v.settings.alerts.maxAutoAlerts);
        const nextIndex = Math.max(0, r.auto_alerts_sent - 1); // repeats already sent
        const off = offsets[nextIndex];
        if (r.auto_alerts_sent === 0) {
            if (now - r.ready_at.getTime() > 30_000) {
                // A reopened ticket gets no automatic alerts (§8.1); only a normal entry into ready does.
                const last = await deps.db
                    .forTenant(r.tenant_id)
                    .selectFrom('ticket_events')
                    .select('data')
                    .where('ticket_id', '=', r.id)
                    .where('type', '=', 'transition')
                    .where('to_status', '=', 'ready')
                    .orderBy('id', 'desc')
                    .limit(1)
                    .executeTakeFirst();
                if (last?.data?.reopen)
                    continue;
                await deps.jobs.add('push.send', { tenantId: r.tenant_id, ticketId: r.id, round: r.ready_round, attempt: 1, manual: false }, { jobId: jobIds.push(r.id, r.ready_round, 1) });
                enqueued++;
            }
            continue;
        }
        if (off === undefined) {
            const overdueAt = r.ready_at.getTime() + overdueAfterSec(v.settings.alerts.repeatOffsetsSec, v.settings.alerts.maxAutoAlerts) * 1000;
            if (now - overdueAt > 30_000)
                await deps.jobs.add('alert.overdue-flag', { tenantId: r.tenant_id, ticketId: r.id, round: r.ready_round }, { jobId: jobIds.overdue(r.id, r.ready_round) });
            continue;
        }
        if (now - (r.ready_at.getTime() + off * 1000) > 30_000) {
            const n = r.auto_alerts_sent + 1;
            await deps.jobs.add('alert.repeat', { tenantId: r.tenant_id, ticketId: r.id, round: r.ready_round, n }, { jobId: jobIds.repeat(r.id, r.ready_round, n) });
            enqueued++;
        }
    }
    return enqueued;
}
// ---------------------------------------------------------------- presence (TR-ALG-12, TR-ALG-13)
export const PRESENCE_TTL = 60;
/** Heartbeat from a visible page (or one with running audio): sets the presence key; recomputes on gain only. */
export async function heartbeat(deps, tenantId, ticketId, clientId) {
    const fresh = await deps.kv.setNx(keys.presence(ticketId, clientId), '1', PRESENCE_TTL);
    if (!fresh) {
        await deps.kv.set(keys.presence(ticketId, clientId), '1', PRESENCE_TTL);
        return;
    }
    await deps.kv.set(keys.wasLive(ticketId, clientId), '1', 2 * 86400);
    await recomputeAlertLevel(deps, tenantId, ticketId);
}
/** Presence key expired (keyspace notification) → level may drop to closed. */
export async function presenceExpired(deps, key) {
    const m = /^pres:([0-9a-f-]{36}):/.exec(key);
    if (!m)
        return;
    const row = await deps.db.platform().selectFrom('tickets').select(['tenant_id', 'status']).where('id', '=', m[1]).executeTakeFirst();
    if (row && ['received', 'preparing', 'ready'].includes(row.status))
        await recomputeAlertLevel(deps, row.tenant_id, m[1]);
}
/** `presence.reconcile` every 30 s: recompute levels of open tickets shown live whose presence keys are gone. */
export async function reconcilePresence(deps) {
    const rows = await deps.db.platform().selectFrom('tickets').select(['id', 'tenant_id']).where('status', 'in', ['received', 'preparing', 'ready']).where('alert_level', '=', 'live').limit(5000).execute();
    for (const r of rows)
        await recomputeAlertLevel(deps, r.tenant_id, r.id);
    return rows.length;
}
// ---------------------------------------------------------------- cleanup and retention (TR-PRV-03 – TR-PRV-05)
/** `push.cleanup` hourly: subscriptions with no open ticket and none inside the 30-minute reopen window. */
export async function pushCleanup(deps) {
    const cutoff = new Date(deps.now().getTime() - 30 * 60_000);
    const r = await sql `
    DELETE ps FROM push_subscriptions ps
    WHERE NOT EXISTS (
      SELECT 1 FROM ticket_followers f JOIN tickets t ON t.tenant_id = f.tenant_id AND t.id = f.ticket_id
      WHERE f.push_subscription_id = ps.id
        AND (t.status IN ('received','preparing','ready') OR (t.status = 'collected' AND t.collected_at > ${cutoff}))
    )`.execute(deps.db.platform());
    return Number(r.numAffectedRows ?? 0);
}
/** Push subscription IDs used by the followers of a tenant or of some tickets (L-14). */
export async function followerSubscriptionIds(db, f) {
    if (f.ticketIds && f.ticketIds.length === 0)
        return [];
    let q = db.selectFrom('ticket_followers').select('push_subscription_id').distinct().where('push_subscription_id', 'is not', null);
    if (f.tenantId)
        q = q.where('tenant_id', '=', f.tenantId);
    if (f.ticketIds)
        q = q.where('ticket_id', 'in', f.ticketIds);
    return (await q.execute()).map((r) => r.push_subscription_id);
}
/**
 * Deletes the given push subscriptions that no ticket follower references any more (L-14). A subscription is per
 * phone browser and can serve several tenants, so one still followed through another tenant's ticket stays; the
 * hourly `push.cleanup` removes it once none of its tickets is open.
 */
export async function deleteOrphanSubscriptions(db, ids) {
    let n = 0;
    for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        const r = await sql `
      DELETE ps FROM push_subscriptions ps
      WHERE ps.id IN (${sql.join(chunk)})
        AND NOT EXISTS (SELECT 1 FROM ticket_followers f WHERE f.push_subscription_id = ps.id)`.execute(db);
        n += Number(r.numAffectedRows ?? 0);
    }
    return n;
}
/** `retention.tickets` daily: delete tickets > 90 days once their roll-up exists (TR-PRV-04), child-first. */
export async function retentionTickets(deps, days = 90) {
    const db = deps.db.platform();
    const cutoff = new Date(deps.now().getTime() - days * 86_400_000);
    let total = 0;
    for (;;) {
        const batch = await db
            .selectFrom('tickets as t')
            .select(['t.id', 't.tenant_id'])
            .where('t.created_at', '<', cutoff)
            .where(({ exists, selectFrom }) => exists(selectFrom('report_daily as r').select('r.tenant_id').whereRef('r.tenant_id', '=', 't.tenant_id').whereRef('r.venue_id', '=', 't.venue_id').whereRef('r.business_date', '=', 't.business_date').where('r.hour_local', '=', 24)))
            .limit(5000)
            .execute();
        if (batch.length === 0)
            break;
        const ids = batch.map((b) => b.id);
        const subIds = await followerSubscriptionIds(db, { ticketIds: ids });
        // Alert attempt/delivery records of the deleted tickets go with them (L-14).
        for (const table of ['ticket_events', 'ticket_followers', 'claim_requests', 'ratings', 'alert_deliveries', 'alert_attempts']) {
            await db.deleteFrom(table).where('ticket_id', 'in', ids).execute();
        }
        await db.deleteFrom('tickets').where('id', 'in', ids).execute();
        // Subscriptions those followers used that no remaining follower (any tenant) uses any more (L-14).
        await deleteOrphanSubscriptions(db, subIds);
        total += ids.length;
        if (batch.length < 5000)
            break;
    }
    return total;
}
/** Deletes matching rows in batches of ≤ 5,000, each its own statement (TR-PRV-12). */
async function deleteInBatches(run) {
    let total = 0;
    for (;;) {
        const n = Number((await run()).numDeletedRows);
        total += n;
        if (n < 5000)
            return total;
    }
}
/**
 * `retention.misc` daily (§18, W08): idempotency keys > 24 h, email tokens, expired sessions, webhook deliveries
 * > 30 d, exports > 7 d (files too), published outbox rows > 7 d, alert delivery records
 * > 7 d, and audit and support records past their 2-year retention (TR-PRV-06).
 */
export async function retentionMisc(deps, storage) {
    const db = deps.db.platform();
    const now = deps.now().getTime();
    const ago = (d) => new Date(now - d * 86_400_000);
    const out = {};
    out.email_tokens = await deleteInBatches(() => db.deleteFrom('email_tokens').where('expires_at', '<', ago(1)).limit(5000).executeTakeFirst());
    out.user_sessions = await deleteInBatches(() => db.deleteFrom('user_sessions').where('expires_at', '<', ago(1)).limit(5000).executeTakeFirst());
    out.platform_sessions = await deleteInBatches(() => db.deleteFrom('platform_sessions').where('expires_at', '<', ago(1)).limit(5000).executeTakeFirst());
    out.outbox = await deleteInBatches(() => db.deleteFrom('outbox').where('published_at', '<', ago(7)).limit(5000).executeTakeFirst());
    // Dead-lettered rows (L-18) are kept 30 days for inspection.
    out.outbox_parked = await deleteInBatches(() => db.deleteFrom('outbox').where('parked_at', '<', ago(30)).limit(5000).executeTakeFirst());
    out.idempotency_keys = await deleteInBatches(() => db.deleteFrom('idempotency_keys').where('created_at', '<', new Date(now - 86_400_000)).limit(5000).executeTakeFirst());
    out.webhook_deliveries = await deleteInBatches(() => db.deleteFrom('webhook_deliveries').where('created_at', '<', ago(30)).where('status', 'in', ['succeeded', 'failed', 'abandoned']).limit(5000).executeTakeFirst());
    out.alert_deliveries = await deleteInBatches(() => db.deleteFrom('alert_deliveries').where('updated_at', '<', ago(7)).limit(5000).executeTakeFirst());
    out.alert_attempts = await deleteInBatches(() => db.deleteFrom('alert_attempts').where('created_at', '<', ago(7)).limit(5000).executeTakeFirst());
    out.audit_log = await deleteInBatches(() => db.deleteFrom('audit_log').where('occurred_at', '<', ago(730)).limit(5000).executeTakeFirst());
    out.support_sessions = await deleteInBatches(() => db.deleteFrom('support_sessions').where('status', 'in', ['ended', 'expired', 'refused', 'cancelled']).where('requested_at', '<', ago(730)).limit(5000).executeTakeFirst());
    // Exports: links stop after 7 days; the files go too.
    await db.updateTable('data_exports').set({ status: 'expired' }).where('status', '=', 'ready').where('expires_at', '<', new Date(now)).execute();
    const files = await db.selectFrom('data_exports').select(['id', 'file_key']).where('status', '=', 'expired').where('file_key', 'is not', null).limit(1000).execute();
    out.export_files = 0;
    for (const f of files) {
        if (!storage)
            break;
        try {
            await storage.deletePrefix('exports', f.file_key);
        }
        catch (err) {
            // Keep the pointer so the next run retries; never forget a file the store did not confirm deleted (M-20).
            deps.log.warn({ err, exportId: f.id }, 'expired export file not deleted; will retry');
            continue;
        }
        await db.updateTable('data_exports').set({ file_key: null }).where('id', '=', f.id).execute();
        out.export_files++;
    }
    return out;
}
/** `integrity.tenant-check` daily (TR-TEN-09): child rows whose tenant differs from the parent's. Pages on-call. */
export async function integrityCheck(deps) {
    const db = deps.db.platform();
    const checks = [
        ['ticket_events→tickets', sql `SELECT COUNT(*) AS n FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id WHERE t.tenant_id <> e.tenant_id`],
        ['ticket_followers→tickets', sql `SELECT COUNT(*) AS n FROM ticket_followers f JOIN tickets t ON t.id = f.ticket_id WHERE t.tenant_id <> f.tenant_id`],
        ['tickets→venues', sql `SELECT COUNT(*) AS n FROM tickets t JOIN venues v ON v.id = t.venue_id WHERE v.tenant_id <> t.tenant_id`],
        ['staff_devices→venues', sql `SELECT COUNT(*) AS n FROM staff_devices d JOIN venues v ON v.id = d.venue_id WHERE v.tenant_id <> d.tenant_id`],
        ['displays→venues', sql `SELECT COUNT(*) AS n FROM displays d JOIN venues v ON v.id = d.venue_id WHERE v.tenant_id <> d.tenant_id`],
        ['counters→venues', sql `SELECT COUNT(*) AS n FROM counters c JOIN venues v ON v.id = c.venue_id WHERE v.tenant_id <> c.tenant_id`],
    ];
    const out = [];
    for (const [name, q] of checks) {
        const r = await q.execute(db);
        const n = Number(r.rows[0]?.n ?? 0);
        out.push({ check: name, rows: n });
        if (n > 0)
            deps.log.error({ security: true, event: 'TENANT_INTEGRITY', check: name, rows: n }, 'tenant integrity mismatch');
    }
    return out;
}

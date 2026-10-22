import { json, sql } from '@dop/db';
import { overdueAfterSec, repeatSchedule } from '@dop/domain';
import { jobId } from '@dop/jobs';
import { EVENTS_CHANNEL } from './kv.js';
/** Topic of rows that only carry queue jobs; they publish no bus event. */
export const JOBS_TOPIC = 'jobs';
/** Deterministic queue job IDs (TR-ALR-19). BullMQ forbids ':' in custom IDs, see `jobId`. */
export const jobIds = {
    push: (ticketId, round, attempt) => jobId('push', ticketId, round, attempt),
    manualPush: (ticketId, round, attempt) => jobId('push', ticketId, round, `m${attempt}`),
    repeat: (ticketId, round, n) => jobId('repeat', ticketId, round, n),
    overdue: (ticketId, round) => jobId('overdue', ticketId, round),
    webhookFanout: (outboxId) => jobId('whf', outboxId),
    webhookDeliver: (deliveryId, attemptKey = 1) => jobId('whd', deliveryId, attemptKey),
    email: (messageKey) => jobId('email', messageKey),
    export: (exportId) => jobId('export', exportId),
    /** Bucketed by hour so a dead-lettered purge can be enqueued again by the purge sweep (A30). */
    purge: (tenantId, bucket) => jobId('purge', tenantId, bucket),
    /** Bucketed by 10 minutes so an unfinished event is enqueued again on redelivery or by the sweep (A09). */
};
export async function addOutbox(tx, topic, tenantId, payload) {
    const r = await tx.insertInto('outbox').values({ tenant_id: tenantId, topic, payload: json(payload) }).executeTakeFirstOrThrow();
    return Number(r.insertId);
}
/**
 * Durable enqueue. Inside a transaction (`tx`), the jobs commit with the caller's change and the caller flushes the
 * returned outbox id after commit (or the relay does). Without one, the row is written and flushed at once; if the
 * queue is down the call still succeeds and the relay enqueues later.
 */
export async function enqueueJobs(deps, jobs, tx, tenantId = null) {
    const target = tx ?? deps.db.platform();
    const r = await target.insertInto('outbox').values({ tenant_id: tenantId, topic: JOBS_TOPIC, payload: json({ emit: {}, jobs }) }).executeTakeFirstOrThrow();
    const id = Number(r.insertId);
    if (!tx)
        await flushOutbox(deps, [id]);
    return id;
}
/** The queue jobs a row stands for. */
export function outboxJobs(row) {
    const p = row.payload;
    const out = [...(p.jobs ?? [])];
    if (p.alertStart && row.tenant_id) {
        const a = p.alertStart;
        const base = { tenantId: row.tenant_id, ticketId: a.ticketId, round: a.round };
        out.push({ name: 'push.send', data: { ...base, attempt: 1, manual: false }, opts: { jobId: jobIds.push(a.ticketId, a.round, 1) } });
        const offsets = repeatSchedule(a.repeatOffsetsSec, a.maxAutoAlerts);
        for (const [i, off] of offsets.entries()) {
            out.push({ name: 'alert.repeat', data: { ...base, n: i + 2 }, opts: { jobId: jobIds.repeat(a.ticketId, a.round, i + 2), delayMs: off * 1000 } });
        }
        out.push({ name: 'alert.overdue-flag', data: base, opts: { jobId: jobIds.overdue(a.ticketId, a.round), delayMs: overdueAfterSec(a.repeatOffsetsSec, a.maxAutoAlerts) * 1000 } });
    }
    if (p.manualAlert && row.tenant_id) {
        const m = p.manualAlert;
        out.push({
            name: 'push.send',
            data: { tenantId: row.tenant_id, ticketId: m.ticketId, round: m.round, attempt: m.attempt, manual: true },
            opts: { jobId: jobIds.manualPush(m.ticketId, m.round, m.attempt) },
        });
    }
    if (p.webhook && row.tenant_id) {
        out.push({
            name: 'webhook.fanout',
            data: { tenantId: row.tenant_id, venueId: p.venueId ?? null, type: p.webhook.type, eventKey: `ob${row.id}`, data: p.webhook.data },
            opts: { jobId: jobIds.webhookFanout(row.id) },
        });
    }
    return out;
}
export function outboxEvent(row) {
    if (row.topic === JOBS_TOPIC)
        return null;
    const p = row.payload;
    return { outboxId: row.id, topic: row.topic, tenantId: row.tenant_id, venueId: p.venueId, ticketId: p.ticketId, token: p.token, payload: p.emit };
}
/** Processes one row's remaining stages; marks each stage as it completes. Throws when a stage fails. */
export async function processOutboxRow(deps, row) {
    const db = deps.db.platform();
    const event = outboxEvent(row);
    if (event && !row.event_published_at) {
        await deps.kv.publish(EVENTS_CHANNEL, JSON.stringify(event));
        await db.updateTable('outbox').set({ event_published_at: sql `CURRENT_TIMESTAMP(3)` }).where('id', '=', row.id).execute();
    }
    for (const j of outboxJobs(row))
        await deps.jobs.add(j.name, j.data, j.opts);
    await db.updateTable('outbox').set({ published_at: sql `CURRENT_TIMESTAMP(3)`, last_error: null }).where('id', '=', row.id).execute();
}
/** Seconds before a failed row is tried again: 2, 4, 8 … capped at 5 minutes. */
export const outboxBackoffSec = (attempts) => Math.min(300, 2 ** Math.max(1, attempts));
/**
 * Dead-letter policy (L-18): a row is parked once it has failed OUTBOX_MAX_ATTEMPTS times AND is older than
 * OUTBOX_PARK_MIN_AGE_MS. The age floor keeps ordinary transient failures (a queue or Redis outage of up to a day,
 * during which every row fails) on normal retry; only rows that keep failing beyond that stop occupying the relay.
 * Parked rows keep payload and last_error, are logged at error level (OUTBOX_PARKED), and are released by
 * clearing parked_at; they are deleted after 30 days by `retention.misc`.
 */
export const OUTBOX_MAX_ATTEMPTS = 30;
export const OUTBOX_PARK_MIN_AGE_MS = 24 * 3600_000;
export const shouldParkOutboxRow = (attempts, createdAt, now = Date.now()) => attempts >= OUTBOX_MAX_ATTEMPTS && now - createdAt.getTime() >= OUTBOX_PARK_MIN_AGE_MS;
/** After commit: process the given rows. Each failure is recorded on its row and left for the relay. */
export async function flushOutbox(deps, ids) {
    if (ids.length === 0)
        return;
    const db = deps.db.platform();
    let rows;
    try {
        rows = await db.selectFrom('outbox').selectAll().where('id', 'in', ids).where('published_at', 'is', null).where('parked_at', 'is', null).orderBy('id').execute();
    }
    catch (err) {
        deps.log.warn({ err, ids }, 'outbox read failed; relay will retry');
        return;
    }
    for (const r of rows) {
        try {
            await processOutboxRow(deps, { id: r.id, tenant_id: r.tenant_id, topic: r.topic, payload: r.payload, event_published_at: r.event_published_at });
        }
        catch (err) {
            const attempts = r.attempts + 1;
            const park = shouldParkOutboxRow(attempts, r.created_at);
            if (park)
                deps.log.error({ err, outboxId: r.id, topic: r.topic, tenantId: r.tenant_id, attempts, event: 'OUTBOX_PARKED' }, 'outbox row parked after repeated failures');
            else
                deps.log.warn({ err, outboxId: r.id, topic: r.topic, attempts }, 'outbox row failed; relay will retry');
            await db
                .updateTable('outbox')
                .set({
                attempts,
                last_error: String(err?.message ?? err).slice(0, 500),
                ...(park ? { parked_at: sql `CURRENT_TIMESTAMP(3)`, next_attempt_at: null } : { next_attempt_at: sql `NOW(3) + INTERVAL ${outboxBackoffSec(attempts)} SECOND` }),
            })
                .where('id', '=', r.id)
                .execute()
                .catch((e) => deps.log.warn({ err: e, outboxId: r.id }, 'outbox failure not recorded'));
        }
    }
}
/** Worker relay: rows unfinished for more than 2 s whose backoff has passed (TR-EVT-01). */
export async function relayOutbox(deps, limit = 500) {
    const db = deps.db.platform();
    const rows = await db
        .selectFrom('outbox')
        .select('id')
        .where('published_at', 'is', null)
        .where('parked_at', 'is', null)
        .where('created_at', '<', sql `NOW(3) - INTERVAL 2 SECOND`)
        .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', sql `NOW(3)`)]))
        .orderBy('id')
        .limit(limit)
        .execute();
    await flushOutbox(deps, rows.map((r) => r.id));
    return rows.length;
}

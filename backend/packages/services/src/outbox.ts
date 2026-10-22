import type { BusEvent } from '@dop/contracts';
import { json, sql, type Db, type Tx } from '@dop/db';
import { overdueAfterSec, repeatSchedule } from '@dop/domain';
import { jobId, type EnqueueOptions, type JobData, type JobName } from '@dop/jobs';
import type { Deps } from './deps.js';
import { EVENTS_CHANNEL } from './kv.js';

// Transactional outbox (TR-EVT-01). State changes write an outbox row in their transaction; after commit
// the api processes it (publish to Redis + queue jobs); the worker relay processes rows still unfinished
// after 2 s. A row has two stages: the bus event (event_published_at) and its queue jobs (published_at = done).
// A queue outage therefore never blocks realtime delivery, and a retried row does not republish its event.
// Jobs carry deterministic IDs, so a row processed twice never duplicates work (TR-ALR-19).
//
// The same table makes every other enqueue durable (A01, A09): `enqueueJobs` stores the jobs in an outbox row
// (topic `jobs`, no bus event) inside the caller's transaction when there is one, then tries to enqueue at once.

export type OutboxTopic = BusEvent['topic'];

export interface AlertStart {
  ticketId: string;
  round: number;
  repeatOffsetsSec: number[];
  maxAutoAlerts: number;
}

export interface QueuedJob<N extends JobName = JobName> {
  name: N;
  data: JobData<N>;
  opts?: EnqueueOptions;
}

export interface OutboxPayload {
  venueId?: string;
  ticketId?: string;
  token?: string;
  /** Socket fan-out data (projections), see TR-EVT-02. */
  emit: Record<string, unknown>;
  /** Present when a ticket entered ready (not on reopen): enqueue push + repeats. */
  alertStart?: AlertStart;
  /** Manual "Alert again". */
  manualAlert?: { ticketId: string; round: number; attempt: number };
  /** Outgoing webhook event (TRD §13, R2). */
  webhook?: { type: string; data: Record<string, unknown> };
  /** Queue jobs carried by the row (durable enqueue). */
  jobs?: QueuedJob[];
}

/** Topic of rows that only carry queue jobs; they publish no bus event. */
export const JOBS_TOPIC = 'jobs';

/** Deterministic queue job IDs (TR-ALR-19). BullMQ forbids ':' in custom IDs, see `jobId`. */
export const jobIds = {
  push: (ticketId: string, round: number, attempt: number) => jobId('push', ticketId, round, attempt),
  manualPush: (ticketId: string, round: number, attempt: number) => jobId('push', ticketId, round, `m${attempt}`),
  repeat: (ticketId: string, round: number, n: number) => jobId('repeat', ticketId, round, n),
  overdue: (ticketId: string, round: number) => jobId('overdue', ticketId, round),
  webhookFanout: (outboxId: number) => jobId('whf', outboxId),
  webhookDeliver: (deliveryId: number, attemptKey: number | string = 1) => jobId('whd', deliveryId, attemptKey),
  email: (messageKey: string) => jobId('email', messageKey),
  export: (exportId: string) => jobId('export', exportId),
  /** Bucketed by hour so a dead-lettered purge can be enqueued again by the purge sweep (A30). */
  purge: (tenantId: string, bucket: number) => jobId('purge', tenantId, bucket),
  /** Bucketed by 10 minutes so an unfinished event is enqueued again on redelivery or by the sweep (A09). */
};

export async function addOutbox(tx: Tx | Db, topic: OutboxTopic, tenantId: string | null, payload: OutboxPayload): Promise<number> {
  const r = await tx.insertInto('outbox').values({ tenant_id: tenantId, topic, payload: json(payload) }).executeTakeFirstOrThrow();
  return Number(r.insertId);
}

/**
 * Durable enqueue. Inside a transaction (`tx`), the jobs commit with the caller's change and the caller flushes the
 * returned outbox id after commit (or the relay does). Without one, the row is written and flushed at once; if the
 * queue is down the call still succeeds and the relay enqueues later.
 */
export async function enqueueJobs(deps: Pick<Deps, 'jobs' | 'kv' | 'db' | 'log'>, jobs: QueuedJob[], tx?: Tx | Db, tenantId: string | null = null): Promise<number> {
  const target = tx ?? deps.db.platform();
  const r = await target.insertInto('outbox').values({ tenant_id: tenantId, topic: JOBS_TOPIC, payload: json({ emit: {}, jobs } satisfies OutboxPayload) }).executeTakeFirstOrThrow();
  const id = Number(r.insertId);
  if (!tx) await flushOutbox(deps, [id]);
  return id;
}

/** The queue jobs a row stands for. */
export function outboxJobs(row: { id: number; tenant_id: string | null; payload: OutboxPayload }): QueuedJob[] {
  const p = row.payload;
  const out: QueuedJob[] = [...(p.jobs ?? [])];
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

export function outboxEvent(row: { id: number; tenant_id: string | null; topic: string; payload: OutboxPayload }): BusEvent | null {
  if (row.topic === JOBS_TOPIC) return null;
  const p = row.payload;
  return { outboxId: row.id, topic: row.topic as OutboxTopic, tenantId: row.tenant_id, venueId: p.venueId, ticketId: p.ticketId, token: p.token, payload: p.emit };
}

/** Processes one row's remaining stages; marks each stage as it completes. Throws when a stage fails. */
export async function processOutboxRow(
  deps: Pick<Deps, 'jobs' | 'kv' | 'db'>,
  row: { id: number; tenant_id: string | null; topic: string; payload: OutboxPayload; event_published_at?: Date | null },
): Promise<void> {
  const db = deps.db.platform();
  const event = outboxEvent(row);
  if (event && !row.event_published_at) {
    await deps.kv.publish(EVENTS_CHANNEL, JSON.stringify(event));
    await db.updateTable('outbox').set({ event_published_at: sql`CURRENT_TIMESTAMP(3)` as never }).where('id', '=', row.id).execute();
  }
  for (const j of outboxJobs(row)) await deps.jobs.add(j.name, j.data as never, j.opts);
  await db.updateTable('outbox').set({ published_at: sql`CURRENT_TIMESTAMP(3)` as never, last_error: null }).where('id', '=', row.id).execute();
}

/** Seconds before a failed row is tried again: 2, 4, 8 … capped at 5 minutes. */
export const outboxBackoffSec = (attempts: number) => Math.min(300, 2 ** Math.max(1, attempts));

/**
 * Dead-letter policy (L-18): a row is parked once it has failed OUTBOX_MAX_ATTEMPTS times AND is older than
 * OUTBOX_PARK_MIN_AGE_MS. The age floor keeps ordinary transient failures (a queue or Redis outage of up to a day,
 * during which every row fails) on normal retry; only rows that keep failing beyond that stop occupying the relay.
 * Parked rows keep payload and last_error, are logged at error level (OUTBOX_PARKED), and are released by
 * clearing parked_at; they are deleted after 30 days by `retention.misc`.
 */
export const OUTBOX_MAX_ATTEMPTS = 30;
export const OUTBOX_PARK_MIN_AGE_MS = 24 * 3600_000;
export const shouldParkOutboxRow = (attempts: number, createdAt: Date, now = Date.now()) => attempts >= OUTBOX_MAX_ATTEMPTS && now - createdAt.getTime() >= OUTBOX_PARK_MIN_AGE_MS;

/** After commit: process the given rows. Each failure is recorded on its row and left for the relay. */
export async function flushOutbox(deps: Pick<Deps, 'jobs' | 'kv' | 'db' | 'log'>, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = deps.db.platform();
  let rows;
  try {
    rows = await db.selectFrom('outbox').selectAll().where('id', 'in', ids).where('published_at', 'is', null).where('parked_at', 'is', null).orderBy('id').execute();
  } catch (err) {
    deps.log.warn({ err, ids }, 'outbox read failed; relay will retry');
    return;
  }
  for (const r of rows) {
    try {
      await processOutboxRow(deps, { id: r.id, tenant_id: r.tenant_id, topic: r.topic, payload: r.payload as unknown as OutboxPayload, event_published_at: r.event_published_at });
    } catch (err) {
      const attempts = r.attempts + 1;
      const park = shouldParkOutboxRow(attempts, r.created_at);
      if (park) deps.log.error({ err, outboxId: r.id, topic: r.topic, tenantId: r.tenant_id, attempts, event: 'OUTBOX_PARKED' }, 'outbox row parked after repeated failures');
      else deps.log.warn({ err, outboxId: r.id, topic: r.topic, attempts }, 'outbox row failed; relay will retry');
      await db
        .updateTable('outbox')
        .set({
          attempts,
          last_error: String((err as Error)?.message ?? err).slice(0, 500),
          ...(park ? { parked_at: sql`CURRENT_TIMESTAMP(3)` as never, next_attempt_at: null } : { next_attempt_at: sql`NOW(3) + INTERVAL ${outboxBackoffSec(attempts)} SECOND` as never }),
        })
        .where('id', '=', r.id)
        .execute()
        .catch((e: unknown) => deps.log.warn({ err: e, outboxId: r.id }, 'outbox failure not recorded'));
    }
  }
}

/** Worker relay: rows unfinished for more than 2 s whose backoff has passed (TR-EVT-01). */
export async function relayOutbox(deps: Pick<Deps, 'jobs' | 'kv' | 'db' | 'log'>, limit = 500): Promise<number> {
  const db = deps.db.platform();
  const rows = await db
    .selectFrom('outbox')
    .select('id')
    .where('published_at', 'is', null)
    .where('parked_at', 'is', null)
    .where('created_at', '<', sql<Date>`NOW(3) - INTERVAL 2 SECOND`)
    .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', sql<Date>`NOW(3)`)]))
    .orderBy('id')
    .limit(limit)
    .execute();
  await flushOutbox(deps, rows.map((r) => r.id));
  return rows.length;
}

import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Actor } from '@dop/auth';
import { decrypt, encrypt } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { json } from '@dop/db';
import { uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { isNonPublicIp } from './ip-ranges.js';
import { enqueueJobs, jobIds } from './outbox.js';
import { requireFeature } from './platform.js';

// Outgoing webhooks (TRD §13, R2; FR-INT-07/08, TR-WH-01 – TR-WH-05).

export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.ready', 'ticket.acknowledged', 'ticket.collected', 'ticket.cancelled', 'ticket.expired'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'ping';

/** Retry offsets from the first attempt: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then a final attempt at 24 h (TR-WH-02). */
export const RETRY_SCHEDULE_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000, 12 * 3600_000, 24 * 3600_000];

// ---- SSRF protection (TR-WH-04)
// Parsed range classification (L-16): only globally routable unicast destinations; see ip-ranges.ts.
export { classifyIp, ipInCidr, isNonPublicIp, mappedIPv4, parseIPv4, parseIPv6, type IpClassification } from './ip-ranges.js';
const isPrivate = isNonPublicIp;
/** URL hostnames keep IPv6 literals in brackets ("[::1]"). */
const bare = (host: string) => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);

export function checkWebhookUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Invalid URL');
  }
  if (u.protocol !== 'https:') throw new AppError('VALIDATION_FAILED', 'Webhook URLs must use https');
  if (u.port && u.port !== '443' && u.port !== '8443') throw new AppError('VALIDATION_FAILED', 'Only ports 443 and 8443 are allowed');
  if (u.username || u.password) throw new AppError('VALIDATION_FAILED', 'Credentials in the URL are not allowed');
  if (isIP(bare(u.hostname)) && isPrivate(bare(u.hostname))) throw new AppError('VALIDATION_FAILED', 'Private addresses are not allowed');
  return u;
}

/** Resolves and re-checks every address right before connecting. */
export async function resolvePublic(host: string, resolver: (h: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<string> {
  const h = bare(host);
  const addrs = isIP(h) ? [h] : await resolver(h);
  if (addrs.length === 0 || addrs.some(isPrivate)) throw new AppError('VALIDATION_FAILED', 'Destination resolves to a private address');
  return addrs[0]!;
}

/**
 * What the tenant sees of a failed request. The resolver's and HTTP client's own messages stay in the server log: shown
 * to the tenant they would tell "this name exists on the platform's private network" (blocked) apart from "no such
 * name", a map of internal host names.
 */
export function deliveryErrorCategory(detail: string): string {
  if (/private address|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) return 'Destination not reachable (DNS lookup failed or address not allowed)';
  if (/timeout|timed out|aborted/i.test(detail)) return 'Timed out';
  if (/certificate|TLS|SSL|self[- ]signed/i.test(detail)) return 'TLS error';
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket/i.test(detail)) return 'Connection failed';
  return 'Request failed';
}

/** `X-Pager-Signature: t={unix},v1={hmac}[,v1={hmac}]` (TR-WH-01). */
export function signPayload(secrets: string[], body: string, t: number): string {
  return [`t=${t}`, ...secrets.map((s) => `v1=${createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`)].join(',');
}

// ---- endpoint management (owner, `webhooks` feature)
/** Endpoints one tenant may register (M-12); every endpoint multiplies each event's outbound deliveries. */
export const MAX_WEBHOOK_ENDPOINTS_PER_TENANT = 10;

export async function createWebhook(deps: Deps, actor: Actor & { kind: 'user' }, tenantId: string, b: { url: string; events: string[]; venueId?: string | null }) {
  await requireFeature(deps, tenantId, 'webhooks');
  checkWebhookUrl(b.url);
  const events = b.events.filter((e): e is (typeof WEBHOOK_EVENTS)[number] => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) throw new AppError('VALIDATION_FAILED', 'Choose at least one event');
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const id = uuidv7();
  const db = deps.db.forTenant(tenantId);
  if (b.venueId && !(await db.selectFrom('venues').select('id').where('id', '=', b.venueId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  await db.transaction().execute(async (tx) => {
    // Per-tenant endpoint cap (M-12); the locking read serialises concurrent creates of one tenant.
    const existing = await tx.selectFrom('webhook_endpoints').select('id').forUpdate().execute();
    if (existing.length >= MAX_WEBHOOK_ENDPOINTS_PER_TENANT) {
      throw new AppError('PLAN_LIMIT', `At most ${MAX_WEBHOOK_ENDPOINTS_PER_TENANT} webhook endpoints`, { data: { limit: 'maxWebhookEndpoints', allowed: MAX_WEBHOOK_ENDPOINTS_PER_TENANT } });
    }
    await tx.insertInto('webhook_endpoints').values({ id, tenant_id: tenantId, venue_id: b.venueId ?? null, url: b.url, events: json(events), secret_enc: await encrypt(deps.keys, secret) }).execute();
    await writeAudit(tx, { actor, action: 'webhook.created', tenantId, entityType: 'webhook', entityId: id, after: { url: b.url, events } });
  });
  return { id, secret }; // shown once (NFR-SEC-05)
}

export async function listWebhooks(deps: Deps, tenantId: string) {
  const rows = await deps.db.forTenant(tenantId).selectFrom('webhook_endpoints').select(['id', 'url', 'events', 'venue_id', 'status', 'disabled_reason', 'failure_streak', 'created_at']).orderBy('created_at').execute();
  return rows.map((r) => ({ id: r.id, url: r.url, events: r.events, venueId: r.venue_id, status: r.status, disabledReason: r.disabled_reason, failureStreak: r.failure_streak }));
}

export async function updateWebhook(deps: Deps, actor: Actor, tenantId: string, id: string, b: { url?: string; events?: string[]; enabled?: boolean; rotateSecret?: boolean }) {
  if (b.url) checkWebhookUrl(b.url);
  const db = deps.db.forTenant(tenantId);
  let newSecret: string | undefined;
  await db.transaction().execute(async (tx) => {
    const ep = await tx.selectFrom('webhook_endpoints').select(['id', 'secret_enc', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!ep) throw new AppError('NOT_FOUND');
    const patch: Record<string, unknown> = {};
    if (b.url) patch.url = b.url;
    if (b.events) {
      const events = b.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
      if (events.length === 0) throw new AppError('VALIDATION_FAILED', 'Choose at least one event', { errors: [{ path: 'events', message: 'empty' }] });
      patch.events = json(events);
    }
    // Re-enabling resets the endpoint's health (TR-WH-03): earlier failures no longer count towards disabling it.
    if (b.enabled !== undefined) Object.assign(patch, b.enabled ? { status: 'active', disabled_reason: null, failure_streak: 0, ...(ep.status !== 'active' && { health_since: deps.now() }) } : { status: 'disabled', disabled_reason: 'manual' });
    if (b.rotateSecret) {
      // Both secrets sign for 24 h (TR-WH-01); the old one moves to secret_enc after the overlap.
      newSecret = `whsec_${randomBytes(32).toString('base64url')}`;
      patch.secret_next_enc = await encrypt(deps.keys, newSecret);
      patch.secret_rotated_at = deps.now();
    }
    // An empty change (`{}` or only `rotateSecret: false`) is a no-op for an existing endpoint (A10, API01).
    if (Object.keys(patch).length === 0) return;
    await tx.updateTable('webhook_endpoints').set(patch).where('id', '=', id).execute();
    await writeAudit(tx, { actor, action: 'webhook.updated', tenantId, entityType: 'webhook', entityId: id, after: { ...b, rotateSecret: Boolean(b.rotateSecret) } });
  });
  return { secret: newSecret };
}

export async function deleteWebhook(deps: Deps, actor: Actor, tenantId: string, id: string) {
  const db = deps.db.forTenant(tenantId);
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom('webhook_deliveries').where('endpoint_id', '=', id).execute();
    const r = await tx.deleteFrom('webhook_endpoints').where('id', '=', id).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor, action: 'webhook.deleted', tenantId, entityType: 'webhook', entityId: id });
  });
}

export async function listDeliveries(deps: Deps, tenantId: string, endpointId: string) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('webhook_endpoints').select('id').where('id', '=', endpointId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  const rows = await db.selectFrom('webhook_deliveries').select(['id', 'event_id', 'event_type', 'attempt', 'status', 'response_code', 'response_ms', 'error', 'created_at', 'next_attempt_at']).where('endpoint_id', '=', endpointId).orderBy('id', 'desc').limit(100).execute();
  return rows.map((r) => ({ ...r, created_at: r.created_at.toISOString(), next_attempt_at: r.next_attempt_at?.toISOString() ?? null }));
}

// ---- fan-out and delivery
interface Envelope {
  id: string;
  type: WebhookEvent;
  createdAt: string;
  tenantId: string;
  venueId: string | null;
  data: Record<string, unknown>;
}

const isDuplicate = (e: unknown) => (e as { code?: string }).code === 'ER_DUP_ENTRY';

/**
 * Creates the original delivery of an event for each subscribed active endpoint and returns the IDs whose deliver
 * jobs are due. Idempotent per (event, endpoint) (BW09): a retried fan-out finds the delivery it stored before
 * (uq_original) instead of adding a second one, and returns it again only while it was never attempted, so a deliver
 * job that was not queued the first time is queued now. Deliberate redeliveries (`redeliver`) are separate rows.
 */
export async function fanOutWebhook(deps: Deps, tenantId: string, venueId: string | null, type: WebhookEvent, data: Record<string, unknown>, eventId = uuidv7()): Promise<number[]> {
  const db = deps.db.forTenant(tenantId);
  const endpoints = await db.selectFrom('webhook_endpoints').select(['id', 'events', 'venue_id']).where('status', '=', 'active').execute();
  const targets = endpoints.filter((e) => (type === 'ping' || (e.events as unknown as string[]).includes(type)) && (!e.venue_id || !venueId || e.venue_id === venueId));
  const ids: number[] = [];
  const envelope: Envelope = { id: eventId, type, createdAt: deps.now().toISOString(), tenantId, venueId, data };
  for (const e of targets) {
    try {
      const r = await db
        .insertInto('webhook_deliveries')
        .values({ tenant_id: tenantId, endpoint_id: e.id, event_id: eventId, event_type: type, is_original: true, payload: json(envelope), next_attempt_at: deps.now(), created_at: deps.now() })
        .executeTakeFirstOrThrow();
      ids.push(Number(r.insertId));
    } catch (err) {
      if (!isDuplicate(err)) throw err;
      const existing = await db.selectFrom('webhook_deliveries').select(['id', 'status', 'attempt']).where('endpoint_id', '=', e.id).where('event_id', '=', eventId).where('is_original', '=', true).executeTakeFirst();
      if (existing && existing.status === 'pending' && existing.attempt === 0) ids.push(existing.id);
    }
  }
  return ids;
}

export interface HttpPoster {
  (url: string, body: string, headers: Record<string, string>, opts: { timeoutMs: number; resolvedAddress: string }): Promise<{ status: number }>;
}

/** `webhook.deliver`: one attempt; schedules the next one or abandons; disables failing endpoints (TR-WH-03). */
export async function deliverWebhook(deps: Deps, tenantId: string, deliveryId: number, post: HttpPoster, resolver?: (h: string) => Promise<string[]>): Promise<{ status: string; nextAttemptAt: Date | null }> {
  const db = deps.db.forTenant(tenantId);
  const d = await db.selectFrom('webhook_deliveries').selectAll().where('id', '=', deliveryId).executeTakeFirst();
  if (!d || d.status === 'succeeded' || d.status === 'abandoned') return { status: d?.status ?? 'missing', nextAttemptAt: null };
  const ep = await db.selectFrom('webhook_endpoints').selectAll().where('id', '=', d.endpoint_id).executeTakeFirst();
  if (!ep || ep.status !== 'active') {
    await db.updateTable('webhook_deliveries').set({ status: 'abandoned', next_attempt_at: null }).where('id', '=', deliveryId).execute();
    return { status: 'abandoned', nextAttemptAt: null };
  }
  const body = JSON.stringify(d.payload);
  const secrets = [await decrypt(deps.keys, ep.secret_enc)];
  if (ep.secret_next_enc) {
    const next = await decrypt(deps.keys, ep.secret_next_enc);
    if (ep.secret_rotated_at && deps.now().getTime() - ep.secret_rotated_at.getTime() > 24 * 3600_000) {
      await db.updateTable('webhook_endpoints').set({ secret_enc: ep.secret_next_enc, secret_next_enc: null }).where('id', '=', ep.id).execute();
      secrets.splice(0, 1, next);
    } else secrets.push(next);
  }
  const t = Math.floor(deps.now().getTime() / 1000);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Tanbeeh-Webhooks/1', 'X-Pager-Signature': signPayload(secrets, body, t), 'X-Pager-Event-Id': d.event_id, 'X-Pager-Event-Type': d.event_type };
  const attempt = d.attempt + 1;
  const started = Date.now();
  let code: number | null = null;
  let error: string | null = null;
  try {
    const address = await resolvePublic(new URL(ep.url).hostname, resolver);
    code = (await post(ep.url, body, headers, { timeoutMs: 10_000, resolvedAddress: address })).status;
  } catch (e) {
    const detail = String((e as Error).message).slice(0, 300);
    if (/private address/.test(detail)) deps.log.warn({ security: true, event: 'WEBHOOK_SSRF_BLOCKED', tenantId, endpointId: ep.id }, 'webhook SSRF check failed');
    else deps.log.info({ tenantId, endpointId: ep.id, deliveryId, detail }, 'webhook delivery failed');
    error = deliveryErrorCategory(detail);
  }
  const ms = Date.now() - started;
  const ok = code !== null && code >= 200 && code < 300;
  const offset = RETRY_SCHEDULE_MS[attempt - 1];
  const next = ok || offset === undefined ? null : new Date(d.created_at.getTime() + offset);
  // The outcome and the endpoint's health are recorded under a lock on the endpoint row (BW01): concurrent deliveries
  // of one endpoint serialise here, so a success committed by one is always seen by another's disable decision, and
  // the streak is never lost to a read-modify-write race. The request itself ran outside any transaction.
  const disabled = await db.transaction().execute(async (tx) => {
    const cur = await tx.selectFrom('webhook_endpoints').select(['status', 'health_since']).where('id', '=', ep.id).forUpdate().executeTakeFirst();
    if (ok) {
      await tx.updateTable('webhook_deliveries').set({ status: 'succeeded', attempt, response_code: code, response_ms: ms, error: null, next_attempt_at: null }).where('id', '=', deliveryId).execute();
      await tx.updateTable('webhook_endpoints').set({ failure_streak: 0 }).where('id', '=', ep.id).execute();
      return false;
    }
    await tx
      .updateTable('webhook_deliveries')
      .set({ status: next ? 'failed' : 'abandoned', attempt, response_code: code, response_ms: ms, error: error ?? `HTTP ${code}`, next_attempt_at: next })
      .where('id', '=', deliveryId)
      .execute();
    await tx
      .updateTable('webhook_endpoints')
      .set((eb) => ({ failure_streak: eb('failure_streak', '+', 1) }))
      .where('id', '=', ep.id)
      .execute();
    if (!cur || cur.status !== 'active') return false;
    // Disable when at least 10 deliveries of the last 24 h were actually attempted and none succeeded (TR-WH-03).
    // Deliveries not attempted yet (queued behind this one) are no evidence of failure and are not counted; nor are
    // deliveries from before the endpoint was last re-enabled.
    const dayAgo = new Date(deps.now().getTime() - 24 * 3600_000);
    const since = cur.health_since && cur.health_since > dayAgo ? cur.health_since : dayAgo;
    const day = await tx
      .selectFrom('webhook_deliveries')
      .select([(eb) => eb.fn.countAll<number>().as('n'), (eb) => eb.fn.sum<number>(eb.case().when('status', '=', 'succeeded').then(1).else(0).end()).as('ok')])
      .where('endpoint_id', '=', ep.id)
      .where('attempt', '>', 0)
      .where('created_at', '>', since)
      .executeTakeFirstOrThrow();
    if (Number(day.n) < 10 || Number(day.ok ?? 0) > 0) return false;
    const r = await tx.updateTable('webhook_endpoints').set({ status: 'disabled', disabled_reason: 'failing' }).where('id', '=', ep.id).where('status', '=', 'active').executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  });
  if (ok) return { status: 'succeeded', nextAttemptAt: null };
  if (disabled) {
    const owner = await deps.db.platform().selectFrom('tenant_memberships').innerJoin('users', 'users.id', 'tenant_memberships.user_id').select(['users.email', 'users.locale']).where('tenant_memberships.tenant_id', '=', tenantId).where('tenant_memberships.role', '=', 'owner').where('tenant_memberships.status', '=', 'active').executeTakeFirst();
    if (owner) await sendEmail(deps, { template: 'webhook_disabled', to: owner.email, locale: owner.locale, tenantId, data: { url: ep.url }, key: `whdisabled:${ep.id}:${deps.now().toISOString().slice(0, 10)}` });
  }
  return { status: next ? 'failed' : 'abandoned', nextAttemptAt: next };
}

/**
 * `webhooks.sweep` every 5 minutes: deliveries whose retry time passed more than 5 minutes ago without a run (queue
 * store lost or job dead-lettered) are enqueued again. The job ID includes the due time, so each retry runs once.
 */
export async function sweepWebhookDeliveries(deps: Deps): Promise<number> {
  const rows = await deps.db
    .platform()
    .selectFrom('webhook_deliveries')
    .select(['id', 'tenant_id', 'next_attempt_at'])
    .where('status', 'in', ['pending', 'failed'])
    .where('next_attempt_at', '<', new Date(deps.now().getTime() - 5 * 60_000))
    .limit(1000)
    .execute();
  for (const r of rows) {
    await deps.jobs.add('webhook.deliver', { tenantId: r.tenant_id, deliveryId: r.id }, { jobId: jobIds.webhookDeliver(r.id, r.next_attempt_at!.getTime()) });
  }
  return rows.length;
}

export async function redeliver(deps: Deps, tenantId: string, deliveryId: number) {
  const db = deps.db.forTenant(tenantId);
  const d = await db.selectFrom('webhook_deliveries').select(['tenant_id', 'endpoint_id', 'event_id', 'event_type', 'payload']).where('id', '=', deliveryId).executeTakeFirst();
  if (!d) throw new AppError('NOT_FOUND');
  // A deliberate redelivery is not an original (is_original NULL), so the per-event uniqueness never blocks it (BW09).
  const r = await db
    .insertInto('webhook_deliveries')
    .values({ tenant_id: tenantId, endpoint_id: d.endpoint_id, event_id: d.event_id, event_type: d.event_type, is_original: null, payload: json(d.payload), next_attempt_at: deps.now(), created_at: deps.now() })
    .executeTakeFirstOrThrow();
  const id = Number(r.insertId);
  await enqueueJobs(deps, [{ name: 'webhook.deliver', data: { tenantId, deliveryId: id }, opts: { jobId: jobIds.webhookDeliver(id) } }]);
  return { id };
}

export async function testWebhook(deps: Deps, tenantId: string, endpointId: string) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('webhook_endpoints').select('id').where('id', '=', endpointId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  const envelope = { id: uuidv7(), type: 'ping', createdAt: deps.now().toISOString(), tenantId, venueId: null, data: {} };
  const r = await db.insertInto('webhook_deliveries').values({ tenant_id: tenantId, endpoint_id: endpointId, event_id: envelope.id, event_type: 'ping', payload: json(envelope), next_attempt_at: deps.now(), created_at: deps.now() }).executeTakeFirstOrThrow();
  await enqueueJobs(deps, [{ name: 'webhook.deliver', data: { tenantId, deliveryId: Number(r.insertId) }, opts: { jobId: jobIds.webhookDeliver(Number(r.insertId)) } }]);
  return { deliveryId: Number(r.insertId) };
}

/**
 * Default HTTP poster: connects to the address that passed the SSRF check (no second DNS lookup, so DNS
 * rebinding cannot swap it), keeps TLS verification against the URL host, no redirects, 10 s timeout.
 */
export const fetchPoster: HttpPoster = async (url, body, headers, opts) => {
  const { Agent, request } = await import('undici');
  const family = isIP(opts.resolvedAddress) === 6 ? 6 : 4;
  const dispatcher = new Agent({
    connect: { lookup: (_host, _o, cb) => cb(null, [{ address: opts.resolvedAddress, family }]) },
    headersTimeout: opts.timeoutMs,
    bodyTimeout: opts.timeoutMs,
  });
  try {
    // undici's request() never follows redirects unless a redirect interceptor is added (TR-WH-02).
    const r = await request(url, { method: 'POST', body, headers, dispatcher, signal: AbortSignal.timeout(opts.timeoutMs) });
    await r.body.dump();
    return { status: r.statusCode };
  } finally {
    await dispatcher.close();
  }
};

import type { Actor } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { sql } from '@dop/db';
import { uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { verifyUserPassword } from './auth.js';
import { deleteOrphanSubscriptions, followerSubscriptionIds } from './alerts.js';
import { csvDocument } from './csv.js';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { enqueueJobs, flushOutbox, jobIds } from './outbox.js';
import type { ObjectStorage } from './storage.js';
import { changeTenantStatus } from './tenants.js';
import { buildZip } from './zip.js';

// Export, deletion and purge (TRD §21; FR-TEN-08, FR-ADM-15, BR-17, EX-16).

export const DELETION_WINDOW_MS = 7 * 86_400_000;

async function ownerContact(deps: Deps, tenantId: string) {
  return deps.db
    .platform()
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select(['users.email', 'users.locale'])
    .where('tenant_memberships.tenant_id', '=', tenantId)
    .where('tenant_memberships.role', '=', 'owner')
    .where('tenant_memberships.status', '=', 'active')
    .executeTakeFirst();
}

/** Owner requests deletion with password re-entry; 7-day cancel window (TR-PRV-08). */
export async function requestDeletion(deps: Deps, actor: Actor & { kind: 'user' }, tenantId: string, password: string) {
  await verifyUserPassword(deps, actor.userId, password);
  const db = deps.db.platform();
  await db.transaction().execute(async (tx) => {
    const t = await tx.selectFrom('tenants').select(['deletion_requested_at', 'status']).where('id', '=', tenantId).forUpdate().executeTakeFirstOrThrow();
    if (t.deletion_requested_at) return;
    await tx.updateTable('tenants').set({ deletion_requested_at: deps.now() }).where('id', '=', tenantId).execute();
    await writeAudit(tx, { actor, action: 'tenant.deletion_requested', tenantId, entityType: 'tenant', entityId: tenantId });
  });
  const owner = await ownerContact(deps, tenantId);
  if (owner) {
    await sendEmail(deps, { template: 'deletion_requested', to: owner.email, locale: owner.locale, tenantId, data: { deleteAfter: new Date(deps.now().getTime() + DELETION_WINDOW_MS).toISOString() } });
  }
  return { deleteAfter: new Date(deps.now().getTime() + DELETION_WINDOW_MS).toISOString() };
}

export async function cancelDeletion(deps: Deps, actor: Actor, tenantId: string) {
  const db = deps.db.platform();
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('tenants').set({ deletion_requested_at: null }).where('id', '=', tenantId).where('deletion_requested_at', 'is not', null).where('status', '!=', 'deleted').executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND', 'No deletion pending');
    await writeAudit(tx, { actor, action: 'tenant.deletion_cancelled', tenantId, entityType: 'tenant', entityId: tenantId });
  });
}

/** `tenants.deletion-window` job: requests older than 7 days → deleted, then purge (§18). */
export async function processDeletionWindow(deps: Deps): Promise<string[]> {
  const due = await deps.db
    .platform()
    .selectFrom('tenants')
    .select(['id'])
    .where('deletion_requested_at', '<=', new Date(deps.now().getTime() - DELETION_WINDOW_MS))
    .where('status', '!=', 'deleted')
    .execute();
  for (const t of due) await markDeleted(deps, t.id, { kind: 'system' });
  return due.map((t) => t.id);
}

/** Tenant → deleted: sessions and devices revoked, then the purge job runs (TR-PRV-08). */
export async function markDeleted(deps: Deps, tenantId: string, actor: Actor) {
  await changeTenantStatus(deps, tenantId, { to: 'deleted', actor, email: null });
  const db = deps.db.forTenant(tenantId);
  await db.updateTable('staff_devices').set({ revoked_at: deps.now(), revoked_reason: 'platform' }).where('revoked_at', 'is', null).execute();
  await db.updateTable('displays').set({ session_hash: null }).execute();
  await db.updateTable('user_sessions').set({ revoked_at: deps.now() }).where('revoked_at', 'is', null).execute();
  await enqueuePurge(deps, tenantId);
}

/** Durable purge enqueue; the hour bucket lets the sweep enqueue a dead-lettered purge again (A30). */
export async function enqueuePurge(deps: Deps, tenantId: string): Promise<void> {
  await enqueueJobs(deps, [{ name: 'tenant.purge', data: { tenantId }, opts: { jobId: jobIds.purge(tenantId, Math.floor(deps.now().getTime() / 3_600_000)) } }]);
}

/** `tenants.purge-resume` hourly: deleted tenants still present an hour after deletion get their purge again (A30). */
export async function resumePurges(deps: Deps): Promise<number> {
  const rows = await deps.db
    .platform()
    .selectFrom('tenants')
    .select('id')
    .where('status', '=', 'deleted')
    .where('deleted_at', '<', new Date(deps.now().getTime() - 3_600_000))
    .limit(100)
    .execute();
  for (const r of rows) await enqueuePurge(deps, r.id);
  return rows.length;
}

// TR-PRV-12 purge order, child-first, batches of ≤ 5,000 rows in their own transactions.
const PURGE_ORDER = [
  'ticket_events',
  'ticket_followers',
  'claim_requests',
  'ratings',
  'tickets',
  'number_sequences',
  'staff_devices',
  'staff_access',
  'displays',
  'counters',
  'venues',
  'report_daily',
  'data_exports',
  'tenant_payments',
  'legal_acceptances',
  'invitations',
  'support_sessions',
  'tenant_notes',
  'tenant_feature_overrides',
  'user_sessions',
  'tenant_memberships',
] as const;
// Tables created for later releases are purged too when they exist (webhook_deliveries, api_keys, ...).
const LATER_TABLES = ['alert_deliveries', 'alert_attempts', 'webhook_deliveries', 'webhook_endpoints', 'idempotency_keys', 'api_keys', 'pos_connections', 'staff_members'] as const;

/**
 * Purges a deleted tenant (TR-PRV-12). Resumable (A30): object storage (every object acknowledged, M-20) and cache, then rows child-first, and the tenant row last — so a
 * failure at any step leaves the tenant marked deleted and the next run (retry or the purge sweep) repeats every step
 * that is not finished. Each step is idempotent. The completion email is queued only with the tenant row's removal.
 */
export async function purgeTenant(deps: Deps, tenantId: string, storage: ObjectStorage | null): Promise<{ done: boolean; deleted: number }> {
  const pdb = deps.db.platform();
  const t = await pdb.selectFrom('tenants').select(['status']).where('id', '=', tenantId).executeTakeFirst();
  if (!t) return { done: true, deleted: 0 };
  if (t.status !== 'deleted') throw new AppError('INVALID_TRANSITION', 'Only deleted tenants are purged');
  // Read the owner's contact before memberships go; an earlier interrupted run may already have removed them.
  const contactKey = `purge:${tenantId}:owner`;
  const found = await ownerContact(deps, tenantId);
  if (found) await deps.kv.set(contactKey, JSON.stringify(found), 30 * 86400);
  const owner = found ?? (await deps.kv.get(contactKey).then((v) => (v ? (JSON.parse(v) as { email: string; locale: string }) : null)));
  if (storage) {
    await storage.deletePrefix('assets', `tenants/${tenantId}`);
    await storage.deletePrefix('exports', `exports/${tenantId}`);
  }
  for (const k of await deps.kv.keys(`t:${tenantId}:`)) await deps.kv.del(k);
  const memberUserIds = (await pdb.selectFrom('tenant_memberships').select('user_id').where('tenant_id', '=', tenantId).execute()).map((m) => m.user_id);
  // Push subscriptions have no tenant (one per phone browser, may serve several tenants); note the ones this
  // tenant's followers use so the ones nobody else follows with are removed below (L-14).
  const subIds = await followerSubscriptionIds(pdb, { tenantId });
  let deleted = 0;
  for (const table of [...LATER_TABLES, ...PURGE_ORDER]) {
    for (;;) {
      // Raw on purpose: some tables have no `id` column; tenant predicate is explicit (TR-TEN-04).
      const r = await sql`DELETE FROM ${sql.table(table)} WHERE tenant_id = ${tenantId} LIMIT 5000`.execute(pdb);
      const n = Number(r.numAffectedRows ?? 0);
      deleted += n;
      if (n < 5000) break;
    }
  }
  deleted += await deleteOrphanSubscriptions(pdb, subIds);
  // Users left with no membership (TR-PRV-12).
  for (const userId of memberUserIds) {
    const other = await pdb.selectFrom('tenant_memberships').select('id').where('user_id', '=', userId).executeTakeFirst();
    if (!other) await pdb.deleteFrom('users').where('id', '=', userId).execute();
  }
  // Audit rows are anonymised, not deleted (TR-PRV-06).
  await pdb.updateTable('audit_log').set({ before_data: null, after_data: null, ip: null }).where('tenant_id', '=', tenantId).execute();
  let outboxId = 0;
  await pdb.transaction().execute(async (tx) => {
    await tx.deleteFrom('tenants').where('id', '=', tenantId).execute();
    // Committed with the tenant removal, so the email is neither lost nor sent before the purge finished.
    if (owner) outboxId = await sendEmail(deps, { template: 'deletion_completed', to: owner.email, locale: owner.locale, data: {}, key: `deleted:${tenantId}` }, tx);
  });
  if (outboxId) await flushOutbox(deps, [outboxId]);
  await deps.kv.del(contactKey);
  return { done: true, deleted };
}

// ---------------------------------------------------------------- export (TR-PRV-07)

export async function requestExport(deps: Deps, actor: Actor & { kind: 'user' }, tenantId: string) {
  const id = uuidv7();
  const db = deps.db.forTenant(tenantId);
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    await tx.insertInto('data_exports').values({ id, tenant_id: tenantId, requested_by: actor.userId, status: 'queued' }).execute();
    await writeAudit(tx, { actor, action: 'export.requested', tenantId, entityType: 'export', entityId: id });
    // Stored with the export row: a queue outage cannot leave a queued export without a job (A01).
    outboxId = await enqueueJobs(deps, [{ name: 'tenant.export', data: { tenantId, exportId: id }, opts: { jobId: jobIds.export(id) } }], tx, tenantId);
  });
  await flushOutbox(deps, [outboxId]);
  return { id };
}

export async function exportStatus(deps: Deps, tenantId: string, exportId: string, storage: ObjectStorage) {
  const e = await deps.db.forTenant(tenantId).selectFrom('data_exports').selectAll().where('id', '=', exportId).executeTakeFirst();
  if (!e) throw new AppError('NOT_FOUND');
  const ready = e.status === 'ready' && e.file_key && e.expires_at && e.expires_at > deps.now();
  return { id: e.id, status: e.status, sizeBytes: e.size_bytes, downloadUrl: ready ? await storage.signedUrl('exports', e.file_key!, 15 * 60) : null, expiresAt: e.expires_at?.toISOString() ?? null };
}

// Spreadsheet-safe encoder shared with the report export (M-8): rating comments, notes and receipts are untrusted.
const csv = csvDocument;

/** The ZIP described in TR-PRV-07: everything the tenant holds, as JSON and spreadsheet-safe CSV. */
async function exportZip(deps: Deps, tenantId: string): Promise<Buffer> {
  const db = deps.db.forTenant(tenantId);
  const pdb = deps.db.platform();
  const tenant = await pdb.selectFrom('tenants').select(['id', 'name', 'slug', 'status', 'country', 'default_locale', 'created_at']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  const venues = await db.selectFrom('venues').selectAll().execute();
  const counters = await db.selectFrom('counters').selectAll().execute();
  const members = await db
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select(['users.name', 'users.email', 'tenant_memberships.role', 'tenant_memberships.status'])
    .execute();
  const tickets = await db.selectFrom('tickets').select(['id', 'venue_id', 'business_date', 'display_number', 'status', 'source', 'note', 'external_ref', 'created_at', 'ready_at', 'collected_at', 'cancelled_at', 'expired_at', 'alert_level_at_ready', 'acknowledged_at', 'cancel_reason']).execute();
  const events = await db.selectFrom('ticket_events').select(['ticket_id', 'type', 'from_status', 'to_status', 'actor_type', 'occurred_at']).execute();
  const ratings = await db.selectFrom('ratings').select(['ticket_id', 'stars', 'comment', 'created_at']).where('deleted_at', 'is', null).execute();
  const reports = await db.selectFrom('report_daily').select(['venue_id', 'counter_key', 'business_date', 'hour_local', 'tickets_created', 'tickets_collected', 'reach_push', 'reach_live', 'reach_closed', 'reach_none', 'acknowledged']).execute();
  const audit = await pdb.selectFrom('audit_log').select(['occurred_at', 'actor_type', 'action', 'entity_type', 'entity_id']).where('tenant_id', '=', tenantId).where('visible_to_tenant', '=', true).execute();
  const payments = await db.selectFrom('tenant_payments').select(['amount_minor', 'currency', 'months', 'method', 'reference', 'covers_from', 'covers_until', 'recorded_at']).execute();
  return buildZip([
    { name: 'README.txt', data: `Export of ${tenant.name} (${tenant.slug}) created ${deps.now().toISOString()}.\nTimes are UTC. CSV files are UTF-8 with BOM.\n` },
    { name: 'tenant.json', data: JSON.stringify(tenant, null, 2) },
    { name: 'venues.json', data: JSON.stringify(venues.map((v) => ({ ...v, staff_key_enc: undefined })), null, 2) },
    { name: 'counters.json', data: JSON.stringify(counters, null, 2) },
    { name: 'members.json', data: JSON.stringify(members, null, 2) },
    { name: 'tickets.csv', data: csv(tickets) },
    { name: 'ticket_events.csv', data: csv(events) },
    { name: 'ratings.csv', data: csv(ratings) },
    { name: 'reports_daily.csv', data: csv(reports) },
    { name: 'audit_activity.csv', data: csv(audit) },
    { name: 'payments.csv', data: csv(payments) },
  ]);
}

/** Immediate download from Reports: built on request and streamed back, nothing stored or emailed. */
export async function downloadExport(deps: Deps, actor: Actor & { kind: 'user' }, tenantId: string) {
  const zip = await exportZip(deps, tenantId);
  await writeAudit(deps.db.forTenant(tenantId), { actor, action: 'export.downloaded', tenantId, entityType: 'export', entityId: tenantId });
  return zip;
}

/** `tenant.export` job: builds the ZIP and stores it for a week. */
export async function buildExport(deps: Deps, tenantId: string, exportId: string, storage: ObjectStorage) {
  const db = deps.db.forTenant(tenantId);
  await db.updateTable('data_exports').set({ status: 'running' }).where('id', '=', exportId).execute();
  try {
    const zip = await exportZip(deps, tenantId);
    const key = `exports/${tenantId}/${exportId}.zip`;
    await storage.put('exports', key, zip, 'application/zip');
    await db
      .updateTable('data_exports')
      .set({ status: 'ready', file_key: key, size_bytes: zip.length, expires_at: new Date(deps.now().getTime() + 7 * 86_400_000) })
      .where('id', '=', exportId)
      .execute();
    const requester = await db
      .selectFrom('data_exports')
      .innerJoin('users', 'users.id', 'data_exports.requested_by')
      .select(['users.email', 'users.locale'])
      .where('data_exports.id', '=', exportId)
      .executeTakeFirst();
    if (requester) await sendEmail(deps, { template: 'export_ready', to: requester.email, locale: requester.locale, tenantId, data: { exportId } });
  } catch (e) {
    await db.updateTable('data_exports').set({ status: 'failed' }).where('id', '=', exportId).execute();
    throw e;
  }
}

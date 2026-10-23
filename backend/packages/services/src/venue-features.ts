import type { Actor } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { isOpen, normaliseCode, uuidv7 } from '@dop/domain';
import { json } from '@dop/db';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { addOutbox, flushOutbox } from './outbox.js';
import { isEnabled, requireFeature, requireWithinLimit } from './platform.js';
import { loadVenueRow } from './projections.js';
import { rollupVenueDay } from './reports.js';
import { getTenantStatus } from './tenants.js';
import { follow } from './tickets.js';

// R1.1 venue features: counters and prefixes (FR-ADM-07/10), claims (FR-QR-06, FR-STF-15, BR-14, §8.4),
// ratings (FR-CUS-10, FR-RPT-08/09).

// ---------------------------------------------------------------- counters

export async function listCounters(deps: Deps, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  const rows = await db.selectFrom('counters').select(['id', 'name', 'prefix', 'sort_order', 'archived_at']).where('venue_id', '=', venueId).orderBy('sort_order').orderBy('created_at').execute();
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, sortOrder: r.sort_order, archived: r.archived_at !== null }));
}

export async function createCounter(deps: Deps, actor: Actor, tenantId: string, venueId: string, b: { name: string; prefix?: string | null; sortOrder?: number }) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  if (b.prefix) await requireFeature(deps, tenantId, 'counters');
  const id = uuidv7();
  try {
    await db.transaction().execute(async (tx) => {
      // Counted under a lock on the venue row so parallel requests cannot pass the plan limit together (L-12).
      await tx.selectFrom('venues').select('id').where('id', '=', venueId).forUpdate().executeTakeFirst();
      const n = await tx.selectFrom('counters').select((eb) => eb.fn.countAll<number>().as('n')).where('venue_id', '=', venueId).where('archived_at', 'is', null).executeTakeFirstOrThrow();
      await requireWithinLimit(deps, tenantId, 'maxCountersPerVenue', Number(n.n));
      await tx.insertInto('counters').values({ id, tenant_id: tenantId, venue_id: venueId, name: b.name, prefix: b.prefix ?? null, sort_order: b.sortOrder ?? 0 }).execute();
      await writeAudit(tx, { actor, action: 'venue.updated', tenantId, entityType: 'counter', entityId: id, after: b });
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError('VALIDATION_FAILED', 'Prefix already used by another counter', { errors: [{ path: 'prefix', message: 'taken' }] });
    throw e;
  }
  return { id };
}

export async function updateCounter(deps: Deps, actor: Actor, tenantId: string, counterId: string, b: { name?: string; prefix?: string | null; sortOrder?: number }) {
  if (b.prefix) await requireFeature(deps, tenantId, 'counters');
  const db = deps.db.forTenant(tenantId);
  const patch = { ...(b.name && { name: b.name }), ...(b.prefix !== undefined && { prefix: b.prefix }), ...(b.sortOrder !== undefined && { sort_order: b.sortOrder }) };
  // An empty change is a no-op (A10); the counter must still exist.
  if (Object.keys(patch).length === 0) {
    if (!(await db.selectFrom('counters').select('id').where('id', '=', counterId).where('archived_at', 'is', null).executeTakeFirst())) throw new AppError('NOT_FOUND');
    return;
  }
  try {
    await db.transaction().execute(async (tx) => {
      const r = await tx.updateTable('counters').set(patch).where('id', '=', counterId).where('archived_at', 'is', null).executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
      await writeAudit(tx, { actor, action: 'venue.updated', tenantId, entityType: 'counter', entityId: counterId, after: b });
    });
  } catch (e) {
    // Same rule as on create: an active counter's prefix is unique in the venue (A10).
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError('VALIDATION_FAILED', 'Prefix already used by another counter', { errors: [{ path: 'prefix', message: 'taken' }] });
    throw e;
  }
}

/** Counters are archived, never deleted (TR-DB-13); their prefix becomes free again. */
export async function archiveCounter(deps: Deps, actor: Actor, tenantId: string, counterId: string) {
  const db = deps.db.forTenant(tenantId);
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('counters').set({ archived_at: deps.now(), prefix: null }).where('id', '=', counterId).where('archived_at', 'is', null).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor, action: 'venue.updated', tenantId, entityType: 'counter', entityId: counterId, after: { archived: true } });
  });
}

// ---------------------------------------------------------------- claims

const CLAIM_TTL_MS = 5 * 60_000;
/** Open approval requests one ticket can have (L-13). */
const MAX_PENDING_CLAIMS_PER_TICKET = 3;

async function venueForClaims(deps: Deps, venueCode: string) {
  const v = await deps.db.platform().selectFrom('venues').select(['id', 'tenant_id']).where('venue_code', '=', venueCode.toUpperCase()).where('status', '=', 'active').executeTakeFirst();
  if (!v) throw new AppError('NOT_FOUND');
  const status = await getTenantStatus(deps, v.tenant_id);
  if (!status || status === 'deleted' || status === 'trial_expired' || status === 'cancelled') throw new AppError('NOT_FOUND');
  const venue = loadVenueRow(await deps.db.forTenant(v.tenant_id).selectFrom('venues').selectAll().where('id', '=', v.id).executeTakeFirstOrThrow());
  return { tenantId: v.tenant_id, venue };
}

/**
 * Claim by number (FR-QR-06): with the claim code the phone joins at once; with staff approval a pending request
 * goes to the board. Wrong number and wrong code give the same error so numbers cannot be probed (BR-14).
 */
export async function claimTicket(
  deps: Deps,
  venueCode: string,
  b: { clientId: string; number: string; claimCode?: string },
  ua: string,
): Promise<{ token: string } | { claimId: string; status: 'pending' }> {
  const { tenantId, venue } = await venueForClaims(deps, venueCode);
  const mode = venue.settings.claims.mode;
  if (mode === 'off') throw new AppError('CLAIM_INVALID', 'Ask staff for your ticket QR code');
  const db = deps.db.forTenant(tenantId);
  const t = await db
    .selectFrom('tickets')
    .select(['id', 'token', 'claim_code', 'status', 'display_number', 'venue_id'])
    .where('venue_id', '=', venue.row.id)
    .where('open_number_key', '=', normaliseCode(b.number))
    .executeTakeFirst();
  if (mode === 'code') {
    if (!t || !b.claimCode || normaliseCode(b.claimCode) !== t.claim_code) throw new AppError('CLAIM_INVALID');
    await follow(deps, t.token, { clientId: b.clientId, joinedVia: 'claim_code', uaFamily: ua });
    return { token: t.token };
  }
  if (!t) throw new AppError('CLAIM_INVALID');
  const pending = await db.selectFrom('claim_requests').select(['id']).where('ticket_id', '=', t.id).where('client_id', '=', b.clientId).where('status', '=', 'pending').executeTakeFirst();
  if (pending) return { claimId: pending.id, status: 'pending' };
  // A ticket takes a few open requests at most (L-13): more claims for one number go to the counter instead of
  // burying the real customer's request on the board.
  const open = Number((await db.selectFrom('claim_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('ticket_id', '=', t.id).where('status', '=', 'pending').executeTakeFirstOrThrow()).n);
  if (open >= MAX_PENDING_CLAIMS_PER_TICKET) throw new AppError('CLAIM_INVALID', 'Ask staff for your ticket QR code');
  const id = uuidv7();
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    await tx.insertInto('claim_requests').values({ id, tenant_id: tenantId, ticket_id: t.id, client_id: b.clientId, created_at: deps.now() }).execute();
    await tx.insertInto('ticket_events').values({ tenant_id: tenantId, ticket_id: t.id, type: 'claim_requested', actor_type: 'customer', actor_id: null, data: json({ claimId: id }) }).execute();
    outboxId = await addOutbox(tx, 'claim.requested', tenantId, { venueId: t.venue_id, emit: { claimId: id, displayNumber: t.display_number, createdAt: deps.now().toISOString() } });
  });
  await flushOutbox(deps, [outboxId]);
  return { claimId: id, status: 'pending' };
}

export async function claimStatus(deps: Deps, claimId: string, clientId: string) {
  const c = await deps.db
    .platform()
    .selectFrom('claim_requests')
    .innerJoin('tickets', 'tickets.id', 'claim_requests.ticket_id')
    .select(['claim_requests.tenant_id', 'claim_requests.status', 'claim_requests.ticket_id', 'claim_requests.client_id', 'claim_requests.created_at', 'tickets.status as ticketStatus'])
    .where('claim_requests.id', '=', claimId)
    .executeTakeFirst();
  if (!c || c.client_id !== clientId) throw new AppError('NOT_FOUND');
  // Before the sweep runs, a request whose ticket closed or that timed out already reads as expired (A12).
  if (c.status === 'pending' && (!isOpen(c.ticketStatus) || deps.now().getTime() - c.created_at.getTime() > CLAIM_TTL_MS)) return { claimId, status: 'expired' as const, ticketToken: undefined };
  let token: string | undefined;
  if (c.status === 'approved') {
    token = (await deps.db.forTenant(c.tenant_id).selectFrom('tickets').select('token').where('id', '=', c.ticket_id).executeTakeFirstOrThrow()).token;
  }
  return { claimId, status: c.status, ticketToken: token };
}

export async function pendingClaims(deps: Deps, tenantId: string, venueId: string) {
  const rows = await deps.db
    .forTenant(tenantId)
    .selectFrom('claim_requests')
    .innerJoin('tickets', 'tickets.id', 'claim_requests.ticket_id')
    .select(['claim_requests.id', 'claim_requests.created_at', 'tickets.display_number', 'tickets.id as ticketId'])
    .where('tickets.venue_id', '=', venueId)
    .where('tickets.status', 'in', ['received', 'preparing', 'ready'])
    .where('claim_requests.status', '=', 'pending')
    .where('claim_requests.created_at', '>', new Date(deps.now().getTime() - CLAIM_TTL_MS))
    .orderBy('claim_requests.created_at')
    .execute();
  return rows.map((r) => ({ claimId: r.id, displayNumber: r.display_number, ticketId: r.ticketId, createdAt: r.created_at.toISOString() }));
}

/** Staff approve or refuse (FR-STF-15); approval links the phone to the ticket (BR-14). */
export async function decideClaim(deps: Deps, actor: Actor & { tenantId: string }, claimId: string, approve: boolean, venueId?: string) {
  const db = deps.db.forTenant(actor.tenantId);
  const c = await db
    .selectFrom('claim_requests')
    .innerJoin('tickets', 'tickets.id', 'claim_requests.ticket_id')
    .select(['claim_requests.id', 'claim_requests.status', 'claim_requests.client_id', 'claim_requests.created_at', 'tickets.token', 'tickets.status as ticketStatus', 'tickets.venue_id', 'tickets.id as ticketId'])
    .where('claim_requests.id', '=', claimId)
    .executeTakeFirst();
  if (!c || (venueId && c.venue_id !== venueId)) throw new AppError('NOT_FOUND');
  if (c.status !== 'pending') return { status: c.status };
  const expired = deps.now().getTime() - c.created_at.getTime() > CLAIM_TTL_MS || !isOpen(c.ticketStatus);
  const status = expired ? 'expired' : approve ? 'approved' : 'refused';
  const decidedBy = actor.kind === 'staff_device' ? actor.deviceId : null;
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('claim_requests').set({ status, decided_at: deps.now(), decided_by: decidedBy }).where('id', '=', claimId).execute();
    await tx.insertInto('ticket_events').values({ tenant_id: actor.tenantId, ticket_id: c.ticketId, type: 'claim_decided', actor_type: actor.kind === 'staff_device' ? 'staff_device' : 'user', actor_id: decidedBy, data: json({ claimId, status }) }).execute();
    outboxId = await addOutbox(tx, 'claim.decided', actor.tenantId, { venueId: c.venue_id, emit: { claimId, status, clientId: c.client_id, ...(status === 'approved' && { ticketToken: c.token }) } });
  });
  if (status === 'approved') await follow(deps, c.token, { clientId: c.client_id, joinedVia: 'staff_approval', uaFamily: 'other' });
  await flushOutbox(deps, [outboxId]);
  return { status };
}

/**
 * `claims.expire` every minute (§8.4): pending > 5 minutes, or the ticket closed (A12). Each expiry is announced
 * like a staff decision, so the staff list and the waiting phone both drop the request.
 */
export async function expireClaims(deps: Deps): Promise<number> {
  const due = await deps.db
    .platform()
    .selectFrom('claim_requests')
    .innerJoin('tickets', 'tickets.id', 'claim_requests.ticket_id')
    .select(['claim_requests.id', 'claim_requests.tenant_id', 'claim_requests.client_id', 'claim_requests.ticket_id', 'tickets.venue_id'])
    .where('claim_requests.status', '=', 'pending')
    .where((eb) => eb.or([eb('claim_requests.created_at', '<', new Date(deps.now().getTime() - CLAIM_TTL_MS)), eb('tickets.status', 'not in', ['received', 'preparing', 'ready'])]))
    .limit(1000)
    .execute();
  let n = 0;
  for (const c of due) {
    const db = deps.db.forTenant(c.tenant_id);
    let outboxId = 0;
    await db.transaction().execute(async (tx) => {
      const r = await tx.updateTable('claim_requests').set({ status: 'expired', decided_at: deps.now() }).where('id', '=', c.id).where('status', '=', 'pending').executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) return;
      n++;
      outboxId = await addOutbox(tx, 'claim.decided', c.tenant_id, { venueId: c.venue_id, emit: { claimId: c.id, status: 'expired', clientId: c.client_id } });
    });
    if (outboxId) await flushOutbox(deps, [outboxId]);
  }
  return n;
}

// ---------------------------------------------------------------- ratings

/** 1–5 stars after Collected, once; comment optional (FR-CUS-10). Only phones that follow the ticket may rate. */
export async function rateTicket(deps: Deps, token: string, b: { clientId: string; stars: number; comment?: string }) {
  const row = await deps.db.platform().selectFrom('tickets').select(['tenant_id']).where('token', '=', token).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  await requireFeature(deps, row.tenant_id, 'ratings');
  const db = deps.db.forTenant(row.tenant_id);
  const t = await db.selectFrom('tickets').select(['id', 'status', 'venue_id', 'business_date']).where('token', '=', token).executeTakeFirstOrThrow();
  if (t.status !== 'collected') throw new AppError('INVALID_TRANSITION', 'Ratings open after collection');
  const f = await db.selectFrom('ticket_followers').select('id').where('ticket_id', '=', t.id).where('client_id', '=', b.clientId).executeTakeFirst();
  if (!f) throw new AppError('FORBIDDEN');
  const venue = loadVenueRow(await db.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
  try {
    await db.transaction().execute(async (tx) => {
      await tx.insertInto('ratings').values({ id: uuidv7(), tenant_id: row.tenant_id, venue_id: t.venue_id, ticket_id: t.id, stars: b.stars, comment: b.comment?.trim() || null }).execute();
      await tx.insertInto('ticket_events').values({ tenant_id: row.tenant_id, ticket_id: t.id, type: 'rated', actor_type: 'customer', actor_id: null, data: json({ stars: b.stars }) }).execute();
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return { reviewLinkUrl: venue.settings.customer.reviewLinkUrl };
    throw e;
  }
  // A rating can arrive days after its ticket's business date, which the scheduled roll-up no longer revisits:
  // rebuild that day now (BW07). If this fails, the hourly roll-up picks the rating up from its look-back window.
  try {
    await rollupVenueDay(deps, row.tenant_id, t.venue_id, t.business_date);
  } catch (err) {
    deps.log.warn({ err, ticketId: t.id }, 'rating roll-up deferred to the hourly roll-up');
  }
  // The review link is shown to every rating customer, not only high ratings (FR-RPT-09).
  return { reviewLinkUrl: venue.settings.customer.reviewLinkUrl };
}

export async function listRatings(deps: Deps, tenantId: string, venueId?: string, limit = 100) {
  let q = deps.db
    .forTenant(tenantId)
    .selectFrom('ratings')
    .innerJoin('tickets', 'tickets.id', 'ratings.ticket_id')
    .select(['ratings.id', 'ratings.stars', 'ratings.comment', 'ratings.comment_deleted_at', 'ratings.created_at', 'tickets.display_number', 'tickets.business_date', 'ratings.venue_id'])
    .where('ratings.deleted_at', 'is', null);
  if (venueId) q = q.where('ratings.venue_id', '=', venueId);
  const rows = await q.orderBy('ratings.created_at', 'desc').limit(limit).execute();
  return rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, commentDeleted: r.comment_deleted_at !== null, createdAt: r.created_at.toISOString(), displayNumber: r.display_number, businessDate: r.business_date, venueId: r.venue_id }));
}

/**
 * Rating average and distribution (BRD §12.1 "Rating: average, distribution, recent comments"), over every retained
 * rating of the venue (or tenant), not just the recent list. `distribution[i]` counts ratings of i + 1 stars.
 */
export async function ratingSummary(deps: Deps, tenantId: string, venueId?: string) {
  let q = deps.db
    .forTenant(tenantId)
    .selectFrom('ratings')
    .select(['stars', (eb) => eb.fn.countAll<number>().as('n')])
    .where('deleted_at', 'is', null)
    .groupBy('stars');
  if (venueId) q = q.where('venue_id', '=', venueId);
  const distribution = [0, 0, 0, 0, 0];
  for (const r of await q.execute()) if (r.stars >= 1 && r.stars <= 5) distribution[r.stars - 1] = Number(r.n);
  const count = distribution.reduce((a, n) => a + n, 0);
  const sum = distribution.reduce((a, n, i) => a + n * (i + 1), 0);
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution };
}

/** The tenant can delete comments (FR-RPT-08); the rating and its stars stay in lists and reports (A11). */
export async function deleteRatingComment(deps: Deps, actor: Actor, tenantId: string, ratingId: string) {
  const db = deps.db.forTenant(tenantId);
  await db.transaction().execute(async (tx) => {
    const r = await tx
      .updateTable('ratings')
      .set({ comment: null, comment_deleted_at: deps.now() })
      .where('id', '=', ratingId)
      .where('deleted_at', 'is', null)
      .where('comment_deleted_at', 'is', null)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor, action: 'rating.deleted', tenantId, entityType: 'rating', entityId: ratingId });
  });
}

export const ratingsEnabled = (deps: Deps, tenantId: string) => isEnabled(deps, tenantId, 'ratings');

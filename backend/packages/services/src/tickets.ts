import { createHash } from 'node:crypto';
import type { Actor, TenantActor } from '@dop/auth';
import {
  AppError,
  type CancelReason,
  type CreateTicketBody,
  type EditTicketBody,
  type TenantStatus,
  type TicketStatus,
  type TransitionBody,
} from '@dop/contracts';
import { json, scope, sql, type Db, type Ticket, type Tx } from '@dop/db';
import {
  MANUAL_ALERT_MIN_INTERVAL_MS,
  businessDate,
  canAcknowledge,
  checkTransition,
  clampWait,
  displayNumber,
  followerLevel,
  nextOccurrence,
  nextScheduledOccurrence,
  ticketLevel,
  isOpen,
  newTicketCodes,
  newTicketToken,
  pickNextNumber,
  sequenceKey,
  staffOperationAllowed,
  tenantAccess,
  transitionEffects,
  trialLimitExceeded,
  uuidv7,
} from '@dop/domain';
import type { Deps } from './deps.js';
import { keys } from './kv.js';
import { addOutbox, flushOutbox, type OutboxPayload } from './outbox.js';
import { isEnabled, tenantPlan } from './platform.js';
import { displayTicket, loadVenueRow, publicTicket, staffTicket, type LoadedVenue } from './projections.js';
import { getTenantStatus } from './tenants.js';
import { calculatedWait } from './r2.js';

// Ticket service (TRD §8.1, §9.2, TR-TKT-01 – TR-TKT-05, TR-ALG-01 – TR-ALG-08, TR-ALG-14).

type TicketActor = Extract<TenantActor, { kind: 'staff_device' | 'user' | 'support' | 'api_key' }>;
type EventActorType = 'staff_device' | 'staff_member' | 'user' | 'support' | 'api_key' | 'system' | 'customer';

export const MAX_OPEN_TICKETS_PER_VENUE = 10_000; // TR-TEN-12

function eventActor(a: Actor): { type: EventActorType; id: string | null } {
  switch (a.kind) {
    case 'staff_device':
      // Named staff (R2, TR-AUTH-12): the person, not the device, is the actor.
      return a.member ? { type: 'staff_member', id: a.member.id } : { type: 'staff_device', id: a.deviceId };
    case 'user':
      return { type: 'user', id: a.userId };
    case 'support':
      return { type: 'support', id: a.platformUserId };
    case 'api_key':
      return { type: 'api_key', id: a.apiKeyId };
    default:
      return { type: 'system', id: null };
  }
}

async function actorName(db: Db | Tx, a: Actor): Promise<string | null> {
  switch (a.kind) {
    case 'staff_device':
      return a.member ? `${a.member.name} (${a.deviceName})` : a.deviceName;
    case 'support':
      return 'Platform support';
    case 'api_key':
      return 'POS integration';
    case 'user': {
      const u = await db.selectFrom('users').select('name').where('id', '=', a.userId).executeTakeFirst();
      return u?.name ?? null;
    }
    case 'system':
      return 'System';
    default:
      return null;
  }
}

export async function loadVenue(db: Db | Tx, venueId: string): Promise<LoadedVenue> {
  const row = await db.selectFrom('venues').selectAll().where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  return loadVenueRow(row);
}

interface FanOut {
  tx: Tx;
  deps: Deps;
  /** Resolved before the transaction: no second pool connection may be taken inside it. */
  removePoweredBy: boolean;
  ticket: Ticket;
  venue: LoadedVenue;
  tenantStatus: TenantStatus;
  change: string;
  reason?: string;
  actorLabel?: string | null;
  topic?: 'ticket.updated' | 'ticket.created';
  alertStart?: OutboxPayload['alertStart'];
  manualAlert?: OutboxPayload['manualAlert'];
  webhook?: string | null;
}

/** Webhook `data.ticket` (TRD §13.1). */
const webhookTicket = (t: Ticket) => ({
  ticket: {
    id: t.id,
    displayNumber: t.display_number,
    status: t.status,
    externalRef: t.external_ref,
    alertLevel: t.alert_level,
    acknowledgedAt: t.acknowledged_at?.toISOString() ?? null,
    createdAt: t.created_at.toISOString(),
    readyAt: t.ready_at?.toISOString() ?? null,
    collectedAt: t.collected_at?.toISOString() ?? null,
  },
});

async function counterName(db: Db | Tx, counterId: string | null): Promise<string | null> {
  if (!counterId) return null;
  const c = await db.selectFrom('counters').select('name').where('id', '=', counterId).executeTakeFirst();
  return c?.name ?? null;
}

/** Writes the outbox row carrying all three projections (TR-EVT-02). */
async function fanOut(f: FanOut): Promise<number> {
  const rated = f.ticket.status === 'collected' ? Boolean(await f.tx.selectFrom('ratings').select('id').where('ticket_id', '=', f.ticket.id).executeTakeFirst()) : false;
  const pub = publicTicket(f.deps.config, f.ticket, f.venue, {
    counterName: await counterName(f.tx, f.ticket.counter_id),
    tenantStatus: f.tenantStatus,
    rated,
    now: f.deps.now(),
    removePoweredBy: f.removePoweredBy,
  });
  return addOutbox(f.tx, f.topic ?? 'ticket.updated', f.ticket.tenant_id, {
    venueId: f.ticket.venue_id,
    ticketId: f.ticket.id,
    token: f.ticket.token,
    emit: {
      staff: staffTicket(f.ticket, f.actorLabel ?? null),
      display: displayTicket(f.ticket),
      public: pub,
      change: f.change,
      reason: f.reason ?? null,
      actor: f.actorLabel ?? null,
    },
    alertStart: f.alertStart,
    manualAlert: f.manualAlert,
    ...(f.webhook && { webhook: { type: f.webhook, data: webhookTicket(f.ticket) } }),
  });
}

async function writeEvent(
  tx: Tx,
  t: { tenant_id: string; id: string },
  type: string,
  actor: { type: EventActorType; id: string | null },
  extra: { from?: TicketStatus | null; to?: TicketStatus | null; data?: Record<string, unknown> } = {},
) {
  await tx
    .insertInto('ticket_events')
    .values({
      tenant_id: t.tenant_id,
      ticket_id: t.id,
      type: type as never,
      from_status: extra.from ?? null,
      to_status: extra.to ?? null,
      actor_type: actor.type,
      actor_id: actor.id,
      data: extra.data ? json(extra.data) : null,
    })
    .execute();
}

async function requireStaffAllowed(deps: Deps, tenantId: string, op: 'create' | 'transition' | 'edit' | 'alert', to?: string, viaApi = false): Promise<TenantStatus> {
  const status = await getTenantStatus(deps, tenantId);
  if (!status || status === 'deleted') throw new AppError('NOT_FOUND');
  if (viaApi) {
    const a = tenantAccess(status);
    if (a.api === 'none' || a.api === 'unauthenticated') throw new AppError('TENANT_INACTIVE');
    if (a.api === 'read_only') throw new AppError('TENANT_SUSPENDED');
    return status;
  }
  const verdict = staffOperationAllowed(status, op, to);
  if (!verdict.ok) throw new AppError(verdict.code);
  return status;
}

/**
 * Takes one of a trial's daily tickets (TR-ALG-14) and returns the function that gives it back. It is taken only
 * after the request validated and given back unless the ticket commits, so failed requests never spend the quota
 * (BW06). The counter is committed tickets plus creates in flight; INCR gives each concurrent create its own place,
 * so concurrent creates cannot pass the limit together.
 */
async function reserveTrialTicket(deps: Deps, tenantId: string, status: TenantStatus, bd: string): Promise<() => Promise<void>> {
  if (status !== 'trial') return async () => undefined;
  const k = keys.trialCount(tenantId, bd);
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await deps.kv.incrBy(k, -1).catch((e: unknown) => deps.log.warn({ err: e, tenantId }, 'trial quota release failed'));
  };
  let n = await deps.kv.incr(k, 48 * 3600);
  // Rebuild from MySQL when the counter is missing (TR-ALG-14): the tenant's tickets that day are added once, on
  // top of whatever concurrent requests counted meanwhile, instead of overwriting them (L-12).
  if (n === 1 && (await deps.kv.setNx(`${k}:seeded`, '1', 48 * 3600))) {
    const r = await deps.db.forTenant(tenantId).selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n')).where('business_date', '=', bd).executeTakeFirstOrThrow();
    if (Number(r.n) > 0) n = await deps.kv.incrBy(k, Number(r.n));
  }
  try {
    const { limits } = await tenantPlan(deps, tenantId);
    if (trialLimitExceeded(status, n, limits.trialTicketsPerDay)) throw new AppError('TRIAL_DAILY_LIMIT');
  } catch (e) {
    await release(); // a refused create keeps no place either
    throw e;
  }
  return release;
}

/** TR-AUTH-05: the owner's email must be verified before the second ticket (the setup test ticket is allowed). */
async function checkEmailVerified(db: Db, tenantId: string) {
  const owner = await db
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select('users.email_verified_at')
    .where('tenant_memberships.tenant_id', '=', tenantId)
    .where('tenant_memberships.role', '=', 'owner')
    .where('tenant_memberships.status', '=', 'active')
    .executeTakeFirst();
  if (!owner || owner.email_verified_at) return;
  const any = await db.selectFrom('tickets').select('id').limit(1).executeTakeFirst();
  if (any) throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email address to keep creating tickets');
}

export interface CreateResult {
  ticket: Ticket;
  existing: boolean;
}

export async function createTicket(
  deps: Deps,
  actor: TicketActor,
  venueId: string,
  body: CreateTicketBody,
  opts: { source?: 'staff' | 'api' | 'connector'; viaApi?: boolean } = {},
): Promise<CreateResult> {
  const tenantId = actor.tenantId;
  const status = await requireStaffAllowed(deps, tenantId, 'create', undefined, opts.viaApi);
  const db = deps.db.forTenant(tenantId);
  const venue = await loadVenue(db, venueId);
  const now = deps.now();
  const bd = businessDate(now, venue.row.time_zone, {
    resetTime: venue.row.reset_time,
    pendingResetTime: venue.row.pending_reset_time,
    pendingTimeZone: venue.row.pending_time_zone,
    pendingFromDate: venue.row.pending_from_date,
  });

  if (body.externalRef) {
    const existing = await db.selectFrom('tickets').selectAll().where('venue_id', '=', venueId).where('open_external_ref', '=', body.externalRef).executeTakeFirst();
    if (existing) {
      // TR-TKT-05: staff get 409 with the existing ticket; the integration API gets it back (FR-INT-05).
      if (opts.viaApi) return { ticket: existing, existing: true };
      throw new AppError('EXTERNAL_REF_IN_USE', `Receipt ${body.externalRef} is already on ticket ${existing.display_number}`, {
        data: { ticket: staffTicket(existing) },
      });
    }
  }
  if (actor.kind !== 'api_key') await checkEmailVerified(db, tenantId);

  let counter: { id: string; prefix: string | null } | null = null;
  if (body.counterId) {
    counter = (await db.selectFrom('counters').select(['id', 'prefix']).where('id', '=', body.counterId).where('venue_id', '=', venueId).where('archived_at', 'is', null).executeTakeFirst()) ?? null;
    if (!counter) throw new AppError('NOT_FOUND', 'Counter not found');
  }

  const openCount = await db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n')).where('venue_id', '=', venueId).where('open_number_key', 'is not', null).executeTakeFirstOrThrow();
  if (Number(openCount.n) >= MAX_OPEN_TICKETS_PER_VENUE) throw new AppError('PLAN_LIMIT', 'Too many open tickets in this venue');

  // The trial quota is taken only now that the request validated, and given back unless a ticket commits (BW06).
  const release = await reserveTrialTicket(deps, tenantId, status, bd);
  let committed = false;
  try {
    const startStatus = body.startStatus ?? venue.settings.ticketFlow.startStatus;
    let defaultWait = venue.settings.wait.defaultMinutes;
    if (venue.settings.wait.mode === 'auto' && body.waitMinutes === undefined) {
      defaultWait = (await calculatedWait(deps, tenantId, venueId, counter?.id ?? null, defaultWait)).minutes; // TR-ALG-09
    }
    const waitMinutes = venue.settings.wait.mode === 'off' ? null : clampWait(body.waitMinutes ?? defaultWait);
    const name = await actorName(db, actor);
    const evActor = eventActor(actor);

    // The sequence row is created in its own auto-committed statement, so the transaction below only locks an
    // existing row: concurrent INSERT IGNOREs inside the transaction deadlock on insert-intention locks.
    const seqKey = sequenceKey(venue.settings.numbering.prefixesEnabled, counter?.id);
    await db.insertInto('number_sequences').ignore().values({ tenant_id: tenantId, venue_id: venueId, sequence_key: seqKey, business_date: bd, last_number: 0 }).execute();

    for (let attempt = 1; ; attempt++) {
      try {
        let outboxId = 0;
        const rpb = await isEnabled(deps, tenantId, 'remove_powered_by');
        const ticket = await db.transaction().execute(async (tx) => {
          // A shared lock on the active venue row: archiving takes it exclusively, so no ticket is created in a
          // venue while it is archived (BW04).
          if (!(await tx.selectFrom('venues').select('id').where('id', '=', venueId).where('status', '=', 'active').forShare().executeTakeFirst())) throw new AppError('NOT_FOUND');
          const seq = await tx
            .selectFrom('number_sequences')
            .select('last_number')
            .where('venue_id', '=', venueId)
            .where('sequence_key', '=', seqKey)
            .where('business_date', '=', bd)
            .forUpdate()
            .executeTakeFirstOrThrow();
          let openQ = tx.selectFrom('tickets').select('number').where('venue_id', '=', venueId).where('open_number_key', 'is not', null);
          if (seqKey) openQ = openQ.where('counter_id', '=', counter!.id);
          else if (venue.settings.numbering.prefixesEnabled) openQ = openQ.where('counter_id', 'is', null);
          const open = new Set((await openQ.execute()).map((r) => r.number));
          const n = pickNextNumber(seq.last_number, venue.settings.numbering, open);
          if (n === null) throw new AppError('NUMBERS_EXHAUSTED');
          await tx.updateTable('number_sequences').set({ last_number: n }).where('venue_id', '=', venueId).where('sequence_key', '=', seqKey).where('business_date', '=', bd).execute();

          const id = uuidv7(now.getTime());
          const codes = newTicketCodes();
          const row = {
            id,
            tenant_id: tenantId,
            venue_id: venueId,
            counter_id: counter?.id ?? null,
            business_date: bd,
            number: n,
            display_number: displayNumber(venue.settings.numbering.prefixesEnabled ? counter?.prefix : null, n),
            token: newTicketToken(),
            check_code: codes.checkCode,
            claim_code: codes.claimCode,
            status: startStatus,
            source: opts.source ?? (actor.kind === 'api_key' ? ('api' as const) : ('staff' as const)),
            note: body.note || null,
            external_ref: body.externalRef || null,
            wait_minutes: waitMinutes,
            wait_base_at: waitMinutes === null ? null : now,
            created_at: now,
            received_at: startStatus === 'received' ? now : null,
            preparing_at: startStatus === 'preparing' ? now : null,
          };
          await tx.insertInto('tickets').values(row).execute();
          const t = await tx.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
          await writeEvent(tx, t, 'created', evActor, { to: startStatus, data: { actorName: name } });
          outboxId = await fanOut({ tx, deps, removePoweredBy: rpb, ticket: t, venue, tenantStatus: status, change: 'created', actorLabel: name, topic: 'ticket.created', webhook: 'ticket.created' });
          return t;
        });
        committed = true;
        await flushOutbox(deps, [outboxId]);
        return { ticket, existing: false };
      } catch (e) {
        const dup = (e as { code?: string }).code === 'ER_DUP_ENTRY';
        if (dup && /uq_open_ext_ref/.test(String((e as Error).message)) && body.externalRef) {
          const existing = await db.selectFrom('tickets').selectAll().where('venue_id', '=', venueId).where('open_external_ref', '=', body.externalRef).executeTakeFirst();
          if (existing && opts.viaApi) {
            await release(); // the existing ticket is returned; no new one was created
            return { ticket: existing, existing: true };
          }
          throw new AppError('EXTERNAL_REF_IN_USE', undefined, { data: existing ? { ticket: staffTicket(existing) } : undefined });
        }
        // uq_open_number duplicate or a deadlock: retry up to 3 times (TR-ALG-03).
        if ((dup || (e as { code?: string }).code === 'ER_LOCK_DEADLOCK') && attempt < 3) continue;
        throw e;
      }
    }
  } catch (e) {
    if (!committed) await release();
    throw e;
  }
}

async function lockTicket(tx: Tx, ticketId: string, venueId?: string): Promise<Ticket> {
  let q = tx.selectFrom('tickets').selectAll().where('id', '=', ticketId);
  if (venueId) q = q.where('venue_id', '=', venueId);
  const t = await q.forUpdate().executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  return t;
}

async function conflict(tx: Tx, t: Ticket): Promise<AppError> {
  const last = await tx
    .selectFrom('ticket_events')
    .select(['data'])
    .where('ticket_id', '=', t.id)
    .where('actor_type', 'in', ['staff_device', 'user', 'support', 'api_key', 'system'])
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const who = ((last?.data as Record<string, unknown> | null)?.actorName as string | undefined) ?? null;
  return new AppError('TICKET_VERSION_CONFLICT', who ? `Already changed by ${who}` : undefined, { data: { ticket: staffTicket(t, who), actor: who } });
}

export async function transitionTicket(
  deps: Deps,
  actor: TicketActor | { kind: 'system'; tenantId: string },
  ticketId: string,
  body: Omit<TransitionBody, 'version' | 'to'> & { version?: number; to: TicketStatus },
  opts: { venueId?: string; viaApi?: boolean } = {},
): Promise<{ ticket: Ticket; changed: boolean }> {
  const tenantId = actor.tenantId;
  const status = actor.kind === 'system' ? ((await getTenantStatus(deps, tenantId)) ?? 'active') : await requireStaffAllowed(deps, tenantId, 'transition', body.to, opts.viaApi);
  const db = deps.db.forTenant(tenantId);
  const now = deps.now();
  const name = await actorName(db, actor as Actor);
  let outboxId = 0;
  const rpb = await isEnabled(deps, tenantId, 'remove_powered_by');
  const result = await db.transaction().execute(async (tx) => {
    const t = await lockTicket(tx, ticketId, opts.venueId);
    const venue = loadVenueRow(await tx.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
    const verdict = checkTransition({
      from: t.status,
      to: body.to,
      actor: actor.kind === 'system' ? 'system' : actor.kind,
      now,
      collectedAt: t.collected_at,
      checkCodeMode: venue.settings.checkCode,
      ticketCheckCode: t.check_code,
      suppliedCheckCode: body.checkCode,
      cancelReason: body.cancelReason as CancelReason | undefined,
      viaIntegrationApi: opts.viaApi,
    });
    if (verdict.ok && verdict.idempotent) return { ticket: t, changed: false };
    // TR-TKT-01: version check (the integration API may omit it: last write wins).
    if (body.version !== undefined && body.version !== t.version) throw await conflict(tx, t);
    if (!verdict.ok) {
      throw new AppError(verdict.code, verdict.detail, verdict.code === 'INVALID_TRANSITION' ? { data: { ticket: staffTicket(t) } } : undefined);
    }
    const fx = transitionEffects(
      {
        status: t.status,
        readyRound: t.ready_round,
        preparingAt: t.preparing_at,
        readyAt: t.ready_at,
        firstReadyAt: t.first_ready_at,
        collectedAt: t.collected_at,
        cancelledAt: t.cancelled_at,
        expiredAt: t.expired_at,
        acknowledgedAt: t.acknowledged_at,
        autoAlertsSent: t.auto_alerts_sent,
        alertLevel: t.alert_level,
        alertLevelAtReady: t.alert_level_at_ready,
      },
      body.to,
      now,
      { cancelReason: body.cancelReason as CancelReason | undefined, cancelNote: body.cancelNote },
    );
    const p = fx.patch;
    await tx
      .updateTable('tickets')
      .set({
        status: body.to,
        version: sql`version + 1`,
        seq: sql`seq + 1`,
        ...(p.preparingAt !== undefined && { preparing_at: p.preparingAt }),
        ...(p.readyAt !== undefined && { ready_at: p.readyAt }),
        ...(p.firstReadyAt !== undefined && { first_ready_at: p.firstReadyAt }),
        ...(p.readyRound !== undefined && { ready_round: p.readyRound }),
        ...(p.autoAlertsSent !== undefined && { auto_alerts_sent: p.autoAlertsSent }),
        ...(p.acknowledgedAt !== undefined && { acknowledged_at: p.acknowledgedAt }),
        ...(p.alertLevelAtReady !== undefined && { alert_level_at_ready: p.alertLevelAtReady }),
        ...(p.collectedAt !== undefined && { collected_at: p.collectedAt }),
        ...(p.cancelledAt !== undefined && { cancelled_at: p.cancelledAt, cancel_reason: p.cancelReason ?? null, cancel_note: p.cancelNote ?? null }),
        ...(p.expiredAt !== undefined && { expired_at: p.expiredAt }),
      } as never)
      .where('id', '=', t.id)
      .execute();
    const updated = await tx.selectFrom('tickets').selectAll().where('id', '=', t.id).executeTakeFirstOrThrow();
    await writeEvent(tx, updated, 'transition', eventActor(actor as Actor), {
      from: t.status,
      to: body.to,
      data: {
        actorName: name,
        ...(fx.kind === 'undo' && { undo: true }),
        ...(fx.kind === 'reopen' && { reopen: true }),
        ...(body.cancelReason && { cancelReason: body.cancelReason }),
      },
    });
    outboxId = await fanOut({
      tx,
      deps,
      removePoweredBy: rpb,
      ticket: updated,
      venue,
      tenantStatus: status,
      change: 'status',
      reason: fx.kind === 'normal' ? undefined : fx.kind,
      actorLabel: name,
      webhook: fx.webhook,
      alertStart: fx.startAlerts
        ? { ticketId: t.id, round: updated.ready_round, repeatOffsetsSec: venue.settings.alerts.repeatOffsetsSec, maxAutoAlerts: venue.settings.alerts.maxAutoAlerts }
        : undefined,
    });
    return { ticket: updated, changed: true };
  });
  await flushOutbox(deps, [outboxId]);
  return result;
}

export async function editTicket(deps: Deps, actor: TicketActor, ticketId: string, body: EditTicketBody, opts: { venueId?: string } = {}): Promise<Ticket> {
  const tenantId = actor.tenantId;
  const status = await requireStaffAllowed(deps, tenantId, 'edit');
  const db = deps.db.forTenant(tenantId);
  const name = await actorName(db, actor);
  let outboxId = 0;
  const rpb = await isEnabled(deps, tenantId, 'remove_powered_by');
  const ticket = await db.transaction().execute(async (tx) => {
    const t = await lockTicket(tx, ticketId, opts.venueId);
    if (body.version !== t.version) throw await conflict(tx, t);
    if (!isOpen(t.status)) throw new AppError('INVALID_TRANSITION', 'Closed tickets cannot be edited');
    const patch: Record<string, unknown> = {};
    const events: Array<{ type: 'note_changed' | 'wait_changed'; data: Record<string, unknown> }> = [];
    if (body.note !== undefined) {
      patch.note = body.note || null;
      events.push({ type: 'note_changed', data: { field: 'note', actorName: name } });
    }
    if (body.externalRef !== undefined && body.externalRef !== t.external_ref) {
      if (body.externalRef) {
        const clash = await tx.selectFrom('tickets').select(['id', 'display_number']).where('venue_id', '=', t.venue_id).where('open_external_ref', '=', body.externalRef).where('id', '!=', t.id).executeTakeFirst();
        if (clash) throw new AppError('EXTERNAL_REF_IN_USE', `Receipt already on ticket ${clash.display_number}`);
      }
      patch.external_ref = body.externalRef || null;
      events.push({ type: 'note_changed', data: { field: 'externalRef', actorName: name } });
    }
    if (body.waitDeltaMinutes !== undefined && t.wait_minutes !== null) {
      // +5 / −5 keeps wait_base_at (TR-ALG-08).
      patch.wait_minutes = clampWait(t.wait_minutes + body.waitDeltaMinutes);
      events.push({ type: 'wait_changed', data: { from: t.wait_minutes, to: patch.wait_minutes, actorName: name } });
    }
    if (events.length === 0) return t;
    await tx.updateTable('tickets').set({ ...patch, version: sql`version + 1`, seq: sql`seq + 1` } as never).where('id', '=', t.id).execute();
    const updated = await tx.selectFrom('tickets').selectAll().where('id', '=', t.id).executeTakeFirstOrThrow();
    for (const e of events) await writeEvent(tx, updated, e.type, eventActor(actor), { data: e.data });
    const venue = loadVenueRow(await tx.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
    outboxId = await fanOut({ tx, deps, removePoweredBy: rpb, ticket: updated, venue, tenantStatus: status, change: events.some((e) => e.type === 'wait_changed') ? 'wait' : 'note', actorLabel: name });
    return updated;
  });
  await flushOutbox(deps, [outboxId]);
  return ticket;
}

/** "Alert again" (TR-ALR-22): immediate, counted, once per 15 s per ticket. */
export async function alertAgain(deps: Deps, actor: TicketActor, ticketId: string, opts: { venueId?: string } = {}): Promise<Ticket> {
  const tenantId = actor.tenantId;
  const status = await requireStaffAllowed(deps, tenantId, 'alert');
  const ok = await deps.kv.setNx(keys.manualAlert(ticketId), '1', Math.ceil(MANUAL_ALERT_MIN_INTERVAL_MS / 1000));
  if (!ok) throw new AppError('RATE_LIMITED', 'Wait a few seconds before alerting again');
  const db = deps.db.forTenant(tenantId);
  const name = await actorName(db, actor);
  let outboxId = 0;
  const rpb = await isEnabled(deps, tenantId, 'remove_powered_by');
  const ticket = await db.transaction().execute(async (tx) => {
    const t = await lockTicket(tx, ticketId, opts.venueId);
    if (t.status !== 'ready') throw new AppError('INVALID_TRANSITION', 'Only ready tickets can be alerted');
    await tx.updateTable('tickets').set({ manual_alerts_sent: sql`manual_alerts_sent + 1`, seq: sql`seq + 1` } as never).where('id', '=', t.id).execute();
    const updated = await tx.selectFrom('tickets').selectAll().where('id', '=', t.id).executeTakeFirstOrThrow();
    await writeEvent(tx, updated, 'alert_manual', eventActor(actor), { data: { actorName: name, n: updated.manual_alerts_sent } });
    const venue = loadVenueRow(await tx.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
    outboxId = await fanOut({
      tx,
      deps,
      removePoweredBy: rpb,
      ticket: updated,
      venue,
      tenantStatus: status,
      change: 'alert',
      actorLabel: name,
      manualAlert: { ticketId: t.id, round: updated.ready_round, attempt: updated.manual_alerts_sent },
    });
    return updated;
  });
  await flushOutbox(deps, [outboxId]);
  return ticket;
}

// ---------------------------------------------------------------- customer side (token-scoped)

export interface TokenTicket {
  ticket: Ticket;
  tenantStatus: TenantStatus;
}

/** Resolves a ticket by token (layer 1: ticket token is the credential) and its tenant. */
export async function ticketByToken(deps: Deps, token: string): Promise<TokenTicket> {
  const row = await deps.db.platform().selectFrom('tickets').select(['tenant_id']).where('token', '=', token).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  const tenantStatus = await getTenantStatus(deps, row.tenant_id);
  if (!tenantStatus || tenantStatus === 'deleted') throw new AppError('NOT_FOUND');
  const ticket = await deps.db.forTenant(row.tenant_id).selectFrom('tickets').selectAll().where('token', '=', token).executeTakeFirstOrThrow();
  // Trial expired / cancelled: closed tickets only (§8.2).
  if (tenantAccess(tenantStatus).customer === 'closed_only' && isOpen(ticket.status)) throw new AppError('NOT_FOUND');
  return { ticket, tenantStatus };
}

export async function publicTicketView(deps: Deps, token: string) {
  const { ticket, tenantStatus } = await ticketByToken(deps, token);
  const db = deps.db.forTenant(ticket.tenant_id);
  const venue = loadVenueRow(await db.selectFrom('venues').selectAll().where('id', '=', ticket.venue_id).executeTakeFirstOrThrow());
  const rated = Boolean(await db.selectFrom('ratings').select('id').where('ticket_id', '=', ticket.id).executeTakeFirst());
  return publicTicket(deps.config, ticket, venue, {
    counterName: await counterName(db, ticket.counter_id),
    tenantStatus,
    rated,
    now: deps.now(),
    removePoweredBy: await isEnabled(deps, ticket.tenant_id, 'remove_powered_by'),
  });
}

/** Customer-caused changes bump only seq (TR-TKT-04). */
async function customerChange(
  deps: Deps,
  tt: TokenTicket,
  fn: (tx: Tx, t: Ticket) => Promise<{ change: string; event?: { type: string; data?: Record<string, unknown> }; webhook?: string } | null>,
  topic: 'ticket.updated' | 'ticket.followed' = 'ticket.updated',
): Promise<Ticket> {
  const db = deps.db.forTenant(tt.ticket.tenant_id);
  const outboxIds: number[] = [];
  const rpb = await isEnabled(deps, tt.ticket.tenant_id, 'remove_powered_by');
  const ticket = await db.transaction().execute(async (tx) => {
    const t = await lockTicket(tx, tt.ticket.id);
    const r = await fn(tx, t);
    if (!r) return t;
    await tx.updateTable('tickets').set({ seq: sql`seq + 1` } as never).where('id', '=', t.id).execute();
    const updated = await tx.selectFrom('tickets').selectAll().where('id', '=', t.id).executeTakeFirstOrThrow();
    if (r.event) await writeEvent(tx, updated, r.event.type, { type: 'customer', id: null }, { data: r.event.data });
    const venue = loadVenueRow(await tx.selectFrom('venues').selectAll().where('id', '=', t.venue_id).executeTakeFirstOrThrow());
    outboxIds.push(await fanOut({ tx, deps, removePoweredBy: rpb, ticket: updated, venue, tenantStatus: tt.tenantStatus, change: r.change, webhook: r.webhook }));
    if (topic === 'ticket.followed') {
      outboxIds.push(await addOutbox(tx, 'ticket.followed', t.tenant_id, { venueId: t.venue_id, ticketId: t.id, emit: { id: t.id } }));
    }
    return updated;
  });
  await flushOutbox(deps, outboxIds);
  return ticket;
}

export async function acknowledge(deps: Deps, token: string): Promise<Ticket> {
  const tt = await ticketByToken(deps, token);
  return customerChange(deps, tt, async (tx, t) => {
    const v = canAcknowledge(t.status, t.acknowledged_at);
    if (v === 'invalid') throw new AppError('INVALID_TRANSITION', 'Only ready tickets can be acknowledged');
    if (v === 'idempotent') return null;
    await tx.updateTable('tickets').set({ acknowledged_at: deps.now() }).where('id', '=', t.id).execute();
    return { change: 'ack', event: { type: 'acknowledged', data: { round: t.ready_round } }, webhook: 'ticket.acknowledged' };
  });
}

export async function follow(
  deps: Deps,
  token: string,
  b: { clientId: string; joinedVia: 'ticket_qr' | 'link' | 'claim_code' | 'staff_approval' | 'home_screen'; uaFamily: string; locale?: string },
): Promise<{ firstFollower: boolean }> {
  const tt = await ticketByToken(deps, token);
  if (!isOpen(tt.ticket.status)) return { firstFollower: false };
  const db = deps.db.forTenant(tt.ticket.tenant_id);
  const venue = await db.selectFrom('venues').select('locales').where('id', '=', tt.ticket.venue_id).executeTakeFirstOrThrow();
  const locale = b.locale && (venue.locales as unknown as string[]).includes(b.locale) ? b.locale : (venue.locales as unknown as string[])[0]!;
  let first = false;
  await customerChange(
    deps,
    tt,
    async (tx, t) => {
      const existing = await tx.selectFrom('ticket_followers').select('id').where('ticket_id', '=', t.id).where('client_id', '=', b.clientId).executeTakeFirst();
      if (existing) {
        if (b.joinedVia === 'home_screen') await tx.updateTable('ticket_followers').set({ ua_family: b.uaFamily, locale }).where('id', '=', existing.id).execute();
        return null; // idempotent
      }
      const count = await tx.selectFrom('ticket_followers').select((eb) => eb.fn.countAll<number>().as('n')).where('ticket_id', '=', t.id).executeTakeFirstOrThrow();
      first = Number(count.n) === 0;
      await tx
        .insertInto('ticket_followers')
        .values({ id: uuidv7(), tenant_id: t.tenant_id, ticket_id: t.id, client_id: b.clientId, joined_via: b.joinedVia, locale, ua_family: b.uaFamily })
        .execute();
      return { change: 'follow', event: { type: 'follower_joined', data: { via: b.joinedVia, ua: b.uaFamily } } };
    },
    'ticket.followed',
  );
  return { firstFollower: first };
}

export async function alertsEnabled(deps: Deps, token: string, clientId: string): Promise<void> {
  const tt = await ticketByToken(deps, token);
  const db = deps.db.forTenant(tt.ticket.tenant_id);
  const r = await db
    .updateTable('ticket_followers')
    .set({ alerts_enabled_at: deps.now() })
    .where('ticket_id', '=', tt.ticket.id)
    .where('client_id', '=', clientId)
    .where('alerts_enabled_at', 'is', null)
    .executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) {
    const f = await db.selectFrom('ticket_followers').select('id').where('ticket_id', '=', tt.ticket.id).where('client_id', '=', clientId).executeTakeFirst();
    if (!f) throw new AppError('NOT_FOUND', 'Follow the ticket first');
  }
  await recomputeAlertLevel(deps, tt.ticket.tenant_id, tt.ticket.id);
}

const endpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

export async function savePushSubscription(
  deps: Deps,
  token: string,
  b: { clientId: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } },
  pushService: 'fcm' | 'apns' | 'mozilla' | 'wns',
): Promise<void> {
  const tt = await ticketByToken(deps, token);
  const pdb = deps.db.platform();
  const tdb = deps.db.forTenant(tt.ticket.tenant_id);
  const follower = await tdb.selectFrom('ticket_followers').select(['id', 'ua_family']).where('ticket_id', '=', tt.ticket.id).where('client_id', '=', b.clientId).executeTakeFirst();
  if (!follower) throw new AppError('NOT_FOUND', 'Follow the ticket first');
  const hash = endpointHash(b.subscription.endpoint);
  // push_subscriptions has no tenant (TR-TEN-17): one per phone browser, reached only through followers.
  let sub = await pdb.selectFrom('push_subscriptions').select(['id']).where('endpoint_hash', '=', hash).executeTakeFirst();
  if (!sub) {
    const id = uuidv7();
    await pdb
      .insertInto('push_subscriptions')
      .values({ id, client_id: b.clientId, endpoint: b.subscription.endpoint, endpoint_hash: hash, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, push_service: pushService, ua_family: follower.ua_family })
      .execute();
    sub = { id };
  } else {
    await pdb.updateTable('push_subscriptions').set({ p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, revoked_at: null, failure_count: 0, client_id: b.clientId }).where('id', '=', sub.id).execute();
  }
  // Every open ticket of this phone uses the same subscription.
  await tdb.updateTable('ticket_followers').set({ push_subscription_id: sub.id }).where('id', '=', follower.id).execute();
  await recomputeAlertLevel(deps, tt.ticket.tenant_id, tt.ticket.id);
}

export async function deletePushSubscription(deps: Deps, token: string, clientId: string): Promise<void> {
  const tt = await ticketByToken(deps, token);
  await deps.db.forTenant(tt.ticket.tenant_id).updateTable('ticket_followers').set({ push_subscription_id: null }).where('ticket_id', '=', tt.ticket.id).where('client_id', '=', clientId).execute();
  await recomputeAlertLevel(deps, tt.ticket.tenant_id, tt.ticket.id);
}

/**
 * Recomputes the ticket alert level from followers, push subscriptions and Redis presence (TR-ALG-11/12).
 * Only changes are written (event alert_level_changed, seq bump) and broadcast; heartbeats never touch MySQL.
 */
export async function recomputeAlertLevel(deps: Deps, tenantId: string, ticketId: string): Promise<void> {
  const db = deps.db.forTenant(tenantId);
  const t = await db.selectFrom('tickets').select(['id', 'status', 'alert_level', 'tenant_id', 'venue_id', 'token']).where('id', '=', ticketId).executeTakeFirst();
  if (!t || !isOpen(t.status)) return;
  const followers = await db.selectFrom('ticket_followers').select(['client_id', 'push_subscription_id']).where('ticket_id', '=', ticketId).execute();
  const subIds = followers.map((f) => f.push_subscription_id).filter((x): x is string => Boolean(x));
  const activeSubs = subIds.length
    ? new Set((await deps.db.platform().selectFrom('push_subscriptions').select('id').where('id', 'in', subIds).where('revoked_at', 'is', null).execute()).map((s) => s.id))
    : new Set<string>();
  const levels = await Promise.all(
    followers.map(async (f) =>
      followerLevel({
        hasActivePush: Boolean(f.push_subscription_id && activeSubs.has(f.push_subscription_id)),
        present: await deps.kv.exists(keys.presence(ticketId, f.client_id)),
        wasLive: await deps.kv.exists(keys.wasLive(ticketId, f.client_id)),
      }),
    ),
  );
  const level = ticketLevel(levels);
  if (level === t.alert_level) return;
  const status = (await getTenantStatus(deps, tenantId)) ?? 'active';
  await customerChange(deps, { ticket: (await db.selectFrom('tickets').selectAll().where('id', '=', ticketId).executeTakeFirstOrThrow()), tenantStatus: status }, async (tx, locked) => {
    if (locked.alert_level === level) return null;
    await tx.updateTable('tickets').set({ alert_level: level }).where('id', '=', locked.id).execute();
    return { change: 'alert_level', event: { type: 'alert_level_changed', data: { from: locked.alert_level, to: level } } };
  });
}

// ---------------------------------------------------------------- board snapshots

export async function staffBoardTickets(deps: Deps, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  const now = deps.now();
  const open = await db.selectFrom('tickets').selectAll().where('venue_id', '=', venueId).where('status', 'in', ['received', 'preparing', 'ready']).orderBy('created_at').execute();
  const recent = await db
    .selectFrom('tickets')
    .selectAll()
    .where('venue_id', '=', venueId)
    .where('status', 'in', ['collected', 'cancelled', 'expired'])
    .where('updated_at', '>=', new Date(now.getTime() - 30 * 60_000))
    .orderBy('updated_at', 'desc')
    .limit(100)
    .execute();
  // Collected on the venue's current business date (FR-STF-01): the same number after a reload or a long shift.
  const v = await db.selectFrom('venues').select(['time_zone', 'reset_time', 'pending_reset_time', 'pending_time_zone', 'pending_from_date']).where('id', '=', venueId).executeTakeFirstOrThrow();
  const bd = businessDate(now, v.time_zone, { resetTime: v.reset_time, pendingResetTime: v.pending_reset_time, pendingTimeZone: v.pending_time_zone, pendingFromDate: v.pending_from_date });
  const collected = await db
    .selectFrom('tickets')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('venue_id', '=', venueId)
    .where('business_date', '=', bd)
    .where('status', '=', 'collected')
    .executeTakeFirstOrThrow();
  return { open: open.map((t) => staffTicket(t)), recent: recent.map((t) => staffTicket(t)), collectedToday: Number(collected.n), businessDate: bd };
}

export async function searchTickets(deps: Deps, tenantId: string, venueId: string, q: string) {
  const db = deps.db.forTenant(tenantId);
  const term = q.trim().toUpperCase();
  const rows = await db
    .selectFrom('tickets')
    .selectAll()
    .where('venue_id', '=', venueId)
    .where((eb) => eb.or([eb('display_number', '=', term), eb('external_ref', '=', q.trim())]))
    .orderBy('business_date', 'desc')
    .orderBy('created_at', 'desc')
    .limit(20)
    .execute();
  return rows.map((t) => staffTicket(t));
}

// ---------------------------------------------------------------- auto-close sweep (TR-ALG-10, TR-ALG-16)

export async function autoCloseVenue(deps: Deps, tenantId: string, venueId: string): Promise<number> {
  const db = deps.db.forTenant(tenantId);
  const now = deps.now();
  let expired = 0;
  for (;;) {
    const batch = await db.selectFrom('tickets').select('id').where('venue_id', '=', venueId).where('status', 'in', ['received', 'preparing', 'ready']).limit(500).execute();
    if (batch.length === 0) break;
    for (const b of batch) {
      const r = await transitionTicket(deps, { kind: 'system', tenantId }, b.id, { to: 'expired' }).catch((e: unknown) => {
        deps.log.warn({ err: e, ticketId: b.id }, 'expire failed');
        return null;
      });
      if (r?.changed) expired++;
    }
    if (batch.length < 500) break;
  }
  // Under the venue row lock, so a settings change saved meanwhile is neither lost nor promoted early.
  await db.transaction().execute(async (tx) => {
    const v = await tx.selectFrom('venues').selectAll().where('id', '=', venueId).forUpdate().executeTakeFirstOrThrow();
    // Pending times become current from their business date (BR-27, TR-ALG-16).
    const today = businessDate(now, v.time_zone, { resetTime: v.reset_time, pendingResetTime: v.pending_reset_time, pendingTimeZone: v.pending_time_zone, pendingFromDate: v.pending_from_date });
    const promote = v.pending_from_date !== null && today >= v.pending_from_date;
    const autoCloseTime = promote && v.pending_auto_close_time ? v.pending_auto_close_time : v.auto_close_time;
    const zone = promote && v.pending_time_zone ? v.pending_time_zone : v.time_zone;
    // A change still waiting for its date is scheduled from its first effective occurrence (BW05).
    const next = promote
      ? nextOccurrence(now, zone, autoCloseTime)
      : nextScheduledOccurrence(now, {
          timeZone: v.time_zone,
          resetTime: v.reset_time,
          time: v.auto_close_time,
          pendingTimeZone: v.pending_time_zone,
          pendingResetTime: v.pending_reset_time,
          pendingTime: v.pending_auto_close_time,
          pendingFromDate: v.pending_from_date,
        });
    await tx
      .updateTable('venues')
      .set({
        ...(promote && {
          reset_time: v.pending_reset_time ?? v.reset_time,
          auto_close_time: autoCloseTime,
          pending_reset_time: null,
          pending_auto_close_time: null,
          time_zone: zone,
          pending_time_zone: null,
          pending_from_date: null,
        }),
        next_auto_close_at: next,
      })
      .where('id', '=', venueId)
      .execute();
  });
  return expired;
}

export async function venuesDueForAutoClose(deps: Deps, limit = 500) {
  return deps.db
    .platform()
    .selectFrom('venues')
    .select(['id', 'tenant_id'])
    .where('status', '=', 'active')
    .where('next_auto_close_at', '<=', deps.now())
    .limit(limit)
    .execute();
}

export { scope };

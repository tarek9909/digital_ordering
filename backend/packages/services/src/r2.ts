import type { Actor } from '@dop/auth';
import { hashSecret, verifySecret } from '@dop/auth';
import { AppError, defaultVenueSettings } from '@dop/contracts';
import { checkPin, newSecretToken, percentile, toZoned, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { csvCell } from './csv.js';
import type { Deps } from './deps.js';
import { getSetting, isEnabled, requireFeature, requireWithinLimit } from './platform.js';
import { createVenueRow } from './venues.js';

// R2 services: multi-site venues (FR-TEN-07/10, FR-ADM-17), named staff (FR-ACC-07, TR-AUTH-12),
// calculated wait (TR-ALG-09), CSV export (TR-RPT-04), mandatory two-factor for multi-venue tenants (NFR-SEC-04).

// ---------------------------------------------------------------- multi-site venues

export async function createVenue(deps: Deps, actor: Actor, tenantId: string, name: string) {
  const db = deps.db.forTenant(tenantId);
  const defaults = await getSetting(deps, 'tenant.defaults');
  const first = await db.selectFrom('venues').select(['time_zone', 'locales']).where('status', '=', 'active').orderBy('created_at').executeTakeFirst();
  let venueId = '';
  await deps.db.platform().transaction().execute(async (tx) => {
    // Counted under a lock on the tenant row so parallel requests cannot pass the plan limit together (L-12).
    await tx.selectFrom('tenants').select('id').where('id', '=', tenantId).forUpdate().executeTakeFirst();
    const n = Number((await tx.selectFrom('venues').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'active').executeTakeFirstOrThrow()).n);
    await requireWithinLimit(deps, tenantId, 'maxVenues', n);
    if (n >= 1) await requireFeature(deps, tenantId, 'multi_venue');
    const r = await createVenueRow(tx, deps, tenantId, {
      name,
      timeZone: first?.time_zone ?? defaults.timeZone,
      locales: (first?.locales as unknown as string[]) ?? defaults.locales,
      resetTime: defaults.resetTime,
      autoCloseTime: defaults.autoCloseTime,
      settings: defaultVenueSettings(),
    });
    venueId = r.venueId;
    await writeAudit(tx, { actor, action: 'venue.created', tenantId, entityType: 'venue', entityId: venueId, after: { name } });
  });
  return { id: venueId };
}

/** Venues are archived, never deleted (TR-DB-13); open tickets must be closed first. */
export async function archiveVenue(deps: Deps, actor: Actor, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst())) throw new AppError('NOT_FOUND');
  const active = Number((await db.selectFrom('venues').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirstOrThrow()).n);
  if (active <= 1) throw new AppError('FORBIDDEN', 'A tenant keeps at least one venue');
  const open = await db.selectFrom('tickets').select('id').where('venue_id', '=', venueId).where('status', 'in', ['received', 'preparing', 'ready']).limit(1).executeTakeFirst();
  if (open) throw new AppError('INVALID_TRANSITION', 'Close the open tickets of this venue first');
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('venues').set({ status: 'archived' }).where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await tx.updateTable('staff_devices').set({ revoked_at: deps.now(), revoked_reason: 'removed' }).where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
    await tx.updateTable('displays').set({ revoked_at: deps.now(), session_hash: null }).where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
    await tx.updateTable('api_keys').set({ revoked_at: deps.now() }).where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
    await writeAudit(tx, { actor, action: 'venue.archived', tenantId, entityType: 'venue', entityId: venueId });
  });
}

/** Owners and managers of tenants with more than one venue must use two-factor sign-in (TR-AUTH-11, NFR-SEC-04). */
export async function mfaRequiredFor(deps: Deps, tenantId: string): Promise<boolean> {
  const n = Number((await deps.db.forTenant(tenantId).selectFrom('venues').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirstOrThrow()).n);
  return n > 1;
}

// ---------------------------------------------------------------- named staff (FR-ACC-07, TR-AUTH-12)

export async function listStaffMembers(deps: Deps, tenantId: string, venueId: string) {
  if (!(await deps.db.forTenant(tenantId).selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  const rows = await deps.db.forTenant(tenantId).selectFrom('staff_members').select(['id', 'name', 'active', 'created_at']).where('venue_id', '=', venueId).orderBy('name').execute();
  return rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active) }));
}

export async function createStaffMember(deps: Deps, actor: Actor, tenantId: string, venueId: string, name: string, pin: string) {
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst())) throw new AppError('NOT_FOUND');
  await requireFeature(deps, tenantId, 'named_staff');
  if (checkPin(pin) !== 'ok') throw new AppError('VALIDATION_FAILED', 'Choose a PIN that is not a sequence or repeated digit', { errors: [{ path: 'pin', message: 'weak' }] });
  // Personal PINs are unique per venue (checked in code, §7.5).
  for (const m of await db.selectFrom('staff_members').select('pin_hash').where('venue_id', '=', venueId).where('active', '=', true).execute()) {
    if (await verifySecret(m.pin_hash, pin)) throw new AppError('VALIDATION_FAILED', 'Another staff member uses this PIN', { errors: [{ path: 'pin', message: 'taken' }] });
  }
  const id = uuidv7();
  await db.insertInto('staff_members').values({ id, tenant_id: tenantId, venue_id: venueId, name, pin_hash: await hashSecret(pin) }).execute();
  await writeAudit(deps.db.platform(), { actor, action: 'venue.updated', tenantId, entityType: 'staff_member', entityId: id, after: { name } });
  return { id };
}

export async function deactivateStaffMember(deps: Deps, tenantId: string, id: string) {
  const r = await deps.db.forTenant(tenantId).updateTable('staff_members').set({ active: false }).where('id', '=', id).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
}

/** The board asks for a personal PIN before an action group; the member token lasts 2 idle minutes. */
export async function staffMemberUnlock(deps: Deps, tenantId: string, venueId: string, deviceId: string, pin: string) {
  const db = deps.db.forTenant(tenantId);
  const k = `pin:member:${deviceId}`;
  if (Number((await deps.kv.get(k)) ?? 0) >= 5) {
    const retryAfterSeconds = (await deps.kv.ttl(k)) ?? 600;
    throw new AppError('PIN_LOCKED', 'Too many wrong PINs', { data: { retryAfterSeconds, lockedUntil: new Date(deps.now().getTime() + retryAfterSeconds * 1000).toISOString() } });
  }
  for (const m of await db.selectFrom('staff_members').select(['id', 'name', 'pin_hash']).where('venue_id', '=', venueId).where('active', '=', true).execute()) {
    if (await verifySecret(m.pin_hash, pin)) {
      const token = newSecretToken();
      await deps.kv.set(`member:${token}`, JSON.stringify({ memberId: m.id, name: m.name, deviceId, tenantId, venueId }), 120);
      await deps.kv.del(k);
      return { memberToken: token, name: m.name };
    }
  }
  await deps.kv.incr(k, 600);
  throw new AppError('UNAUTHENTICATED', 'Wrong PIN');
}

/**
 * Resolves and slides the 2-minute idle window; null when expired, for another device, or when the member was
 * deactivated or moved since the PIN was entered (A06). A token of an inactive member is deleted, not refreshed.
 */
export async function staffMemberFor(deps: Deps, token: string, deviceId: string, tenantId?: string): Promise<{ memberId: string; name: string } | null> {
  const raw = await deps.kv.get(`member:${token}`);
  if (!raw) return null;
  const v = JSON.parse(raw) as { memberId: string; name: string; deviceId: string; tenantId?: string; venueId?: string };
  if (v.deviceId !== deviceId) return null;
  const owner = v.tenantId ?? tenantId;
  if (!owner || (tenantId && owner !== tenantId)) return null;
  const m = await deps.db.forTenant(owner).selectFrom('staff_members').select(['active', 'venue_id', 'name']).where('id', '=', v.memberId).executeTakeFirst();
  if (!m || !m.active || (v.venueId && m.venue_id !== v.venueId)) {
    await deps.kv.del(`member:${token}`);
    return null;
  }
  await deps.kv.set(`member:${token}`, raw, 120);
  return { memberId: v.memberId, name: m.name };
}

export const namedStaffOn = (deps: Deps, tenantId: string) => isEnabled(deps, tenantId, 'named_staff');

// ---------------------------------------------------------------- calculated wait (TR-ALG-09)

/**
 * Median of first_ready_at − created_at for the last 20 tickets of the venue and counter created in the last 2 hours;
 * fewer than 5 samples → the default. Shown as a range [median × 0.8, median × 1.2].
 */
export async function calculatedWait(deps: Deps, tenantId: string, venueId: string, counterId: string | null, fallback: number) {
  let q = deps.db
    .forTenant(tenantId)
    .selectFrom('tickets')
    .select(['created_at', 'first_ready_at'])
    .where('venue_id', '=', venueId)
    .where('first_ready_at', 'is not', null)
    .where('created_at', '>', new Date(deps.now().getTime() - 2 * 3600_000))
    .orderBy('created_at', 'desc')
    .limit(20);
  q = counterId ? q.where('counter_id', '=', counterId) : q.where('counter_id', 'is', null);
  const rows = await q.execute();
  if (rows.length < 5) return { minutes: fallback, range: null as [number, number] | null };
  const mins = rows.map((r) => (r.first_ready_at!.getTime() - r.created_at.getTime()) / 60_000);
  const median = percentile(mins, 50)!;
  return { minutes: Math.max(1, Math.round(median)), range: [Math.max(1, Math.round(median * 0.8)), Math.max(1, Math.round(median * 1.2))] as [number, number] };
}

// ---------------------------------------------------------------- CSV export (TR-RPT-04)

// Cells go through the shared spreadsheet-safe encoder (M-8): receipts, notes and venue names are untrusted.
const cell = csvCell;

/** Streams rows in pages; UTF-8 with BOM; venue-local times with the zone in the header (Pro, `csv_export`). */
export async function* ticketsCsv(deps: Deps, tenantId: string, f: { venueId?: string; counterId?: string; from: string; to: string }): AsyncGenerator<string> {
  await requireFeature(deps, tenantId, 'csv_export');
  const db = deps.db.forTenant(tenantId);
  const venues = await db.selectFrom('venues').select(['id', 'name', 'time_zone']).execute();
  const tz = new Map(venues.map((v) => [v.id, v]));
  // A counter filter exports what the filtered report shows (W03, FR-RPT-04); a foreign counter is a 404.
  if (f.counterId) {
    const c = await db.selectFrom('counters').select('venue_id').where('id', '=', f.counterId).executeTakeFirst();
    if (!c || (f.venueId && c.venue_id !== f.venueId)) throw new AppError('NOT_FOUND');
  }
  const zone = f.venueId ? (tz.get(f.venueId)?.time_zone ?? 'UTC') : venues[0]?.time_zone ?? 'UTC';
  yield `\uFEFFvenue,business_date,number,status,receipt,created (${zone}),ready (${zone}),collected (${zone}),alert_level_at_ready,acknowledged,cancel_reason\n`;
  const local = (d: Date | null, venueId: string) => {
    if (!d) return '';
    const z = toZoned(d, tz.get(venueId)?.time_zone ?? zone);
    return `${z.date} ${z.time}`;
  };
  let lastId = '';
  for (;;) {
    let q = db
      .selectFrom('tickets')
      .select(['id', 'venue_id', 'business_date', 'display_number', 'status', 'external_ref', 'created_at', 'first_ready_at', 'collected_at', 'alert_level_at_ready', 'acknowledged_at', 'cancel_reason'])
      .where('business_date', '>=', f.from)
      .where('business_date', '<=', f.to)
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(1000);
    if (f.venueId) q = q.where('venue_id', '=', f.venueId);
    if (f.counterId) q = q.where('counter_id', '=', f.counterId);
    const rows = await q.execute();
    if (rows.length === 0) return;
    yield rows
      .map((r) =>
        [tz.get(r.venue_id)?.name, r.business_date, r.display_number, r.status, r.external_ref, local(r.created_at, r.venue_id), local(r.first_ready_at, r.venue_id), local(r.collected_at, r.venue_id), r.alert_level_at_ready, r.acknowledged_at ? 'yes' : 'no', r.cancel_reason]
          .map(cell)
          .join(','),
      )
      .join('\n') + '\n';
    lastId = rows[rows.length - 1]!.id;
  }
}

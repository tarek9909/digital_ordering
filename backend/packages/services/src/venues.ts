import { randomInt } from 'node:crypto';
import { SESSION_TTL, decrypt, encrypt, hashSecret, tokenHash, verifySecret, type Actor } from '@dop/auth';
import {
  AppError,
  defaultVenueSettings,
  displaySettingsSchema,
  venueMessagesSchema,
  venueSettingsSchema,
  type DisplaySettings,
  type VenueMessages,
  type VenueSettings,
} from '@dop/contracts';
import { json, type Db, type Tx } from '@dop/db';
import {
  addDays,
  businessDate,
  checkPin,
  isValidTimeZone,
  newPairingCode,
  newSecretToken,
  newStaffKey,
  newVenueCode,
  nextOccurrence,
  nextScheduledOccurrence,
  normaliseTime,
  plainDomain,
  uuidv7,
} from '@dop/domain';
import { writeAudit } from './audit.js';
import { urls, type Deps } from './deps.js';
import { sendEmail } from './email.js';
import { keys } from './kv.js';
import { addOutbox, flushOutbox } from './outbox.js';
import { requireFeature, requireWithinLimit } from './platform.js';
import { loadVenueRow } from './projections.js';

// Venues, staff access and displays (FR-ADM-03 – FR-ADM-09, FR-ACC-01 – FR-ACC-06, FR-DSP-01, FR-DSP-10).

export async function uniqueVenueCode(db: Db | Tx): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newVenueCode();
    const clash = await db.selectFrom('venues').select('id').where('venue_code', '=', code).executeTakeFirst();
    if (!clash) return code;
  }
  throw new AppError('INTERNAL_ERROR', 'Could not allocate a venue code');
}

export async function createVenueRow(
  tx: Tx,
  deps: Deps,
  tenantId: string,
  v: { name: string; timeZone: string; locales: string[]; resetTime: string; autoCloseTime: string; settings?: VenueSettings },
): Promise<{ venueId: string; initialPin: string }> {
  const id = uuidv7();
  const now = deps.now();
  await tx
    .insertInto('venues')
    .values({
      id,
      tenant_id: tenantId,
      name: v.name,
      venue_code: await uniqueVenueCode(tx),
      time_zone: v.timeZone,
      locales: json(v.locales),
      messages: json({}),
      settings: json(v.settings ?? defaultVenueSettings()),
      reset_time: normaliseTime(v.resetTime),
      auto_close_time: normaliseTime(v.autoCloseTime),
      next_auto_close_at: nextOccurrence(now, v.timeZone, v.autoCloseTime),
    })
    .execute();
  // Staff access: random key and a random PIN the owner replaces during setup (FR-ADM-02 checklist).
  const staffKey = newStaffKey();
  let initialPin = '';
  do initialPin = String(randomInt(100000, 1000000));
  while (checkPin(initialPin) !== 'ok');
  await tx
    .insertInto('staff_access')
    .values({
      venue_id: id,
      tenant_id: tenantId,
      staff_key_enc: await encrypt(deps.keys, staffKey),
      staff_key_hash: tokenHash(deps.config.pepper, staffKey),
      pin_hash: await hashSecret(initialPin),
      key_rotated_at: now,
      pin_changed_at: now,
    })
    .execute();
  return { venueId: id, initialPin };
}

export async function getVenueAdmin(deps: Deps, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  const row = await db.selectFrom('venues').selectAll().where('id', '=', venueId).executeTakeFirst();
  if (!row) throw new AppError('NOT_FOUND');
  const v = loadVenueRow(row);
  return {
    id: row.id,
    name: row.name,
    venueCode: row.venue_code,
    venueUrl: urls(deps.config).venue(row.venue_code),
    timeZone: row.time_zone,
    locales: v.locales,
    logoUrl: urls(deps.config).logo(row.logo_key),
    brandColor: row.brand_color,
    messages: v.messages,
    settings: v.settings,
    resetTime: row.reset_time.slice(0, 5),
    autoCloseTime: row.auto_close_time.slice(0, 5),
    pendingResetTime: row.pending_reset_time?.slice(0, 5) ?? null,
    pendingAutoCloseTime: row.pending_auto_close_time?.slice(0, 5) ?? null,
    pendingTimeZone: row.pending_time_zone,
    address: (row.address as Record<string, string> | null) ?? null,
    pendingFromDate: row.pending_from_date,
    status: row.status,
  };
}

export async function listVenues(deps: Deps, tenantId: string) {
  return deps.db.forTenant(tenantId).selectFrom('venues').select(['id', 'name', 'venue_code', 'status']).where('status', '=', 'active').orderBy('created_at').execute();
}

async function publishVenueChange(deps: Deps, tx: Tx, tenantId: string, venueId: string) {
  const row = await tx.selectFrom('venues').selectAll().where('id', '=', venueId).executeTakeFirstOrThrow();
  const v = loadVenueRow(row);
  return addOutbox(tx, 'venue.settings_changed', tenantId, {
    venueId,
    emit: { name: row.name, brandColor: row.brand_color, logoUrl: urls(deps.config).logo(row.logo_key), messages: v.messages, locales: v.locales, settings: v.settings },
  });
}

export async function updateVenue(
  deps: Deps,
  actor: Actor,
  tenantId: string,
  venueId: string,
  b: { name?: string; timeZone?: string; locales?: string[]; brandColor?: string; resetTime?: string; autoCloseTime?: string; address?: Record<string, string> | null },
  requestId?: string,
) {
  const db = deps.db.forTenant(tenantId);
  if (b.timeZone && !isValidTimeZone(b.timeZone)) throw new AppError('VALIDATION_FAILED', 'Unknown time zone', { errors: [{ path: 'timeZone', message: 'unknown' }] });
  if (b.locales) {
    const enabled = new Set((await deps.db.platform().selectFrom('languages').select('code').where('customer_enabled', '=', true).execute()).map((l) => l.code));
    const bad = b.locales.filter((l) => !enabled.has(l));
    if (bad.length) throw new AppError('VALIDATION_FAILED', 'Language not available', { errors: [{ path: 'locales', message: bad.join(',') }] });
    await requireWithinLimit(deps, tenantId, 'maxLanguages', b.locales.length - 1);
  }
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    const before = await tx.selectFrom('venues').selectAll().where('id', '=', venueId).forUpdate().executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    const patch: Record<string, unknown> = {};
    if (b.name) patch.name = b.name;
    if (b.locales) patch.locales = json(b.locales);
    if (b.brandColor) patch.brand_color = b.brandColor.toUpperCase();
    if (b.address !== undefined) patch.address = b.address === null ? null : json(b.address);
    // Reset, auto-close and zone changes apply from the next business date (BR-27, TR-ALG-16, EX-18).
    if (b.resetTime || b.autoCloseTime || b.timeZone) {
      const now = deps.now();
      const today = businessDate(now, before.time_zone, { resetTime: before.reset_time, pendingResetTime: before.pending_reset_time, pendingTimeZone: before.pending_time_zone, pendingFromDate: before.pending_from_date });
      const fromDate = addDays(today, 1);
      const pendingReset = normaliseTime(b.resetTime ?? before.pending_reset_time ?? before.reset_time);
      const pendingAutoClose = normaliseTime(b.autoCloseTime ?? before.pending_auto_close_time ?? before.auto_close_time);
      // The zone also waits for the next business date (A13): today's tickets, schedule and reports keep the
      // zone they started with.
      const zone = b.timeZone ?? before.pending_time_zone;
      const pendingZone = zone && zone !== before.time_zone ? zone : null;
      patch.pending_from_date = fromDate;
      patch.pending_reset_time = pendingReset;
      patch.pending_auto_close_time = pendingAutoClose;
      patch.pending_time_zone = pendingZone;
      // The current day still closes at its current auto-close time; the first effective day closes at the new
      // time, reset and zone, even when that comes before the current day's next close would have (BW05).
      patch.next_auto_close_at = nextScheduledOccurrence(now, {
        timeZone: before.time_zone,
        resetTime: before.reset_time,
        time: before.auto_close_time,
        pendingTimeZone: pendingZone,
        pendingResetTime: pendingReset,
        pendingTime: pendingAutoClose,
        pendingFromDate: fromDate,
      });
    }
    if (Object.keys(patch).length === 0) return; // nothing to change (A10)
    await tx.updateTable('venues').set(patch).where('id', '=', venueId).execute();
    await writeAudit(tx, { actor, action: 'venue.updated', tenantId, entityType: 'venue', entityId: venueId, after: b, requestId });
    outboxId = await publishVenueChange(deps, tx, tenantId, venueId);
  });
  await flushOutbox(deps, [outboxId]);
  return getVenueAdmin(deps, tenantId, venueId);
}

/** Links in venue texts must be https and are shown as plain domains (NFR-SEC-06). */
function checkMessages(m: VenueMessages): VenueMessages {
  for (const [locale, msgs] of Object.entries(m)) {
    if (msgs.websiteUrl && !plainDomain(msgs.websiteUrl)) throw new AppError('VALIDATION_FAILED', 'Invalid link', { errors: [{ path: `${locale}.websiteUrl`, message: 'invalid' }] });
  }
  return m;
}

export async function putVenueMessages(deps: Deps, actor: Actor, tenantId: string, venueId: string, messages: VenueMessages) {
  const parsed = checkMessages(venueMessagesSchema.parse(messages));
  return putVenueJson(deps, actor, tenantId, venueId, 'messages', parsed);
}

export async function putVenueSettings(deps: Deps, actor: Actor, tenantId: string, venueId: string, settings: VenueSettings) {
  const parsed = venueSettingsSchema.parse(settings);
  const current = await deps.db.forTenant(tenantId).selectFrom('venues').select('settings').where('id', '=', venueId).executeTakeFirst();
  if (!current) throw new AppError('NOT_FOUND');
  // A new chime must come from the platform library (FR-ADM-08); a venue keeps one that was later withdrawn.
  const before = (current.settings as unknown as { alerts?: { chime?: string } }).alerts?.chime;
  if (parsed.alerts.chime !== before) {
    const ok = await deps.db.platform().selectFrom('chimes').select('id').where('code', '=', parsed.alerts.chime).where('active', '=', true).executeTakeFirst();
    if (!ok) throw new AppError('VALIDATION_FAILED', 'Choose a chime from the library', { errors: [{ path: 'alerts.chime', message: 'unknown' }] });
  }
  if (parsed.numbering.prefixesEnabled) {
    await requireFeature(deps, tenantId, 'counters');
  }
  return putVenueJson(deps, actor, tenantId, venueId, 'settings', parsed);
}

async function putVenueJson(deps: Deps, actor: Actor, tenantId: string, venueId: string, column: 'settings' | 'messages', value: unknown) {
  const db = deps.db.forTenant(tenantId);
  let outboxId = 0;
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('venues').set({ [column]: json(value) }).where('id', '=', venueId).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) {
      const exists = await tx.selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst();
      if (!exists) throw new AppError('NOT_FOUND');
    }
    await writeAudit(tx, { actor, action: 'venue.settings_changed', tenantId, entityType: 'venue', entityId: venueId, after: { [column]: value } });
    outboxId = await publishVenueChange(deps, tx, tenantId, venueId);
  });
  await flushOutbox(deps, [outboxId]);
  return getVenueAdmin(deps, tenantId, venueId);
}

// ---------------------------------------------------------------- staff access

export async function staffAccessInfo(deps: Deps, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  const sa = await db.selectFrom('staff_access').selectAll().where('venue_id', '=', venueId).executeTakeFirst();
  if (!sa) throw new AppError('NOT_FOUND');
  const tenant = await deps.db.platform().selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirstOrThrow();
  const staffKey = await decrypt(deps.keys, sa.staff_key_enc);
  return { link: urls(deps.config).staff(tenant.slug, staffKey), keyRotatedAt: sa.key_rotated_at.toISOString(), pinChangedAt: sa.pin_changed_at.toISOString() };
}

async function revokeVenueDevices(deps: Deps, tx: Tx, tenantId: string, venueId: string, reason: 'link_reset' | 'pin_changed' | 'platform') {
  const devices = await tx.selectFrom('staff_devices').select('id').where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
  if (!devices.length) return [] as number[];
  await tx.updateTable('staff_devices').set({ revoked_at: deps.now(), revoked_reason: reason }).where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
  return [await addOutbox(tx, 'device.revoked', tenantId, { venueId, emit: { deviceIds: devices.map((d) => d.id) } })];
}

/** Rotating the link signs out every device of the venue (FR-ACC-03). */
export async function rotateStaffLink(deps: Deps, actor: Actor, tenantId: string, venueId: string) {
  const db = deps.db.forTenant(tenantId);
  const key = newStaffKey();
  let ids: number[] = [];
  await db.transaction().execute(async (tx) => {
    const r = await tx
      .updateTable('staff_access')
      .set({ staff_key_enc: await encrypt(deps.keys, key), staff_key_hash: tokenHash(deps.config.pepper, key), key_rotated_at: deps.now() })
      .where('venue_id', '=', venueId)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    ids = await revokeVenueDevices(deps, tx, tenantId, venueId, 'link_reset');
    await writeAudit(tx, { actor, action: 'staff.link_rotated', tenantId, entityType: 'venue', entityId: venueId });
  });
  await flushOutbox(deps, ids);
  return staffAccessInfo(deps, tenantId, venueId);
}

/** Changing the PIN signs out every device (FR-ACC-04); weak PINs are refused (TR-SEC-06). */
export async function setStaffPin(deps: Deps, actor: Actor, tenantId: string, venueId: string, pin: string) {
  const v = checkPin(pin);
  if (v !== 'ok') throw new AppError('VALIDATION_FAILED', v === 'weak' ? 'Choose a PIN that is not a sequence or repeated digit' : 'PIN must be 4–6 digits', { errors: [{ path: 'pin', message: v }] });
  const db = deps.db.forTenant(tenantId);
  let ids: number[] = [];
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('staff_access').set({ pin_hash: await hashSecret(pin), pin_changed_at: deps.now() }).where('venue_id', '=', venueId).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    ids = await revokeVenueDevices(deps, tx, tenantId, venueId, 'pin_changed');
    await writeAudit(tx, { actor, action: 'staff.pin_changed', tenantId, entityType: 'venue', entityId: venueId });
  });
  await flushOutbox(deps, ids);
}

/**
 * Staff board sign-in with staff key + PIN (FR-ACC-01). Lockout: 5 wrong attempts per client address
 * → 10 minutes; 20 per venue per hour → venue sign-in locked 15 minutes and the owner emailed (TR-SEC-06).
 * The address is the server's view of the client (L-4): a cookie the client controls never resets the count.
 * While the venue is locked, addresses that signed a board in at this venue in the last 30 days may still try
 * (with their own 5-try limit), so someone holding the staff link cannot lock the restaurant's own devices out.
 */
export async function staffSignIn(
  deps: Deps,
  b: { staffKey: string; pin: string; deviceName: string },
  /** `fingerprint` is ignored: lockout keys use the server-seen address (L-4). */
  client: { ip: string; userAgent: string; fingerprint?: string; host: string },
): Promise<{ token: string; deviceId: string; tenantId: string; venueId: string }> {
  const pdb = deps.db.platform();
  const sa = await pdb.selectFrom('staff_access').select(['venue_id', 'tenant_id', 'pin_hash']).where('staff_key_hash', '=', tokenHash(deps.config.pepper, b.staffKey)).executeTakeFirst();
  if (!sa) throw new AppError('NOT_FOUND', 'This staff link is no longer valid');
  const tenant = await pdb.selectFrom('tenants').select(['slug', 'name']).where('id', '=', sa.tenant_id).executeTakeFirstOrThrow();
  if (client.host !== `${tenant.slug}.${deps.config.domain}`) throw new AppError('NOT_FOUND', 'This staff link is no longer valid');
  const fpKey = `pin:fp:${sa.venue_id}:${client.ip}`;
  const venueKey = `pin:venue:${sa.venue_id}`;
  const lockKey = `pin:lock:${sa.venue_id}`;
  const knownKey = `pin:known:${sa.venue_id}:${client.ip}`;
  // PIN_LOCKED carries the time left, so the sign-in page can count down and unlock itself (W17, FR-ACC-06).
  const locked = async (key: string, message: string) => {
    const retryAfterSeconds = (await deps.kv.ttl(key)) ?? 600;
    return new AppError('PIN_LOCKED', message, { data: { retryAfterSeconds, lockedUntil: new Date(deps.now().getTime() + retryAfterSeconds * 1000).toISOString() } });
  };
  if ((await deps.kv.exists(lockKey)) && !(await deps.kv.exists(knownKey))) throw await locked(lockKey, 'Too many wrong PINs. Try again later.');
  if (Number((await deps.kv.get(fpKey)) ?? 0) >= 5) throw await locked(fpKey, 'Too many wrong PINs. Try again later.');
  if (!(await verifySecret(sa.pin_hash, b.pin))) {
    const fp = await deps.kv.incr(fpKey, 10 * 60);
    const venueCount = await deps.kv.incr(venueKey, 3600);
    if (venueCount >= 20 && (await deps.kv.setNx(lockKey, '1', 15 * 60))) {
      deps.log.warn({ security: true, event: 'PIN_LOCK', tenantId: sa.tenant_id, venueId: sa.venue_id }, 'venue staff sign-in locked');
      const owner = await pdb
        .selectFrom('tenant_memberships')
        .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
        .select(['users.email', 'users.locale'])
        .where('tenant_memberships.tenant_id', '=', sa.tenant_id)
        .where('tenant_memberships.role', '=', 'owner')
        .where('tenant_memberships.status', '=', 'active')
        .executeTakeFirst();
      if (owner) await sendEmail(deps, { template: 'staff_pin_lock', to: owner.email, locale: owner.locale, tenantId: sa.tenant_id, data: { tenantName: tenant.name } });
    }
    if (fp >= 5) throw await locked(fpKey, 'Too many wrong PINs. Try again in 10 minutes.');
    throw new AppError('UNAUTHENTICATED', 'Wrong PIN');
  }
  const tdb = deps.db.forTenant(sa.tenant_id);
  const token = newSecretToken();
  const id = uuidv7();
  const now = deps.now();
  await tdb.transaction().execute(async (tx) => {
    await tx.selectFrom('venues').select('id').where('id', '=', sa.venue_id).forUpdate().executeTakeFirst();
    const count = await tx.selectFrom('staff_devices').select((eb) => eb.fn.countAll<number>().as('n')).where('venue_id', '=', sa.venue_id).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
    await requireWithinLimit(deps, sa.tenant_id, 'maxStaffDevicesPerVenue', Number(count.n));
    await tx
      .insertInto('staff_devices')
      .values({
        id,
        tenant_id: sa.tenant_id,
        venue_id: sa.venue_id,
        name: b.deviceName,
        session_hash: tokenHash(deps.config.pepper, token),
        user_agent: client.userAgent.slice(0, 300),
        active_until: new Date(now.getTime() + 30 * 86_400_000),
      })
      .execute();
  });
  await deps.kv.del(fpKey);
  await deps.kv.set(knownKey, '1', 30 * 86_400);
  return { token, deviceId: id, tenantId: sa.tenant_id, venueId: sa.venue_id };
}

export async function resolveStaffDevice(deps: Deps, token: string) {
  const db = deps.db.platform();
  const d = await db.selectFrom('staff_devices').selectAll().where('session_hash', '=', tokenHash(deps.config.pepper, token)).where('revoked_at', 'is', null).executeTakeFirst();
  const now = deps.now();
  if (!d || d.active_until <= now) return null;
  // Sliding 30 days of use (FR-ACC-05); written at most once a minute.
  if (now.getTime() - d.last_seen_at.getTime() > 60_000) {
    await deps.db.forTenant(d.tenant_id).updateTable('staff_devices').set({ last_seen_at: now, active_until: new Date(now.getTime() + 30 * 86_400_000) }).where('id', '=', d.id).execute();
  }
  return d;
}

/** 404 unless the venue belongs to the scoped tenant (TR-TEN-08). */
async function requireVenue(db: Db, venueId: string) {
  const v = await db.selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst();
  if (!v) throw new AppError('NOT_FOUND');
}

export async function listDevices(deps: Deps, tenantId: string, venueId: string) {
  await requireVenue(deps.db.forTenant(tenantId), venueId);
  const rows = await deps.db
    .forTenant(tenantId)
    .selectFrom('staff_devices')
    .select(['id', 'name', 'mode', 'last_seen_at', 'created_at', 'user_agent'])
    .where('venue_id', '=', venueId)
    .where('revoked_at', 'is', null)
    .orderBy('last_seen_at', 'desc')
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, mode: r.mode, lastSeenAt: r.last_seen_at.toISOString(), createdAt: r.created_at.toISOString(), userAgent: r.user_agent }));
}

export async function removeDevice(deps: Deps, actor: Actor, tenantId: string, deviceId: string) {
  const db = deps.db.forTenant(tenantId);
  let id = 0;
  await db.transaction().execute(async (tx) => {
    const d = await tx.selectFrom('staff_devices').select(['id', 'venue_id']).where('id', '=', deviceId).where('revoked_at', 'is', null).executeTakeFirst();
    if (!d) throw new AppError('NOT_FOUND');
    await tx.updateTable('staff_devices').set({ revoked_at: deps.now(), revoked_reason: 'removed' }).where('id', '=', deviceId).execute();
    await writeAudit(tx, { actor, action: 'device.removed', tenantId, entityType: 'staff_device', entityId: deviceId });
    id = await addOutbox(tx, 'device.revoked', tenantId, { venueId: d.venue_id, emit: { deviceIds: [deviceId] } });
  });
  await flushOutbox(deps, [id]);
}

// ---------------------------------------------------------------- displays (TRD §8.5)

export async function createDisplay(deps: Deps, actor: Actor, tenantId: string, venueId: string, b: { name: string; counterIds?: string[] | null; settings?: DisplaySettings }) {
  const db = deps.db.forTenant(tenantId);
  const venue = await db.selectFrom('venues').select(['id', 'locales']).where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst();
  if (!venue) throw new AppError('NOT_FOUND');
  await checkDisplayCounters(db, venueId, b.counterIds);
  const primary = (venue.locales as unknown as string[])[0] ?? 'ar';
  const settings = displaySettingsSchema.parse(b.settings ?? { announce: { languages: [primary] } });
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    // Counted under a lock on the venue row so parallel requests cannot pass the plan limit together (L-12).
    await tx.selectFrom('venues').select('id').where('id', '=', venueId).forUpdate().executeTakeFirst();
    const count = await tx.selectFrom('displays').select((eb) => eb.fn.countAll<number>().as('n')).where('venue_id', '=', venueId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
    await requireWithinLimit(deps, tenantId, 'maxDisplaysPerVenue', Number(count.n));
    await tx.insertInto('displays').values({ id, tenant_id: tenantId, venue_id: venueId, name: b.name, counter_ids: b.counterIds ? json(b.counterIds) : null, settings: json(settings) }).execute();
    await writeAudit(tx, { actor, action: 'display.created', tenantId, entityType: 'display', entityId: id });
  });
  return { id };
}

export async function listDisplays(deps: Deps, tenantId: string, venueId: string) {
  await requireVenue(deps.db.forTenant(tenantId), venueId);
  const rows = await deps.db.forTenant(tenantId).selectFrom('displays').selectAll().where('venue_id', '=', venueId).where('revoked_at', 'is', null).orderBy('created_at').execute();
  const now = deps.now().getTime();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    counterIds: r.counter_ids,
    settings: displaySettingsSchema.parse(r.settings ?? {}),
    paired: r.session_hash !== null,
    pairedAt: r.paired_at?.toISOString() ?? null,
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    online: r.last_seen_at ? now - r.last_seen_at.getTime() < 120_000 : false,
    soundEnabled: r.sound_enabled,
  }));
}

/** A display shows counters of its own venue only (I-14). */
async function checkDisplayCounters(db: Db | Tx, venueId: string, counterIds: string[] | null | undefined) {
  if (!counterIds?.length) return;
  const ids = [...new Set(counterIds)];
  const found = await db.selectFrom('counters').select('id').where('venue_id', '=', venueId).where('archived_at', 'is', null).where('id', 'in', ids).execute();
  if (found.length !== ids.length) throw new AppError('VALIDATION_FAILED', 'Choose counters of this venue', { errors: [{ path: 'counterIds', message: 'unknown' }] });
}

export async function updateDisplay(deps: Deps, tenantId: string, displayId: string, b: { name?: string; counterIds?: string[] | null; settings?: DisplaySettings }) {
  if (b.counterIds?.length) {
    const d = await deps.db.forTenant(tenantId).selectFrom('displays').select('venue_id').where('id', '=', displayId).where('revoked_at', 'is', null).executeTakeFirst();
    if (!d) throw new AppError('NOT_FOUND');
    await checkDisplayCounters(deps.db.forTenant(tenantId), d.venue_id, b.counterIds);
  }
  const patch: Record<string, unknown> = {};
  if (b.name) patch.name = b.name;
  if (b.counterIds !== undefined) patch.counter_ids = b.counterIds === null ? null : json(b.counterIds);
  if (b.settings) patch.settings = json(displaySettingsSchema.parse(b.settings));
  const db = deps.db.forTenant(tenantId);
  // An empty change is a no-op (A10); the display must still exist.
  if (Object.keys(patch).length === 0) {
    if (!(await db.selectFrom('displays').select('id').where('id', '=', displayId).where('revoked_at', 'is', null).executeTakeFirst())) throw new AppError('NOT_FOUND');
    return;
  }
  const r = await db.updateTable('displays').set(patch).where('id', '=', displayId).where('revoked_at', 'is', null).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
}

/** Pairing code: 6 digits, 15 minutes, kept in Redis (§8.5). */
export async function issuePairingCode(deps: Deps, tenantId: string, displayId: string) {
  const d = await deps.db.forTenant(tenantId).selectFrom('displays').select(['id']).where('id', '=', displayId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!d) throw new AppError('NOT_FOUND');
  for (let i = 0; i < 10; i++) {
    const code = newPairingCode();
    if (await deps.kv.setNx(keys.pairing(code), JSON.stringify({ tenantId, displayId }), 15 * 60)) {
      return { code, expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString() };
    }
  }
  throw new AppError('SERVICE_UNAVAILABLE');
}

/** Pairing issues a display session and revokes any previous one (§8.5). */
export async function pairDisplay(deps: Deps, code: string, host: string): Promise<{ token: string; displayId: string; tenantId: string; venueId: string }> {
  const raw = await deps.kv.get(keys.pairing(code));
  if (!raw) throw new AppError('PAIRING_CODE_INVALID');
  const p = JSON.parse(raw) as { tenantId: string; displayId: string };
  const tenant = await deps.db.platform().selectFrom('tenants').select('slug').where('id', '=', p.tenantId).executeTakeFirstOrThrow();
  if (host !== `${tenant.slug}.${deps.config.domain}`) throw new AppError('PAIRING_CODE_INVALID');
  if (!(await deps.kv.take(keys.pairing(code)))) throw new AppError('PAIRING_CODE_INVALID'); // single use (L-2)
  const token = newSecretToken();
  const db = deps.db.forTenant(p.tenantId);
  const d = await db.selectFrom('displays').select(['venue_id']).where('id', '=', p.displayId).where('revoked_at', 'is', null).executeTakeFirst();
  if (!d) throw new AppError('PAIRING_CODE_INVALID');
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('displays').set({ session_hash: tokenHash(deps.config.pepper, token), paired_at: deps.now(), last_seen_at: deps.now() }).where('id', '=', p.displayId).execute();
    await writeAudit(tx, { actor: { kind: 'system' }, action: 'display.paired', tenantId: p.tenantId, entityType: 'display', entityId: p.displayId });
  });
  return { token, displayId: p.displayId, tenantId: p.tenantId, venueId: d.venue_id };
}

/** A paired display's session slides with use (heartbeats) and ends 365 days after it was last seen (L-7). */
export async function resolveDisplay(deps: Deps, token: string) {
  const d = await deps.db.platform().selectFrom('displays').selectAll().where('session_hash', '=', tokenHash(deps.config.pepper, token)).where('revoked_at', 'is', null).executeTakeFirst();
  if (!d) return null;
  const seen = d.last_seen_at ?? d.paired_at;
  if (!seen || deps.now().getTime() - seen.getTime() > SESSION_TTL.displaySlidingMs) return null;
  return d;
}

export async function unpairDisplay(deps: Deps, actor: Actor, tenantId: string, displayId: string, revoke: boolean) {
  const db = deps.db.forTenant(tenantId);
  let id = 0;
  await db.transaction().execute(async (tx) => {
    const d = await tx.selectFrom('displays').select(['id', 'venue_id']).where('id', '=', displayId).where('revoked_at', 'is', null).executeTakeFirst();
    if (!d) throw new AppError('NOT_FOUND');
    await tx.updateTable('displays').set({ session_hash: null, paired_at: null, ...(revoke && { revoked_at: deps.now() }) }).where('id', '=', displayId).execute();
    await writeAudit(tx, { actor, action: 'display.revoked', tenantId, entityType: 'display', entityId: displayId });
    id = await addOutbox(tx, 'display.revoked', tenantId, { venueId: d.venue_id, emit: { displayId } });
  });
  await flushOutbox(deps, [id]);
}

/** Display heartbeat: last_seen_at and sound status, written at most once a minute (§10.3). */
export async function displayHeartbeat(deps: Deps, tenantId: string, displayId: string, soundEnabled: boolean) {
  const k = `dsp:hb:${displayId}`;
  if (!(await deps.kv.setNx(k, '1', 60))) return;
  await deps.db.forTenant(tenantId).updateTable('displays').set({ last_seen_at: deps.now(), sound_enabled: soundEnabled }).where('id', '=', displayId).execute();
}

export { verifySecret };

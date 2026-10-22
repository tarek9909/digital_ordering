import { createHash, createHmac } from 'node:crypto';
import { decrypt, encrypt, safeEqual, type Actor } from '@dop/auth';
import { AppError, type CreateTicketBody } from '@dop/contracts';
import { json } from '@dop/db';
import { newSecretToken, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { urls, type Deps } from './deps.js';
import { requireFeature } from './platform.js';
import { createTicket, transitionTicket } from './tickets.js';

// POS connectors (TR-INT-04, FR-INT-09, R2). Each provider implements one interface; the worker and the
// /connectors/{provider}/webhook route call it, and it uses the same ticket service as the API.

export type PosStatus = 'preparing' | 'ready' | 'collected' | 'cancelled';

export interface PosOrderEvent {
  locationId: string;
  orderRef: string;
  status: PosStatus | 'created' | 'ignored';
  note?: string;
}

export interface PosConnector {
  readonly provider: string;
  /** Builds the OAuth URL the owner is sent to. */
  connectUrl(state: string, redirectUri: string): string;
  /** Exchanges the OAuth code for credentials and the POS location (business/branch) ID. */
  exchange(code: string, redirectUri: string): Promise<{ credentials: Record<string, unknown>; locationId: string }>;
  /** Verifies the provider's signature on an inbound webhook. */
  verifyWebhook(raw: Buffer, headers: Record<string, string | undefined>): boolean;
  /** The provider's unique delivery/event ID, when it sends one; used for replay detection (L-17). */
  deliveryId?(raw: Buffer, headers: Record<string, string | undefined>): string | null;
  /** Maps the provider's order payload to a ticket event. */
  mapOrder(payload: unknown): PosOrderEvent | null;
  disconnect(credentials: Record<string, unknown>): Promise<void>;
}

/**
 * Foodics (first provider, BRD OI-07). Payload mapping follows Foodics order webhooks: `order.created` and
 * `order.updated` with `status` values; signature is HMAC-SHA256 of the raw body with the app secret.
 * The exact field names must be confirmed against the partner documentation once API access is granted
 * (Implementation Plan check 0.8); the mapping is isolated here for that reason.
 */
export function createFoodicsConnector(cfg: { clientId: string; clientSecret: string; webhookSecret: string; fetchImpl?: typeof fetch }): PosConnector {
  const f = cfg.fetchImpl ?? fetch;
  const STATUS: Record<number, PosStatus | 'created'> = { 1: 'created', 2: 'preparing', 3: 'ready', 4: 'collected', 5: 'cancelled' };
  return {
    provider: 'foodics',
    connectUrl: (state, redirectUri) => `https://console.foodics.com/authorize?client_id=${encodeURIComponent(cfg.clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    async exchange(code, redirectUri) {
      const r = await f('https://api.foodics.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri }),
      });
      if (!r.ok) throw new AppError('UNAUTHENTICATED', 'Foodics did not accept the authorisation');
      const tok = (await r.json()) as { access_token: string; refresh_token?: string };
      const me = await f('https://api.foodics.com/v5/whoami', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const who = (await me.json()) as { data?: { business?: { reference?: string; id?: string } } };
      return { credentials: tok, locationId: String(who.data?.business?.reference ?? who.data?.business?.id ?? '') };
    },
    verifyWebhook(raw, headers) {
      const sig = headers['x-foodics-signature'] ?? '';
      const want = createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex');
      return sig.length === want.length && safeEqual(sig, want);
    },
    mapOrder(payload) {
      const p = payload as { business?: { reference?: string }; order?: { reference?: string; id?: string; status?: number; kitchen_notes?: string } };
      if (!p?.order || !p.business?.reference) return null;
      const status = STATUS[Number(p.order.status)] ?? 'ignored';
      return { locationId: String(p.business.reference), orderRef: String(p.order.reference ?? p.order.id), status, note: p.order.kitchen_notes ?? undefined };
    },
    async disconnect() {
      /* Foodics tokens expire; revocation is done in the Foodics console by the merchant. */
    },
  };
}

export async function savePosConnection(deps: Deps, actor: Actor, tenantId: string, venueId: string, provider: string, locationId: string, credentials: Record<string, unknown>) {
  await requireFeature(deps, tenantId, 'pos_connectors');
  const db = deps.db.forTenant(tenantId);
  if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst())) throw new AppError('NOT_FOUND');
  if (!locationId) throw new AppError('VALIDATION_FAILED', 'The POS did not return a location', { errors: [{ path: 'locationId', message: 'missing' }] });
  // A POS location feeds one venue of one tenant; another tenant can never take it over.
  const existing = await deps.db.platform().selectFrom('pos_connections').select(['id', 'tenant_id', 'venue_id']).where('provider', '=', provider).where('external_location_id', '=', locationId).executeTakeFirst();
  if (existing && existing.tenant_id !== tenantId) throw new AppError('FORBIDDEN', 'This POS location is connected to another account');
  const enc = await encrypt(deps.keys, JSON.stringify(credentials));
  const id = existing?.id ?? uuidv7();
  if (existing) {
    await db.updateTable('pos_connections').set({ venue_id: venueId, credentials_enc: enc, status: 'connected' }).where('id', '=', existing.id).execute();
  } else {
    await db.insertInto('pos_connections').values({ id, tenant_id: tenantId, venue_id: venueId, provider, external_location_id: locationId, credentials_enc: enc, status: 'connected', settings: json({}) }).execute();
  }
  await writeAudit(deps.db.platform(), { actor, action: 'pos.connected', tenantId, entityType: 'pos_connection', entityId: id, after: { provider, locationId, venueId } });
  return { id };
}

/** OAuth redirect URI of a provider: one fixed URL on the API host, registered with the provider. */
export const posRedirectUri = (c: { scheme: string; domain: string }, provider: string) => `${c.scheme}://api.${c.domain}/connectors/${provider}/callback`;

const posStateKey = (deps: Deps, state: string) => `posstate:${createHmac('sha256', deps.config.pepper).update(state).digest('hex')}`;

/**
 * Connect (W01, FR-INT-09): the owner starts on the admin page; the single-use state (10 minutes) binds the
 * provider's answer to this tenant, venue and user.
 */
export async function startPosConnect(deps: Deps, connectors: Map<string, PosConnector>, actor: Actor & { kind: 'user' }, tenantId: string, venueId: string, provider: string) {
  // Ownership first, so another tenant's venue is a 404 whatever this tenant's plan (TR-TEN-08).
  if (!(await deps.db.forTenant(tenantId).selectFrom('venues').select('id').where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst())) throw new AppError('NOT_FOUND');
  const connector = connectors.get(provider);
  if (!connector) throw new AppError('NOT_FOUND', 'This POS is not available');
  await requireFeature(deps, tenantId, 'pos_connectors');
  const state = newSecretToken();
  await deps.kv.set(posStateKey(deps, state), JSON.stringify({ tenantId, venueId, provider, userId: actor.userId }), 600);
  return { url: connector.connectUrl(state, posRedirectUri(deps.config, provider)) };
}

/** Provider callback on the API host: exchanges the code and stores the connection. Returns where to send the owner. */
export async function finishPosConnect(deps: Deps, connectors: Map<string, PosConnector>, provider: string, q: { code?: string; state?: string; error?: string }): Promise<{ redirect: string }> {
  const key = posStateKey(deps, q.state ?? '');
  const raw = q.state ? await deps.kv.get(key) : null;
  await deps.kv.del(key); // single use
  if (!raw) throw new AppError('UNAUTHENTICATED', 'This connection link expired; start again from the admin page');
  const s = JSON.parse(raw) as { tenantId: string; venueId: string; provider: string; userId: string };
  const t = await deps.db.platform().selectFrom('tenants').select(['slug']).where('id', '=', s.tenantId).executeTakeFirst();
  if (!t || s.provider !== provider) throw new AppError('UNAUTHENTICATED', 'This connection link expired; start again from the admin page');
  const back = (result: string) => ({ redirect: urls(deps.config).admin(t.slug, `/integrations?pos=${result}`) });
  const connector = connectors.get(provider);
  if (!connector) return back('unavailable');
  if (q.error || !q.code) return back('cancelled');
  const membership = await deps.db.platform().selectFrom('tenant_memberships').select('role').where('tenant_id', '=', s.tenantId).where('user_id', '=', s.userId).where('status', '=', 'active').executeTakeFirst();
  if (membership?.role !== 'owner') return back('forbidden');
  try {
    const r = await connector.exchange(q.code, posRedirectUri(deps.config, provider));
    await savePosConnection(deps, { kind: 'user', userId: s.userId, tenantId: s.tenantId, role: 'owner', sessionId: 'pos-callback', mfaVerified: false }, s.tenantId, s.venueId, provider, r.locationId, r.credentials);
    return back('connected');
  } catch (e) {
    deps.log.warn({ err: e, provider, tenantId: s.tenantId }, 'POS connection failed');
    const code = (e as { code?: string }).code;
    return back(code === 'FORBIDDEN' ? 'taken' : 'failed');
  }
}

export async function listPosConnections(deps: Deps, tenantId: string) {
  const rows = await deps.db.forTenant(tenantId).selectFrom('pos_connections').select(['id', 'venue_id', 'provider', 'external_location_id', 'status', 'last_sync_at']).execute();
  return rows.map((r) => ({ id: r.id, venueId: r.venue_id, provider: r.provider, locationId: r.external_location_id, status: r.status, lastSyncAt: r.last_sync_at?.toISOString() ?? null }));
}

export async function removePosConnection(deps: Deps, connectors: Map<string, PosConnector>, actor: Actor, tenantId: string, id: string) {
  const db = deps.db.forTenant(tenantId);
  const c = await db.selectFrom('pos_connections').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw new AppError('NOT_FOUND');
  await connectors.get(c.provider)?.disconnect(JSON.parse(await decrypt(deps.keys, c.credentials_enc)) as Record<string, unknown>).catch(() => undefined);
  await db.deleteFrom('pos_connections').where('id', '=', id).execute();
  await writeAudit(deps.db.platform(), { actor, action: 'pos.disconnected', tenantId, entityType: 'pos_connection', entityId: id, before: { provider: c.provider, locationId: c.external_location_id } });
}

/** How long a verified POS delivery is remembered for replay detection (L-17). */
export const POS_REPLAY_WINDOW_SEC = 7 * 86400;

/**
 * Inbound POS webhook → same ticket service as the API (TR-INT-04). Unknown orders are ignored, not errors.
 *
 * Replay protection (L-17): the Foodics signature covers the body only (no signed timestamp, and no confirmed
 * delivery/event ID in the payload), so a captured request would otherwise be accepted again. After the signature
 * check, the delivery is claimed under the provider's delivery ID when the connector supplies one, else under the
 * SHA-256 of the raw body, for POS_REPLAY_WINDOW_SEC. A repeat inside the window is acknowledged (200) without
 * re-applying state. The claim is released when processing fails, so the provider's own retry still works.
 */
export async function handlePosWebhook(deps: Deps, connector: PosConnector, raw: Buffer, headers: Record<string, string | undefined>) {
  if (!connector.verifyWebhook(raw, headers)) throw new AppError('UNAUTHENTICATED', 'Bad signature');
  const deliveryId = connector.deliveryId?.(raw, headers) ?? null;
  const replayKey = `posreplay:${connector.provider}:${deliveryId ? `id:${createHash('sha256').update(deliveryId).digest('hex')}` : `body:${createHash('sha256').update(raw).digest('hex')}`}`;
  if (!(await deps.kv.setNx(replayKey, '1', POS_REPLAY_WINDOW_SEC))) {
    deps.log.warn({ security: true, event: 'POS_WEBHOOK_REPLAY', provider: connector.provider }, 'duplicate POS webhook acknowledged without processing');
    return { handled: false, duplicate: true };
  }
  try {
    return await applyPosWebhook(deps, connector, raw);
  } catch (e) {
    await deps.kv.del(replayKey).catch(() => undefined);
    throw e;
  }
}

async function applyPosWebhook(deps: Deps, connector: PosConnector, raw: Buffer): Promise<{ handled: boolean; ticketId?: string }> {
  const ev = connector.mapOrder(JSON.parse(raw.toString('utf8')));
  if (!ev || ev.status === 'ignored') return { handled: false };
  const conn = await deps.db.platform().selectFrom('pos_connections').select(['tenant_id', 'venue_id', 'id']).where('provider', '=', connector.provider).where('external_location_id', '=', ev.locationId).where('status', '=', 'connected').executeTakeFirst();
  if (!conn) return { handled: false };
  const actor = { kind: 'api_key' as const, apiKeyId: conn.id, tenantId: conn.tenant_id, venueId: conn.venue_id };
  await deps.db.forTenant(conn.tenant_id).updateTable('pos_connections').set({ last_sync_at: deps.now() }).where('id', '=', conn.id).execute();
  if (ev.status === 'created' || ev.status === 'preparing') {
    const body: CreateTicketBody = { externalRef: ev.orderRef, ...(ev.note && { note: ev.note.slice(0, 280) }), startStatus: 'preparing' };
    const r = await createTicket(deps, actor, conn.venue_id, body, { source: 'connector', viaApi: true });
    return { handled: true, ticketId: r.ticket.id };
  }
  const t = await deps.db.forTenant(conn.tenant_id).selectFrom('tickets').select(['id']).where('venue_id', '=', conn.venue_id).where('open_external_ref', '=', ev.orderRef).executeTakeFirst();
  if (!t) return { handled: false };
  await transitionTicket(deps, actor, t.id, { to: ev.status, ...(ev.status === 'cancelled' && { cancelReason: 'other' as const }) }, { viaApi: true });
  return { handled: true, ticketId: t.id };
}

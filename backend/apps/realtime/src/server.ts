import { tokenHash } from '@dop/auth';
import {
  SOCKET_PATH,
  acknowledgePayload,
  displayHeartbeatPayload,
  presenceHeartbeatPayload,
  type BusEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@dop/contracts';
import { clientAddress, parseIpRules, type IpRules } from '@dop/config';
import { tenantAccess } from '@dop/domain';
import { acknowledge, displayHeartbeat, getTenantStatus, heartbeat, resolveBoardSupport, resolveBoardUser, resolveDisplay, resolveStaffDevice, type Deps } from '@dop/services';
import { parse as parseCookie } from 'cookie';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

// Real-time layer (TRD §10). Rooms come only from the authenticated context (TR-RT-01, TR-TEN-11); events to
// ticket rooms identify tickets by token (TR-RT-07); payloads carry full projections (TR-EVT-02).

export interface SocketData {
  kind: 'customer' | 'staff' | 'display';
  tenantId?: string;
  venueId?: string;
  clientId?: string;
  /** token → ticket id, for this customer socket. */
  tickets?: Map<string, { id: string; tenantId: string }>;
  displayId?: string;
  /** What the socket authenticated with, kept in memory so it can be re-checked while connected (H-7). */
  credential?: { kind: 'device' | 'display' | 'user' | 'support'; token: string; host: string; userId?: string; sessionId?: string };
  /** Per-socket client-event budget: events left and when the window resets. */
  budget?: { left: number; reset: number };
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface RealtimeOptions {
  deps: Deps;
  insecureCookies: boolean;
  /** Allowed Origin for a request to `host`: the platform's own app hosts, same-origin (TR-RT-02, I-3). */
  isAllowedOrigin(origin: string | undefined, host: string): boolean;
  /** Reverse proxies whose X-Forwarded-For / X-Forwarded-Host are believed (TRUST_PROXY); default none. */
  trustProxy?: IpRules;
  /** How often connected sockets are re-authorised; tests shorten it. */
  revalidateMs?: number;
}

/** Platform hosts that never run the customer, staff or display apps; no socket may come from them (I-3). */
const NOT_APP_HOSTS = new Set(['www', 'admin', 'api', 'files', 'cdn']);

/**
 * Production Origin rule (TR-RT-02, I-3): same-origin only, from the customer host or a tenant host. The page's
 * own origin must be the host it connects to, so a page on another platform host (for example files.) cannot
 * open a staff or display socket with the visitor's cookies.
 */
export function appOriginCheck(domain: string) {
  return (origin: string | undefined, host: string) => {
    if (!origin) return false;
    try {
      const h = new URL(origin).hostname.toLowerCase();
      if (h !== host) return false;
      if (h === `t.${domain}`) return true;
      const label = h.endsWith(`.${domain}`) ? h.slice(0, -(domain.length + 1)) : '';
      return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) && !NOT_APP_HOSTS.has(label);
    } catch {
      return false;
    }
  };
}

/** New connections per client address per minute, across all realtime instances (TR-RT-07, H-2). */
const HANDSHAKES_PER_MINUTE = 30;
/** Client events per socket per 10 seconds; more are refused. */
const EVENTS_PER_WINDOW = 60;

const cookieName = (insecure: boolean, n: string) => (insecure ? `dop_${n}` : `__Host-${n}`);

export const rooms = {
  staff: (venueId: string) => `venue:${venueId}:staff`,
  display: (venueId: string) => `venue:${venueId}:display`,
  ticket: (ticketId: string) => `ticket:${ticketId}`,
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  device: (id: string) => `device:${id}`,
  displayId: (id: string) => `display:${id}`,
  client: (clientId: string) => `client:${clientId}`,
  user: (userId: string) => `user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  support: (supportSessionId: string) => `support:${supportSessionId}`,
  /** Staff-side sockets of a tenant (boards), without its displays: for staff-only notices. */
  tenantStaff: (tenantId: string) => `tstaff:${tenantId}`,
};

export function createRealtime(http: HttpServer | undefined, o: RealtimeOptions): IO {
  const trusted = o.trustProxy ?? parseIpRules([]);
  const io: IO = new Server(http, {
    path: SOCKET_PATH,
    pingInterval: 20_000, // TR-RT-03
    pingTimeout: 20_000,
    maxHttpBufferSize: 16 * 1024, // TR-RT-07
    allowRequest: (req, cb) => cb(null, o.isAllowedOrigin(req.headers.origin, requestHost(req.headers, req.socket.remoteAddress, trusted))),
    cors: undefined, // same-origin through CloudFront
  });
  const { deps } = o;
  const perClient = new Map<string, number>();

  io.use(async (socket, next) => {
    try {
      // 30 handshakes per client address per minute, counted in Redis so every instance shares it (H-2). The
      // address is the connecting peer unless that peer is a configured proxy (Caddy) — never a header an
      // arbitrary client chooses.
      const ip = clientAddress(socket.request.socket.remoteAddress, socket.handshake.headers['x-forwarded-for'], trusted);
      const minute = Math.floor(Date.now() / 60_000);
      if ((await deps.kv.incr(`rt:hs:${ip}:${minute}`, 90)) > HANDSHAKES_PER_MINUTE) return next(new Error('RATE_LIMITED'));

      const auth = (socket.handshake.auth ?? {}) as { clientId?: string; tickets?: string[]; app?: string; venueId?: string };
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const host = requestHost(socket.handshake.headers, socket.request.socket.remoteAddress, trusted);

      if (auth.app === 'staff') {
        const dev = cookies[cookieName(o.insecureCookies, 'dev')];
        if (dev) {
          const d = await resolveStaffDevice(deps, dev);
          if (d && host === (await tenantHost(deps, d.tenant_id)) && (await staffAccessOn(deps, d.tenant_id))) {
            socket.data = { kind: 'staff', tenantId: d.tenant_id, venueId: d.venue_id, credential: { kind: 'device', token: dev, host } };
            await socket.join([rooms.staff(d.venue_id), rooms.tenant(d.tenant_id), rooms.tenantStaff(d.tenant_id), rooms.device(d.id)]);
            return next();
          }
        }
        // Owners and managers on the board (FR-STF-17), under the same rule as the HTTP staff API (M-10).
        const sid = cookies[cookieName(o.insecureCookies, 'sid')];
        if (sid && typeof auth.venueId === 'string') {
          const u = await resolveBoardUser(deps, sid, host, auth.venueId);
          if (u) {
            socket.data = { kind: 'staff', tenantId: u.tenantId, venueId: u.venueId, credential: { kind: 'user', token: sid, host, userId: u.userId, sessionId: u.sessionId } };
            await socket.join([rooms.staff(u.venueId), rooms.tenant(u.tenantId), rooms.tenantStaff(u.tenantId), rooms.user(u.userId), rooms.session(u.sessionId)]);
            return next();
          }
        }
        // A platform agent inside an approved support session (FR-STF-17, CSD10): same rule as the HTTP staff API.
        const sup = cookies[cookieName(o.insecureCookies, 'sup')];
        if (sup && typeof auth.venueId === 'string') {
          const s = await resolveBoardSupport(deps, sup, host, auth.venueId);
          if (s) {
            socket.data = { kind: 'staff', tenantId: s.tenantId, venueId: s.venueId, credential: { kind: 'support', token: sup, host, sessionId: s.supportSessionId } };
            await socket.join([rooms.staff(s.venueId), rooms.tenant(s.tenantId), rooms.tenantStaff(s.tenantId), rooms.support(s.supportSessionId)]);
            return next();
          }
        }
        return next(new Error('UNAUTHENTICATED'));
      }
      if (auth.app === 'display') {
        const dsp = cookies[cookieName(o.insecureCookies, 'dsp')];
        const d = dsp ? await resolveDisplay(deps, dsp) : null;
        if (!d || host !== (await tenantHost(deps, d.tenant_id))) return next(new Error('UNAUTHENTICATED'));
        socket.data = { kind: 'display', tenantId: d.tenant_id, venueId: d.venue_id, displayId: d.id, credential: { kind: 'display', token: dsp!, host } };
        await socket.join([rooms.display(d.venue_id), rooms.tenant(d.tenant_id), rooms.displayId(d.id)]);
        return next();
      }
      // Customer page: client ID + up to 20 ticket tokens.
      if (!auth.clientId || !/^[0-9A-Za-z]{22}$/.test(auth.clientId)) return next(new Error('UNAUTHENTICATED'));
      const tokens = (auth.tickets ?? []).filter((t) => /^[0-9A-Za-z]{22}$/.test(t)).slice(0, 20);
      const count = perClient.get(auth.clientId) ?? 0;
      if (count >= 5) return next(new Error('RATE_LIMITED')); // 5 concurrent sockets per clientId
      const rows = tokens.length
        ? await deps.db.platform().selectFrom('tickets').select(['id', 'token', 'tenant_id', 'status', 'updated_at']).where('token', 'in', tokens).execute()
        : [];
      const recent = Date.now() - 2 * 3600_000;
      const valid = rows.filter((r) => ['received', 'preparing', 'ready'].includes(r.status) || r.updated_at.getTime() > recent);
      socket.data = { kind: 'customer', clientId: auth.clientId, tickets: new Map(valid.map((r) => [r.token, { id: r.id, tenantId: r.tenant_id }])) };
      perClient.set(auth.clientId, count + 1);
      socket.on('disconnect', () => {
        // Removed at zero, so the map only holds clients with open sockets (L-19).
        const left = (perClient.get(auth.clientId!) ?? 1) - 1;
        if (left > 0) perClient.set(auth.clientId!, left);
        else perClient.delete(auth.clientId!);
      });
      await socket.join([...valid.map((r) => rooms.ticket(r.id)), rooms.client(auth.clientId)]);
      return next();
    } catch (e) {
      deps.log.warn({ err: e }, 'socket auth failed');
      return next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Sock) => {
    // Every client event spends from a small per-socket budget; a flood is refused instead of processed or logged.
    socket.use((_packet, nextPacket) => {
      const now = Date.now();
      const b = socket.data.budget && socket.data.budget.reset > now ? socket.data.budget : { left: EVENTS_PER_WINDOW, reset: now + 10_000 };
      socket.data.budget = b;
      if (b.left <= 0) return nextPacket(new Error('RATE_LIMITED'));
      b.left--;
      nextPacket();
    });
    socket.on('presence.heartbeat', async (p, ack) => {
      const r = presenceHeartbeatPayload.safeParse(p);
      if (!r.success || socket.data.kind !== 'customer') return ack?.({ ok: false });
      for (const token of r.data.tokens) {
        const t = socket.data.tickets?.get(token);
        if (t) await heartbeat(deps, t.tenantId, t.id, socket.data.clientId!).catch((err: unknown) => deps.log.warn({ err }, 'heartbeat failed'));
      }
      ack?.({ ok: true });
    });
    socket.on('ticket.acknowledge', async (p, ack) => {
      const r = acknowledgePayload.safeParse(p);
      if (!r.success || socket.data.kind !== 'customer' || !socket.data.tickets?.has(r.data.token)) return ack?.({ ok: false });
      try {
        await acknowledge(deps, r.data.token);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });
    socket.on('display.heartbeat', async (p, ack) => {
      const r = displayHeartbeatPayload.safeParse(p);
      if (!r.success || socket.data.kind !== 'display') return ack?.({ ok: false });
      await displayHeartbeat(deps, socket.data.tenantId!, socket.data.displayId!, r.data.soundEnabled);
      ack?.({ ok: true });
    });
    socket.on('alert.delivered', (p, ack) => {
      // "Delivered to open page" (TR-ALR-23), recorded as a metric.
      // Client-sent: only small integers reach the log.
      const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1000 ? (v as number) : null);
      deps.log.info({ metric: 'alert_delivered_page', round: n(p?.round), attempt: n(p?.attempt) }, 'alert reached open page');
      ack?.({ ok: true });
    });
    // Unauthenticated sockets never reach here: the handshake middleware rejects them.
  });

  // Connected sockets are re-authorised every minute (H-7): sign-out, expiry, a removed membership, lost
  // assurance or a revoked device or display ends the stream even if a revocation message was missed.
  const timer = setInterval(() => void revalidateAll(io, deps).catch((err: unknown) => deps.log.warn({ err }, 'socket revalidation failed')), o.revalidateMs ?? 60_000);
  timer.unref();
  const close = io.close.bind(io);
  io.close = ((fn?: (err?: Error) => void) => {
    clearInterval(timer);
    return close(fn);
  }) as typeof io.close;
  return io;
}

/** Whether the socket's credential still allows what it was admitted for. */
/** Staff access is off for expired trials and cancelled tenants (§8.2); devices follow the same rule as users. */
async function staffAccessOn(deps: Deps, tenantId: string) {
  const status = await getTenantStatus(deps, tenantId);
  return status !== null && tenantAccess(status).staff !== 'off';
}

async function stillAuthorised(deps: Deps, s: Sock): Promise<boolean> {
  const c = s.data.credential;
  if (!c) return true; // customer sockets hold ticket capabilities, checked per event
  if (c.kind === 'user') return Boolean(await resolveBoardUser(deps, c.token, c.host, s.data.venueId!));
  if (c.kind === 'support') return Boolean(await resolveBoardSupport(deps, c.token, c.host, s.data.venueId!));
  if (c.kind === 'device') {
    const d = await resolveStaffDevice(deps, c.token);
    return Boolean(d && d.venue_id === s.data.venueId && (await staffAccessOn(deps, d.tenant_id)));
  }
  const d = await resolveDisplay(deps, c.token);
  return Boolean(d && d.id === s.data.displayId);
}

async function revalidate(deps: Deps, sockets: Iterable<Sock>) {
  for (const s of sockets) {
    if (!(await stillAuthorised(deps, s))) {
      s.emit('device.revoked', {});
      s.disconnect(true);
    }
  }
}

/** This instance's sockets only: every realtime instance re-checks its own connections. */
export async function revalidateAll(io: IO, deps: Deps) {
  await revalidate(deps, [...io.of('/').sockets.values()].filter((s) => s.data.credential));
}

/** The host the client asked for: X-Forwarded-Host only when the peer is a configured proxy (M-7). */
function requestHost(headers: Record<string, string | string[] | undefined>, remote: string | undefined, trusted: IpRules): string {
  const fwd = headers['x-forwarded-host'];
  const raw = trusted.has(remote ?? '') && typeof fwd === 'string' ? fwd : headers.host;
  return String(raw ?? '')
    .split(',')[0]!
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase();
}

const hostCache = new Map<string, string>();
async function tenantHost(deps: Deps, tenantId: string) {
  let h = hostCache.get(tenantId);
  if (!h) {
    const t = await deps.db.platform().selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst();
    h = t ? `${t.slug}.${deps.config.domain}` : '';
    hostCache.set(tenantId, h);
    setTimeout(() => hostCache.delete(tenantId), 60_000).unref();
  }
  return h;
}

/** Routes one bus event to rooms (TR-EVT-02). `deps` is needed for re-checks (`user.revalidate`). */
export function fanOut(io: IO, e: BusEvent, deps?: Deps) {
  const p = e.payload as Record<string, unknown>;
  switch (e.topic) {
    case 'user.revalidate': {
      // H-7: this instance re-checks the named user's or session's board sockets now.
      if (!deps) return;
      const room =
        typeof p.sessionId === 'string' ? rooms.session(p.sessionId) : typeof p.supportSessionId === 'string' ? rooms.support(p.supportSessionId) : typeof p.userId === 'string' ? rooms.user(p.userId) : null;
      const ids = room ? io.of('/').adapter.rooms.get(room) : undefined;
      const sockets = [...(ids ?? [])].map((id) => io.of('/').sockets.get(id)).filter((s): s is Sock => Boolean(s));
      void revalidate(deps, sockets).catch((err: unknown) => deps.log.warn({ err }, 'socket revalidation failed'));
      return;
    }
    case 'ticket.created':
      if (!e.venueId) return;
      io.to(rooms.staff(e.venueId)).emit('ticket.created', { staff: p.staff as never });
      io.to(rooms.display(e.venueId)).emit('ticket.created', { display: p.display as never });
      return;
    case 'ticket.updated': {
      if (!e.venueId || !e.ticketId) return;
      const meta = { change: p.change as never, reason: (p.reason ?? undefined) as never, actor: (p.actor ?? null) as string | null };
      io.to(rooms.staff(e.venueId)).emit('ticket.updated', { ticket: p.staff as never, ...meta });
      io.to(rooms.display(e.venueId)).emit('ticket.updated', { ticket: p.display as never, ...meta, actor: null });
      io.to(rooms.ticket(e.ticketId)).emit('ticket.updated', { ticket: p.public as never, change: meta.change, reason: meta.reason });
      return;
    }
    case 'ticket.alert':
      if (e.ticketId) io.to(rooms.ticket(e.ticketId)).emit('ticket.alert', { token: e.token, round: p.round as number, attempt: p.attempt as number, manual: Boolean(p.manual) });
      if (e.venueId) io.to(rooms.display(e.venueId)).emit('ticket.alert', { id: e.ticketId, displayNumber: p.displayNumber as string, round: p.round as number, attempt: p.attempt as number, manual: Boolean(p.manual) });
      return;
    case 'ticket.followed':
      if (e.venueId) io.to(rooms.staff(e.venueId)).emit('ticket.followed', { id: p.id as string });
      return;
    case 'ticket.overdue':
      if (e.venueId) io.to(rooms.staff(e.venueId)).emit('ticket.overdue', { id: p.id as string, round: p.round as number });
      return;
    case 'tenant.status_changed':
      if (e.tenantId) io.to(rooms.tenant(e.tenantId)).emit('tenant.status_changed', { status: p.status as never });
      return;
    case 'venue.settings_changed':
      if (e.venueId) {
        io.to(rooms.staff(e.venueId)).emit('venue.settings_changed', p);
        io.to(rooms.display(e.venueId)).emit('venue.settings_changed', p);
      }
      return;
    case 'device.revoked':
      for (const id of (p.deviceIds as string[] | undefined) ?? []) {
        io.to(rooms.device(id)).emit('device.revoked', {});
        io.in(rooms.device(id)).disconnectSockets(true);
      }
      return;
    case 'claim.requested':
      if (e.venueId) io.to(rooms.staff(e.venueId)).emit('claim.requested', { claimId: p.claimId as string, displayNumber: p.displayNumber as string, createdAt: p.createdAt as string });
      return;
    case 'claim.decided':
      if (e.venueId) io.to(rooms.staff(e.venueId)).emit('claim.decided', { claimId: p.claimId as string, status: p.status as never });
      if (p.clientId) io.to(rooms.client(p.clientId as string)).emit('claim.decided', { claimId: p.claimId as string, status: p.status as never, ticketToken: p.ticketToken as string | undefined });
      return;
    case 'support.session':
      // Carries the agent's name: staff boards only, never the customer-facing displays.
      if (e.tenantId) io.to(rooms.tenantStaff(e.tenantId)).emit('support.session', p as never);
      return;
    case 'display.revoked':
      if (p.displayId) {
        io.to(rooms.displayId(p.displayId as string)).emit('device.revoked', {});
        io.in(rooms.displayId(p.displayId as string)).disconnectSockets(true);
      }
      return;
  }
}

export { tokenHash };

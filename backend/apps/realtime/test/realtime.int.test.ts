import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import type { BusEvent } from '@dop/contracts';
import { createTicket, createTenantWithOwner, staffSignIn, setStaffPin, staffAccessInfo, transitionTicket, follow, keys } from '@dop/services';
import { makeTestDeps, type TestDeps } from '@dop/services/testing';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRealtime, fanOut } from '../src/server.js';

let t: TestDatabase;
let deps: TestDeps;
let http: HttpServer;
let url: string;
let rt: ReturnType<typeof createRealtime>;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await startTestDatabase();
  deps = makeTestDeps(t.clients);
  deps.clock.set(new Date());
  http = createServer();
  rt = createRealtime(http, { deps, insecureCookies: true, isAllowedOrigin: (o) => !o || o.includes('dop.test') });
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // Bus: whatever services publish is fanned out straight away, as the Redis subscription does in production.
  const publish = deps.kv.publish.bind(deps.kv);
  deps.kv.publish = async (ch, msg) => {
    await publish(ch, msg);
    fanOut(rt, JSON.parse(msg) as BusEvent);
  };
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  rt?.close();
  await t?.stop();
});

function open(auth: Record<string, unknown>, headers: Record<string, string> = {}) {
  const s = connect(url, { path: '/rt/', auth, extraHeaders: headers, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise<Socket>((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const next = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));

async function tenant(slug: string) {
  const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `${slug}@x.test`, password: 'a-long-unique-passphrase', restaurantName: slug, slug, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  await setStaffPin(deps, { kind: 'system' }, r.tenantId, r.venueId, '4821');
  const staffKey = (await staffAccessInfo(deps, r.tenantId, r.venueId)).link.split('/staff/')[1]!;
  const dev = await staffSignIn(deps, { staffKey, pin: '4821', deviceName: 'iPad' }, { ip: '1.1.1.1', userAgent: 'test', fingerprint: 'f', host: `${slug}.dop.test` });
  return { ...r, dev, actor: { kind: 'staff_device' as const, deviceId: dev.deviceId, tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' } };
}

describe('realtime (TRD §10)', () => {
  it('delivers a status change to staff, display and customer sockets within 1 s (TR-NFR-01)', async () => {
    const a = await tenant('rt-a');
    const { ticket } = await createTicket(deps, a.actor, a.venueId, {});
    const staff = await open({ app: 'staff' }, { Cookie: `dop_dev=${a.dev.token}`, Host: 'rt-a.dop.test', Origin: 'https://rt-a.dop.test' });
    const customer = await open({ clientId: 'B'.repeat(22), tickets: [ticket.token] }, { Origin: 'https://t.dop.test' });

    const followed = next<{ id: string }>(staff, 'ticket.followed');
    await follow(deps, ticket.token, { clientId: 'B'.repeat(22), joinedVia: 'ticket_qr', uaFamily: 'android-chrome' });
    expect((await followed).id).toBe(ticket.id);

    const staffGot = next<{ ticket: { status: string; id: string } }>(staff, 'ticket.updated');
    const customerGot = next<{ ticket: { status: string; token: string; id?: string } }>(customer, 'ticket.updated');
    const started = Date.now();
    await transitionTicket(deps, a.actor, ticket.id, { to: 'ready', version: 1 });
    const [s, c] = await Promise.all([staffGot, customerGot]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(s.ticket).toMatchObject({ id: ticket.id, status: 'ready' });
    expect(c.ticket).toMatchObject({ token: ticket.token, status: 'ready' });
    expect(c.ticket.id).toBeUndefined(); // ticket rooms never carry internal IDs (TR-RT-07)
  });

  it('keeps presence in the KV store and never mixes tenants', async () => {
    const a = await tenant('rt-b');
    const b = await tenant('rt-c');
    const ta = (await createTicket(deps, a.actor, a.venueId, {})).ticket;
    const tb = (await createTicket(deps, b.actor, b.venueId, {})).ticket;
    const phone = await open({ clientId: 'C'.repeat(22), tickets: [ta.token] }, { Origin: 'https://t.dop.test' });
    await follow(deps, ta.token, { clientId: 'C'.repeat(22), joinedVia: 'ticket_qr', uaFamily: 'ios-safari' });
    const ack = await phone.timeout(2000).emitWithAck('presence.heartbeat', { tokens: [ta.token, tb.token], visible: true });
    expect(ack).toEqual({ ok: true });
    expect(await deps.kv.exists(keys.presence(ta.id, 'C'.repeat(22)))).toBe(true);
    expect(await deps.kv.exists(keys.presence(tb.id, 'C'.repeat(22)))).toBe(false); // token not in handshake → ignored
    let leaked = false;
    phone.on('ticket.updated', (p: { ticket: { token: string } }) => {
      if (p.ticket.token === tb.token) leaked = true;
    });
    await transitionTicket(deps, b.actor, tb.id, { to: 'ready', version: 1 });
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('rejects a staff cookie presented on another tenant host (TR-TEN-02)', async () => {
    const a = await tenant('rt-d');
    await tenant('rt-e');
    await expect(open({ app: 'staff' }, { Cookie: `dop_dev=${a.dev.token}`, Host: 'rt-e.dop.test', Origin: 'https://rt-e.dop.test' })).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(open({ app: 'staff' }, { Origin: 'https://rt-d.dop.test' })).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

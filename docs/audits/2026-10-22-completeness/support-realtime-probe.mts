import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { uuidv7 } from '../../../backend/packages/domain/src/index.ts';
import * as svc from '../../../backend/packages/services/src/index.ts';
import { createRealtime, fanOut } from '../../../backend/apps/realtime/src/server.ts';
import { makeApi } from '../../../backend/apps/api/test/helpers.ts';

// No network provider calls: disposable MySQL, real API + realtime server, memory queue/KV.
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const connect = require('socket.io-client').io;
const request = require('supertest');
const t = await startTestDatabase();
const api = makeApi(t.clients);
const deps = api.deps;
const http = createServer();
const rt = createRealtime(http, { deps, insecureCookies: true, isAllowedOrigin: o => !o || o === 'https://support-rt.dop.test' });
const sockets: any[] = [];
let result: Record<string, unknown> = {};
try {
  const email = 'support-rt@x.test';
  const password = 'a-long-unique-passphrase';
  const x = await svc.signup(deps, { ownerName: 'Owner', email, password, restaurantName: 'Support realtime cafe', slug: 'support-rt', country: 'SA', locale: 'en', acceptTerms: true }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', x.userId).execute();
  const owner = { kind: 'user' as const, userId: x.userId, tenantId: x.tenantId, role: 'owner' as const, sessionId: 'audit', mfaVerified: false };
  const platformUserId = uuidv7();
  await t.clients.platform().insertInto('platform_users').values({ id: platformUserId, email: 'support-agent@x.test', name: 'Audit support agent', role: 'support', status: 'active' }).execute();
  const platform = { kind: 'platform' as const, platformUserId, role: 'support' as const, sessionId: 'audit', mfaVerifiedAt: deps.now() };
  const supportRequest = await svc.requestSupport(deps, platform, x.tenantId, 'Investigate staff board', 30);
  await svc.approveSupport(deps, owner, supportRequest.id);
  const handoff = await svc.enterSupport(deps, platform, supportRequest.id);
  const code = new URL(handoff.url).searchParams.get('code')!;
  const supportCookie = await svc.exchangeSupportHandoff(deps, code, x.tenantId);
  const supportActor = await svc.resolveSupport(deps, supportCookie.token, x.tenantId);
  const host = 'support-rt.dop.test';
  const ownerSession = await svc.signInUser(deps, email, password, x.tenantId, { ip: '1.1.1.1', userAgent: 'audit', host });
  if (ownerSession.kind !== 'session') throw new Error('Unexpected fixture MFA challenge');
  const ticket = (await svc.createTicket(deps, owner, x.venueId, {})).ticket;
  const boardPath = `/api/staff/v1/board?venueId=${x.venueId}`;
  const httpUnauthenticated = await request(api.app).get(boardPath).set('Host', host);
  const httpSupport = await request(api.app).get(boardPath).set('Host', host).set('Cookie', `dop_sup=${supportCookie.token}`);
  const httpOwner = await request(api.app).get(boardPath).set('Host', host).set('Cookie', `dop_sid=${ownerSession.token}`);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const published = deps.kv.publish.bind(deps.kv);
  deps.kv.publish = async (channel, message) => { await published(channel, message); fanOut(rt, JSON.parse(message)); };
  async function open(cookie?: string) {
    const s = connect(url, { path: '/rt/', auth: { app: 'staff', venueId: x.venueId }, extraHeaders: { Host: host, Origin: `https://${host}`, ...(cookie ? { Cookie: cookie } : {}) }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    sockets.push(s);
    return await new Promise<{ socket: any; connected: boolean; error: string | null }>(resolve => {
      s.once('connect', () => resolve({ socket: s, connected: true, error: null }));
      s.once('connect_error', (e: Error) => resolve({ socket: s, connected: false, error: e.message }));
    });
  }
  const noCookieSocket = await open();
  const supportSocket = await open(`dop_sup=${supportCookie.token}`);
  const ownerSocket = await open(`dop_sid=${ownerSession.token}`);
  let ownerReceivedUpdate = false;
  if (ownerSocket.connected) {
    const event = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 2000);
      ownerSocket.socket.once('ticket.updated', (p: any) => { clearTimeout(timer); resolve(p.ticket?.id === ticket.id && p.ticket?.status === 'ready'); });
    });
    await svc.transitionTicket(deps, owner, ticket.id, { to: 'ready' });
    ownerReceivedUpdate = await event;
  }
  result = {
    name: 'approved-support-http-vs-realtime',
    approvedSupportActorKind: supportActor?.kind ?? null,
    http: { unauthenticated: httpUnauthenticated.status, approvedSupport: httpSupport.status, owner: httpOwner.status, supportBoardOpenTickets: httpSupport.body.open?.length ?? null },
    realtime: { unauthenticated: { connected: noCookieSocket.connected, error: noCookieSocket.error }, approvedSupport: { connected: supportSocket.connected, error: supportSocket.error }, owner: { connected: ownerSocket.connected, error: ownerSocket.error, receivedTicketUpdate: ownerReceivedUpdate } },
  };
  console.log(JSON.stringify(result));
} finally {
  await writeFile(new URL('./support-realtime-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  for (const s of sockets) s.close();
  await new Promise<void>(resolve => rt.close(() => resolve()));
  if (http.listening) await new Promise<void>(resolve => http.close(() => resolve()));
  await t.stop();
}

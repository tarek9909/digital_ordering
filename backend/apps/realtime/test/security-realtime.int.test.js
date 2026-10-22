import { createServer } from 'node:http';
import { parseIpRules } from '@dop/config';
import { startTestDatabase } from '@dop/db/testing';
import { acceptInvitation, createVenue, inviteMember, listMembers, removeMember, revokeSession, signInUser, createTenantWithOwner } from '@dop/services';
import { makeTestDeps } from '@dop/services/testing';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRealtime, fanOut } from '../src/server.js';
// Regression tests for the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md): established board
// sockets follow session and membership changes (H-7), the HTTP MFA rule applies to sockets (M-10), and handshake
// admission counts real client addresses behind a trusted proxy (H-2).
let t;
let deps;
const servers = [];
const sockets = [];
const PASSWORD = 'a-long-unique-passphrase';
let n = 0;
beforeAll(async () => {
    t = await startTestDatabase();
    deps = makeTestDeps(t.clients);
    deps.clock.set(new Date());
    // Bus: what services publish reaches every realtime instance, with deps for re-checks (as main.ts wires it).
    const publish = deps.kv.publish.bind(deps.kv);
    deps.kv.publish = async (ch, msg) => {
        await publish(ch, msg);
        for (const s of servers)
            fanOut(s.rt, JSON.parse(msg), deps);
    };
});
afterAll(async () => {
    sockets.forEach((s) => s.close());
    for (const s of servers)
        s.rt.close();
    await t?.stop();
});
async function server(opts = {}) {
    const http = createServer();
    const rt = createRealtime(http, { deps, insecureCookies: true, isAllowedOrigin: () => true, ...opts });
    await new Promise((r) => http.listen(0, r));
    servers.push({ http, rt });
    return `http://127.0.0.1:${http.address().port}`;
}
function open(url, auth, headers) {
    const s = connect(url, { path: '/rt/', auth, extraHeaders: headers, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return new Promise((resolve, reject) => {
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
    });
}
const closed = (s) => new Promise((resolve) => s.once('disconnect', resolve));
async function tenant() {
    n++;
    const slug = `rts-${n}-${Math.random().toString(36).slice(2, 6)}`;
    const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `${slug}@x.test`, password: PASSWORD, restaurantName: slug, slug, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
    await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
    return { ...r, slug, host: `${slug}.dop.test`, email: `${slug}@x.test` };
}
async function boardSocket(url, x, email = x.email) {
    const s = await signInUser(deps, email, PASSWORD, x.tenantId, { ip: '1.1.1.1', userAgent: 'test', host: x.host });
    if (s.kind !== 'session')
        throw new Error('expected a session');
    const sock = await open(url, { app: 'staff', venueId: x.venueId }, { Cookie: `dop_sid=${s.token}`, Host: x.host });
    return { sock, session: s };
}
describe('H-7 established board sockets follow the session', () => {
    it('disconnects on sign-out / revocation, on every instance', async () => {
        const a = await server();
        const b = await server();
        const x = await tenant();
        const one = await boardSocket(a, x);
        const two = await boardSocket(b, x, x.email);
        const gone = Promise.all([closed(one.sock), closed(two.sock)]);
        await revokeSession(deps, one.session.sessionId);
        await revokeSession(deps, two.session.sessionId);
        await expect(gone).resolves.toBeDefined();
    });
    it('disconnects a removed member', async () => {
        const url = await server();
        const x = await tenant();
        const owner = { kind: 'user', userId: x.userId, tenantId: x.tenantId, role: 'owner', sessionId: 's', mfaVerified: true };
        await inviteMember(deps, owner, x.tenantId, `m-${x.slug}@x.test`, 'manager');
        const link = deps.jobs.added.filter((j) => j.name === 'email.send').at(-1).data.data.link;
        await acceptInvitation(deps, new URL(link).searchParams.get('token'), { name: 'M', password: PASSWORD }, { ip: '1.1.1.1', userAgent: 'test', host: x.host });
        const { sock } = await boardSocket(url, x, `m-${x.slug}@x.test`);
        const membership = (await listMembers(deps, x.tenantId)).members.find((m) => m.email === `m-${x.slug}@x.test`);
        const gone = closed(sock);
        await removeMember(deps, owner, x.tenantId, membership.id);
        await expect(gone).resolves.toBeDefined();
    });
    it('re-checks on a timer, so an expired session ends even without a revocation message', async () => {
        const url = await server({ revalidateMs: 150 });
        const x = await tenant();
        const { sock, session } = await boardSocket(url, x);
        const gone = closed(sock);
        await t.clients.platform().updateTable('user_sessions').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', session.sessionId).execute();
        await expect(gone).resolves.toBeDefined();
    });
});
describe('M-10 the HTTP two-factor rule applies to board sockets', () => {
    it('refuses a no-MFA owner of a multi-venue tenant', async () => {
        const url = await server();
        const x = await tenant();
        const pdb = t.clients.platform();
        const plan = await pdb.selectFrom('plans').select('id').where('code', '=', 'multisite').executeTakeFirstOrThrow();
        await pdb.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: plan.id }).where('id', '=', x.tenantId).execute();
        await deps.kv.del(`t:${x.tenantId}:flags`);
        const owner = { kind: 'user', userId: x.userId, tenantId: x.tenantId, role: 'owner', sessionId: 's', mfaVerified: true };
        await createVenue(deps, owner, x.tenantId, 'Second');
        await expect(boardSocket(url, x)).rejects.toThrow(/UNAUTHENTICATED/);
    });
});
describe('H-2 handshake admission counts the real client', () => {
    it('limits each forwarded client separately behind a trusted proxy', async () => {
        const url = await server({ trustProxy: parseIpRules(['loopback']) });
        const tryOne = (ip) => open(url, { clientId: 'C'.repeat(22), tickets: [] }, { 'X-Forwarded-For': ip }).then((s) => (s.close(), true), () => false);
        for (let i = 0; i < 30; i++)
            expect(await tryOne('203.0.113.1')).toBe(true);
        expect(await tryOne('203.0.113.1')).toBe(false); // over the 30-per-minute budget
        expect(await tryOne('203.0.113.2')).toBe(true); // another client is unaffected
    });
    it('ignores X-Forwarded-For from a peer that is not a configured proxy', async () => {
        const url = await server();
        const tryOne = (ip) => open(url, { clientId: 'D'.repeat(22), tickets: [] }, { 'X-Forwarded-For': ip }).then((s) => (s.close(), true), () => false);
        // All of these come from the same real peer, whatever the header claims, so changing the header never buys
        // a fresh budget: at most 30 are admitted in the minute (fewer if this peer already connected).
        let admitted = 0;
        for (let i = 0; i < 31; i++)
            if (await tryOne(`198.51.100.${i}`))
                admitted++;
        expect(admitted).toBeLessThanOrEqual(30);
        expect(await tryOne('198.51.100.250')).toBe(false);
    });
});

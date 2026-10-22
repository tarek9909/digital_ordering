// Run from backend/: npx tsx ../docs/security/2026-10-22/root-security-probes.mts
// Disposable MySQL, captured in-memory logs, and no external calls.
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeApi, client } from '../../../backend/apps/api/test/helpers.ts';
import { createApp } from '../../../backend/apps/api/src/app.ts';
import { signup, createTicket, inviteMember, publicTicketView } from '../../../backend/packages/services/src/index.ts';
const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const pino = require('pino');
const db = await startTestDatabase();
const { deps } = makeApi(db.clients);
const chunks: string[] = [];
deps.log = pino({ level: 'info' }, new Writable({ write(chunk, _encoding, cb) { chunks.push(chunk.toString()); cb(); } }));
const app = createApp(deps, { trustProxy: false, logRequests: true });
const results: object[] = [];
try {
  const tenant = await signup(deps, { ownerName: 'Security Owner', email: 'security-owner@audit.invalid', password: 'audit-password-long-enough', restaurantName: 'Security Audit', slug: 'security-root', country: 'SA', locale: 'en', acceptTerms: true }, { ip: '127.0.0.1' });
  await db.clients.platform().updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', tenant.userId).execute();
  const actor = { kind: 'user' as const, userId: tenant.userId, tenantId: tenant.tenantId, role: 'owner' as const, sessionId: 'security-probe', mfaVerified: false };
  const ticket = (await createTicket(deps, actor, tenant.venueId, {})).ticket;
  const customer = client(app, 't.dop.test');
  const before = chunks.length;
  const manifest = await customer.get(`/m/${ticket.token}.webmanifest`);
  const manifestLog = chunks.slice(before).join('');
  const publicView = await publicTicketView(deps, ticket.token);
  results.push({ finding: 'Ticket credential leaked in manifest request log', status: manifest.status, fullCredentialInLog: manifestLog.includes(ticket.token), credentialAuthorizesTicket: publicView.token === ticket.token });

  await inviteMember(deps, actor, tenant.tenantId, 'security-manager@audit.invalid', 'manager');
  const emailJob = deps.jobs.added.filter((x: any) => x.name === 'email.send' && x.data.to === 'security-manager@audit.invalid').at(-1) as any;
  const invitationUrl = new URL(String(emailJob.data.data.link));
  const invitationToken = invitationUrl.searchParams.get('token')!;
  const anonymousTenant = client(app, 'security-root.dop.test');
  const beforeInvitation = chunks.length;
  const invitation = await anonymousTenant.get(`/api/auth/v1/invitations/${invitationToken}`);
  const invitationLog = chunks.slice(beforeInvitation).join('');
  results.push({ finding: 'Invitation credential leaked in API request log', status: invitation.status, fullCredentialInLog: invitationLog.includes(invitationToken), responseExposesInviteEmail: invitation.body.email === 'security-manager@audit.invalid' });

  const markerCode = 'AUDIT_OAUTH_AUTHORIZATION_CODE';
  const markerState = 'AUDIT_OAUTH_STATE';
  const beforeCallback = chunks.length;
  await client(app, 'www.dop.test').get(`/api/auth/v1/oauth/google/callback?code=${markerCode}&state=${markerState}`);
  const callbackLog = chunks.slice(beforeCallback).join('');
  results.push({ finding: 'OAuth query parameters leaked in request log', authorizationCodeInLog: callbackLog.includes(markerCode), stateInLog: callbackLog.includes(markerState), note: 'Provider intentionally unconfigured; verifies request serialization before provider logic.' });

  const beforeMasked = chunks.length;
  await customer.get(`/api/public/v1/tickets/${ticket.token}`);
  results.push({ control: 'Normal ticket API path masks token in request log', fullCredentialInLog: chunks.slice(beforeMasked).join('').includes(ticket.token) });
} finally {
  await db.stop();
  await writeFile(new URL('root-security-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

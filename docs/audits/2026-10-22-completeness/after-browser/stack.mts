// Disposable verification stack for the post-repair browser journeys (REMEDIATION.md). Own MySQL database (mysql-memory-
// server), in-memory jobs and KV, fake/no external providers; never the developer's live stack on 4000/4001.
// From backend/:  npx tsx --tsconfig tsconfig.json ../docs/audits/2026-10-22-completeness/after-browser/stack.mts
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseIpRules } from '../../../../backend/packages/config/src/index.js';
import type { BusEvent } from '../../../../backend/packages/contracts/src/index.js';
import { startTestDatabase } from '../../../../backend/packages/db/src/testing.js';
import { makeApi } from '../../../../backend/apps/api/test/helpers.js';
import { appOriginCheck, createRealtime, fanOut } from '../../../../backend/apps/realtime/src/server.js';
import { seedDemo } from '../../../../backend/packages/services/src/seed.js';

const PORTS = { customer: 5273, staff: 5274, display: 5275, admin: 5276, console: 5277, www: 5278 };
const database = await startTestDatabase();
const { app, deps } = makeApi(database.clients);
deps.config = { ...deps.config, domain: 'dop.localhost', appEnv: 'local', scheme: 'http', localPorts: PORTS };
deps.now = () => new Date();
const seeded = await seedDemo(deps);

const rtHttp = createServer();
// Vite proxies /rt from loopback with X-Forwarded-Host, as Caddy does in production.
const rt = createRealtime(rtHttp, { deps, insecureCookies: true, trustProxy: parseIpRules(['loopback']), isAllowedOrigin: (o, h) => appOriginCheck('dop.localhost')(o?.replace(/:\d+$/, ''), h) });
const publish = deps.kv.publish.bind(deps.kv);
deps.kv.publish = async (ch, msg) => {
  await publish(ch, msg);
  fanOut(rt, JSON.parse(msg) as BusEvent, deps);
};
rtHttp.listen(4401, '127.0.0.1');
const server = app.listen(4400, '127.0.0.1', () => {
  // Seeded console users' TOTP secrets go to a private file for the journeys, never to the console.
  if (process.env.STACK_INFO) writeFileSync(process.env.STACK_INFO, JSON.stringify({ platformUsers: seeded.platformUsers.map((u) => ({ email: u.email, role: u.role, totpSecret: u.totpSecret })) }));
  console.log(`STACK_READY api 4400 realtime 4401 (isolated database; in-memory queue; no providers)`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(async () => { rt.close(); await database.stop(); process.exit(0); }));

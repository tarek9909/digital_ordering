// Disposable audit API. Uses its own MySQL database, in-memory jobs and no external providers.
// From backend/: npx tsx --tsconfig tsconfig.json ../docs/audits/2026-10-22/runtime-server.mts
import { startTestDatabase } from '../../../backend/packages/db/src/testing.js';
import { makeApi } from '../../../backend/apps/api/test/helpers.js';
import { seedDemo } from '../../../backend/packages/services/src/seed.js';
import { LOCAL_PORTS } from '../../../backend/packages/services/src/deps.js';

const database = await startTestDatabase();
const { app, deps } = makeApi(database.clients);
deps.config = { ...deps.config, domain: 'dop.localhost', appEnv: 'local', scheme: 'http', localPorts: LOCAL_PORTS };
deps.now = () => new Date();
await seedDemo(deps);
const server = app.listen(4400, '127.0.0.1', () => console.log('AUDIT_API_READY 4400 (isolated database; in-memory queue; fake billing)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(async () => { await database.stop(); process.exit(0); }));

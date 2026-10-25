import { staticKeyProvider } from '@dop/auth';
import { loadEnv } from '@dop/config';
import { MemoryJobs } from '@dop/jobs';
import { LOCAL_PORTS, MemoryKV, SEED_PASSWORD, SEED_PIN, seedDemo } from '@dop/services';
import pino from 'pino';
import { createDb, seedReferenceData } from '@dop/db';

// `npm run db:seed`: reference data everywhere; demo data (TR-TST-01) only on a developer machine or in tests. Demo
// accounts share a published password and TOTP secrets (I-2), so a reachable dev or staging server never gets them
// unless an operator explicitly sets SEED_DEMO_DATA=yes for a disposable, private environment.
const env = loadEnv();
const db = createDb(env.DATABASE_URL);
await seedReferenceData(db.platform());
console.log('reference data seeded');
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test' && !(env.APP_ENV !== 'production' && process.env.SEED_DEMO_DATA === 'yes')) {
  console.log(`${env.APP_ENV}: demo data skipped (known demo credentials)`);
} else {
  const r = await seedDemo({
    config: { domain: env.PLATFORM_DOMAIN, appEnv: env.APP_ENV, pepper: env.SESSION_PEPPER, cdnBaseUrl: env.CDN_BASE_URL, vapidPublicKey: env.VAPID_PUBLIC_KEY, scheme: env.INSECURE_COOKIES ? 'http' : 'https', localPorts: env.APP_ENV === 'local' ? LOCAL_PORTS : undefined },
    db,
    kv: new MemoryKV(),
    jobs: new MemoryJobs(),
    keys: staticKeyProvider(env.LOCAL_DATA_KEY ?? ''),
    log: pino({ level: 'warn' }),
    now: () => new Date(),
  });
  console.log(`\nPassword for every seeded account: ${SEED_PASSWORD}   Staff PIN: ${SEED_PIN}`);
  for (const u of r.platformUsers) console.log(`console  ${u.role.padEnd(12)} ${u.email}  TOTP secret ${u.totpSecret}`);
  for (const t of r.tenants) console.log(`tenant   ${t.status.padEnd(12)} ${t.ownerEmail}${t.managerEmail ? `  manager ${t.managerEmail}` : ''}  staff link ${t.staffLink}`);
}
await db.destroy();

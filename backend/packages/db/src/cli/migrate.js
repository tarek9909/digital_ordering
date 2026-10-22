import { Kysely, MysqlDialect, sql } from 'kysely';
import { createPool } from 'mysql2';
import { migrateToLatest } from '../migrator.js';
import { seedReferenceData } from '../reference-data.js';
// Run by the deploy step with the migration account (TR-DB-08): migrations, idempotent reference data
// (plans, flags, settings, languages) and, when APP_DB_USER is set, the partition-maintenance grant.
const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!url) {
    console.error('DATABASE_MIGRATE_URL or DATABASE_URL is required');
    process.exit(1);
}
const db = new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: url, multipleStatements: false }) }) });
const { error, results } = await migrateToLatest(db);
for (const r of results ?? [])
    console.log(`${r.status === 'Success' ? 'applied' : r.status}: ${r.migrationName}`);
if (error) {
    console.error(error);
    await db.destroy();
    process.exit(1);
}
await seedReferenceData(db);
console.log('reference data up to date');
const appUser = process.env.APP_DB_USER;
if (appUser && /^[A-Za-z0-9_]+$/.test(appUser)) {
    await sql `GRANT ALTER, DROP ON ticket_events TO ${sql.lit(appUser)}@'%'`.execute(db);
    console.log(`granted partition maintenance to ${appUser}`);
}
await db.destroy();

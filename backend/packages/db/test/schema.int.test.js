import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_TABLES, PLATFORM_TABLES } from '../src/tables.js';
import { startTestDatabase } from '../src/testing.js';
let t;
beforeAll(async () => {
    t = await startTestDatabase();
});
afterAll(async () => {
    await t?.stop();
});
describe('schema (TRD §7)', () => {
    it('creates every table and seeds reference data', async () => {
        const db = t.clients.platform();
        const rows = await sql `select TABLE_NAME from information_schema.TABLES where TABLE_SCHEMA = database()`.execute(db);
        const names = new Set(rows.rows.map((r) => r.TABLE_NAME));
        for (const n of [...TENANT_TABLES, ...PLATFORM_TABLES])
            expect(names, n).toContain(n);
        const plans = await db.selectFrom('plans').select(['code', 'limits']).orderBy('sort_order').execute();
        expect(plans.map((p) => p.code)).toEqual(['trial', 'standard', 'pro', 'multisite']);
        expect(plans[0].limits).toMatchObject({ trialTicketsPerDay: 200 });
    });
    it('has no tenant-owned table without tenant_id (FR-TEN-02, TR-TEN-05)', async () => {
        const db = t.clients.platform();
        const rows = await sql `
      select TABLE_NAME from information_schema.COLUMNS
      where TABLE_SCHEMA = database() and COLUMN_NAME = 'tenant_id'`.execute(db);
        const withTenant = new Set(rows.rows.map((r) => r.TABLE_NAME));
        for (const n of TENANT_TABLES)
            expect(withTenant, n).toContain(n);
    });
    it('uses InnoDB and utf8mb4 everywhere (TR-DB-01)', async () => {
        const db = t.clients.platform();
        const rows = await sql `
      select TABLE_NAME, ENGINE, TABLE_COLLATION from information_schema.TABLES where TABLE_SCHEMA = database() and TABLE_NAME <> 'kysely_migration' and TABLE_NAME <> 'kysely_migration_lock'`.execute(db);
        for (const r of rows.rows) {
            expect(r.ENGINE, r.TABLE_NAME).toBe('InnoDB');
            expect(r.TABLE_COLLATION, r.TABLE_NAME).toBe('utf8mb4_0900_ai_ci');
        }
    });
    it('enforces one active owner per tenant (BR-20) through the generated key', async () => {
        const db = t.clients.platform();
        const plan = await db.selectFrom('plans').select('id').where('code', '=', 'trial').executeTakeFirstOrThrow();
        await db.insertInto('tenants').values({ id: 't-1', name: 'T', slug: 'tee', plan_id: plan.id, country: 'SA', default_locale: 'ar' }).execute();
        await db.insertInto('users').values([
            { id: 'u-1', email: 'a@x.test', name: 'A' },
            { id: 'u-2', email: 'b@x.test', name: 'B' },
        ]).execute();
        await db.insertInto('tenant_memberships').values({ id: 'm-1', tenant_id: 't-1', user_id: 'u-1', role: 'owner' }).execute();
        await expect(db.insertInto('tenant_memberships').values({ id: 'm-2', tenant_id: 't-1', user_id: 'u-2', role: 'owner' }).execute()).rejects.toThrow(/Duplicate/);
    });
});

import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { scope, scopedSql } from '../src/client.js';
import type { Database } from '../src/types.js';

// TR-TEN-03: the plugin's own unit tests cover every query shape (compiled offline, no database).

const base = new Kysely<Database>({
  dialect: {
    createAdapter: () => new MysqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new MysqlIntrospector(db),
    createQueryCompiler: () => new MysqlQueryCompiler(),
  },
});
const A = 'aaaaaaaa-0000-7000-8000-000000000001';
const db = scope(base, A);
const compile = (q: { compile(): { sql: string; parameters: readonly unknown[] } }) => q.compile();

describe('TenantScopePlugin', () => {
  it('scopes SELECT on a tenant table', () => {
    const c = compile(db.selectFrom('tickets').selectAll().where('id', '=', 'x'));
    expect(c.sql).toBe('select * from `tickets` where (`id` = ?) and `tickets`.`tenant_id` = ?');
    expect(c.parameters).toEqual(['x', A]);
  });

  it('keeps OR filters inside the tenant predicate', () => {
    const c = compile(db.selectFrom('tickets').selectAll().where((eb) => eb.or([eb('id', '=', 'x'), eb('token', '=', 'y')])));
    expect(c.sql).toContain('where ((`id` = ? or `token` = ?)) and `tickets`.`tenant_id` = ?');
  });

  it('leaves platform tables alone', () => {
    const c = compile(db.selectFrom('tenants').selectAll().where('id', '=', A));
    expect(c.sql).toBe('select * from `tenants` where `id` = ?');
  });

  it('scopes aliases and every join type on the join condition', () => {
    const c = compile(
      db
        .selectFrom('tickets as t')
        .innerJoin('venues as v', 'v.id', 't.venue_id')
        .leftJoin('counters as c', 'c.id', 't.counter_id')
        .select(['t.id', 'v.name', 'c.name as counter']),
    );
    expect(c.sql).toContain('inner join `venues` as `v` on `v`.`id` = `t`.`venue_id` and `v`.`tenant_id` = ?');
    expect(c.sql).toContain('left join `counters` as `c` on `c`.`id` = `t`.`counter_id` and `c`.`tenant_id` = ?');
    expect(c.sql).toContain('where `t`.`tenant_id` = ?');
    expect(c.parameters).toEqual([A, A, A]);
  });

  it('scopes sub-queries, CTEs and UNIONs', () => {
    const sub = compile(
      db.selectFrom('venues').select('id').where('id', 'in', db.selectFrom('tickets').select('venue_id').where('status', '=', 'ready')),
    );
    expect(sub.sql.match(/`tenant_id` = \?/g)).toHaveLength(2);

    const cte = compile(db.with('open', (q) => q.selectFrom('tickets').select('id').where('status', '=', 'ready')).selectFrom('open').selectAll());
    expect(cte.sql).toContain('`tickets`.`tenant_id` = ?');

    const union = compile(
      db.selectFrom('tickets').select('id').where('status', '=', 'ready').union(db.selectFrom('tickets').select('id').where('status', '=', 'collected')),
    );
    expect(union.sql.match(/`tickets`.`tenant_id` = \?/g)).toHaveLength(2);
  });

  it('scopes UPDATE and DELETE', () => {
    const u = compile(db.updateTable('tickets').set({ note: 'n' }).where('id', '=', 'x'));
    expect(u.sql).toBe('update `tickets` set `note` = ? where (`id` = ?) and `tickets`.`tenant_id` = ?');
    const unfiltered = compile(db.updateTable('tickets').set({ note: 'n' }));
    expect(unfiltered.sql).toBe('update `tickets` set `note` = ? where `tickets`.`tenant_id` = ?');
    const d = compile(db.deleteFrom('ticket_followers').where('ticket_id', '=', 'x'));
    expect(d.sql).toBe('delete from `ticket_followers` where (`ticket_id` = ?) and `ticket_followers`.`tenant_id` = ?');
  });

  it('accepts INSERT and upsert with the context tenant and rejects others', () => {
    const ok = compile(
      db
        .insertInto('alert_deliveries')
        .values({ tenant_id: A, ticket_id: 't', round: 1, attempt: '1', subscription_id: 's', outcome: 'sent', status_code: 201 })
        .onDuplicateKeyUpdate({ outcome: 'sent' }),
    );
    expect(ok.sql).toContain('on duplicate key update');
    // L-11: upserts only where every unique key belongs to one tenant, and never re-homing a row.
    expect(() =>
      compile(db.insertInto('number_sequences').values({ tenant_id: A, venue_id: 'v', sequence_key: '', business_date: '2026-10-22', last_number: 0 }).onDuplicateKeyUpdate({ last_number: 0 })),
    ).toThrow(/upsert into number_sequences/);
    expect(() =>
      compile(db.insertInto('alert_deliveries').values({ tenant_id: A, ticket_id: 't', round: 1, attempt: '1', subscription_id: 's', outcome: 'sent', status_code: 201 }).onDuplicateKeyUpdate({ tenant_id: A })),
    ).toThrow(/may not change tenant_id/);
    expect(() => compile(db.insertInto('counters').values({ id: '1', tenant_id: 'other', venue_id: 'v', name: 'x' }))).toThrow(/foreign tenant_id/);
    expect(() => compile(db.insertInto('counters').values({ id: '1', venue_id: 'v', name: 'x' } as never))).toThrow(/without tenant_id/);
    expect(() =>
      compile(
        db.insertInto('counters').values([
          { id: '1', tenant_id: A, venue_id: 'v', name: 'x' },
          { id: '2', tenant_id: 'other', venue_id: 'v', name: 'y' },
        ]),
      ),
    ).toThrow(/foreign tenant_id/);
  });

  it('rejects raw SQL on tenant tables unless built with scopedSql', () => {
    /* eslint-disable dop/no-unscoped-raw-sql -- these are the unscoped queries the plugin must refuse */
    expect(() => compile(db.selectFrom('tenants').select(sql<number>`(select count(*) from tickets)`.as('n')))).toThrow(/scopedSql/);
    expect(() => compile(db.selectFrom('tenants').select(sql<number>`(select count(*) from ${sql.table('tickets')})`.as('n')))).toThrow(/scopedSql/);
    const ok = compile(db.selectFrom('tenants').select(scopedSql<number>(A, ['(select count(*) from tickets where tenant_id = ', ')'] as unknown as TemplateStringsArray, A).as('n')));
    expect(ok.sql).toContain('tenant-scoped');
    expect(() => scopedSql(A, ['select * from tickets'] as unknown as TemplateStringsArray)).toThrow();
  });

  it('refuses to build without a tenant', () => {
    expect(() => scope(base, '')).toThrow(/missing tenant/);
  });
});

describe('TenantScopePlugin nesting', () => {
  it('refuses to mix builders of two tenants', () => {
    const other = scope(base, 'bbbbbbbb-0000-7000-8000-000000000002');
    expect(() => compile(db.selectFrom('venues').select('id').where('id', 'in', other.selectFrom('tickets').select('venue_id')))).toThrow(/different tenants/);
  });
});

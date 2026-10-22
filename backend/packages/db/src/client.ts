import { Kysely, MysqlDialect, sql, type RawBuilder, type Transaction } from 'kysely';
import { createPool, type Pool, type PoolOptions } from 'mysql2';
import { TENANT_TABLES } from './tables.js';
import { SCOPED_RAW_MARKER, TenantScopePlugin } from './tenant-scope.js';
import type { Database } from './types.js';

// Data clients (TRD §6.3). Only packages/db sees the unscoped instance (TR-TEN-04).

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;

export interface DbClients {
  /** Tenant-scoped client: every query is filtered to `tenantId` (layer 2). */
  forTenant(tenantId: string): Db;
  /** Cross-tenant client for console routes, workers and auth lookups only (TR-TEN-06). */
  platform(): Db;
  /** Read replica for reports, via `app_report` (TR-RPT-03). */
  replica(): Db;
  destroy(): Promise<void>;
}

function poolOptions(url: string): PoolOptions {
  return {
    uri: url,
    connectionLimit: 20,
    timezone: 'Z',
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: false,
    // BOOLEAN is TINYINT(1); return JS booleans.
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === '1';
      }
      return next();
    },
  };
}

function makePool(url: string): Pool {
  const pool = createPool(poolOptions(url));
  // TR-DB-01, TR-DB-03: UTC and READ COMMITTED on every connection.
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
    conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  });
  return pool;
}

export function createDb(url: string, replicaUrl?: string): DbClients {
  const base = new Kysely<Database>({ dialect: new MysqlDialect({ pool: makePool(url) }) });
  const replica = replicaUrl && replicaUrl !== url ? new Kysely<Database>({ dialect: new MysqlDialect({ pool: makePool(replicaUrl) }) }) : base;
  return {
    forTenant: (tenantId) => base.withPlugin(new TenantScopePlugin(tenantId, TENANT_TABLES)),
    platform: () => base,
    replica: () => replica,
    destroy: async () => {
      await base.destroy();
      if (replica !== base) await replica.destroy();
    },
  };
}

/** Wraps an existing Kysely (tests, transactions) with the tenant scope. */
export const scope = <T extends Db | Tx>(db: T, tenantId: string): T =>
  db.withPlugin(new TenantScopePlugin(tenantId, TENANT_TABLES)) as T;

/**
 * Raw SQL on tenant tables must include the tenant predicate (TR-TEN-03, TR-TEN-04): at least one
 * `tenant_id = ${tenantId}`, and every `tenant_id = ${…}` bound to this tenant (I-10).
 */
export function scopedSql<T = unknown>(tenantId: string, strings: TemplateStringsArray, ...values: unknown[]): RawBuilder<T> {
  const predicates = values.map((v, i) => ({ v, isTenant: /tenant_id\s*=\s*$/i.test(strings[i] ?? '') })).filter((p) => p.isTenant);
  if (predicates.length === 0 || predicates.some((p) => p.v !== tenantId)) {
    throw new Error('scopedSql requires every tenant_id = ${…} predicate to bind this tenant');
  }
  const [first, ...rest] = strings;
  const marked = Object.assign([`${SCOPED_RAW_MARKER} ${first ?? ''}`, ...rest], { raw: [] }) as unknown as TemplateStringsArray;
  return sql<T>(marked, ...values);
}

/** JSON columns are written as validated strings (TR-DB-10). */
export const json = (v: unknown) => JSON.stringify(v);

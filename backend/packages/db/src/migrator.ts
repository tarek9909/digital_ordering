import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator, sql, type Kysely, type Migration, type MigrationProvider, type MigrationResultSet } from 'kysely';

// Plain SQL migration files run by the Kysely migrator (TRD §3.2, TR-DB-07).

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Splits a SQL file into statements after removing `--` comments. */
export function splitSql(text: string): string[] {
  const noComments = text
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
  return noComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

class SqlFileProvider implements MigrationProvider {
  constructor(private readonly dir: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
    const out: Record<string, Migration> = {};
    for (const f of files) {
      const statements = splitSql(await readFile(join(this.dir, f), 'utf8'));
      out[f.replace(/\.sql$/, '')] = {
        async up(db: Kysely<unknown>) {
          for (const s of statements) {
            try {
              await sql.raw(s).execute(db);
            } catch (e) {
              throw new Error(`${f}: ${(e as Error).message} in: ${s.slice(0, 80)}`, { cause: e });
            }
          }
        },
      };
    }
    return out;
  }
}

export async function migrateToLatest(db: Kysely<unknown>, dir = MIGRATIONS_DIR): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db, provider: new SqlFileProvider(dir) });
  return migrator.migrateToLatest();
}

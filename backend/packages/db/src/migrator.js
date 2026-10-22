import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator, sql } from 'kysely';
// Plain SQL migration files run by the Kysely migrator (TRD §3.2, TR-DB-07).
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/** Splits a SQL file into statements after removing `--` comments. */
export function splitSql(text) {
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
class SqlFileProvider {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async getMigrations() {
        const files = (await readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
        const out = {};
        for (const f of files) {
            const statements = splitSql(await readFile(join(this.dir, f), 'utf8'));
            out[f.replace(/\.sql$/, '')] = {
                async up(db) {
                    for (const s of statements) {
                        try {
                            await sql.raw(s).execute(db);
                        }
                        catch (e) {
                            throw new Error(`${f}: ${e.message} in: ${s.slice(0, 80)}`, { cause: e });
                        }
                    }
                },
            };
        }
        return out;
    }
}
export async function migrateToLatest(db, dir = MIGRATIONS_DIR) {
    const migrator = new Migrator({ db, provider: new SqlFileProvider(dir) });
    return migrator.migrateToLatest();
}

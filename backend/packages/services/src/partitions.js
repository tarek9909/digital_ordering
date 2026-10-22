import { sql } from '@dop/db';
// `partitions.maintain` daily (TR-DB-11): keeps monthly partitions for the next 3 months by splitting p_future,
// and drops partitions older than the retention once their tickets' roll-ups exist (retention by partition).
const monthStart = (d, add) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
    return x.toISOString().slice(0, 10);
};
const pname = (date) => `p${date.slice(0, 7).replace('-', '')}`;
export async function maintainPartitions(deps, table = 'ticket_events', retentionDays = 90) {
    const db = deps.db.platform();
    const r = await sql `
    SELECT PARTITION_NAME AS name, PARTITION_DESCRIPTION AS descr FROM information_schema.PARTITIONS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND PARTITION_NAME IS NOT NULL ORDER BY PARTITION_ORDINAL_POSITION`.execute(db);
    const existing = new Set(r.rows.map((x) => x.name));
    if (!existing.has('p_future'))
        return { created: [], dropped: [] };
    const created = [];
    // Partition for month m holds rows before the first day of month m+1.
    for (let i = 0; i <= 3; i++) {
        const name = pname(monthStart(deps.now(), i));
        if (existing.has(name))
            continue;
        const upper = monthStart(deps.now(), i + 1);
        await sql `ALTER TABLE ${sql.table(table)} REORGANIZE PARTITION p_future INTO (PARTITION ${sql.id(name)} VALUES LESS THAN (TO_DAYS(${upper})), PARTITION p_future VALUES LESS THAN MAXVALUE)`.execute(db);
        created.push(name);
    }
    const cutoff = monthStart(new Date(deps.now().getTime() - retentionDays * 86_400_000), 0);
    const dropped = [];
    for (const p of r.rows) {
        if (!/^p\d{6}$/.test(p.name))
            continue;
        const month = `${p.name.slice(1, 5)}-${p.name.slice(5, 7)}-01`;
        if (month < monthStart(new Date(`${cutoff}T00:00:00Z`), -1)) {
            await sql `ALTER TABLE ${sql.table(table)} DROP PARTITION ${sql.id(p.name)}`.execute(db);
            dropped.push(p.name);
        }
    }
    return { created, dropped };
}

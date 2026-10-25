import { jsonValue } from './format';

// Normalises `platform_metrics_daily` rows from GET /reports/platform (FR-RPT-07, TR-RPT-06).

export interface PlatformDay {
  date: string;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  signups: number;
  cancellations: number;
  /** Minor units per currency. */
  mrr: Record<string, number>;
  tickets: number;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numMap = (v: unknown) => Object.fromEntries(Object.entries(jsonValue<Record<string, unknown>>(v, {})).map(([k, x]) => [k, num(x)]));

export function normalizeDay(row: Record<string, unknown>): PlatformDay {
  const d = row.metric_date;
  const date = typeof d === 'string' ? d.slice(0, 10) : d instanceof Date ? d.toISOString().slice(0, 10) : '';
  return {
    date,
    byStatus: numMap(row.tenants_by_status),
    byPlan: numMap(row.tenants_by_plan),
    signups: num(row.signups),
    cancellations: num(row.cancellations),
    mrr: numMap(row.mrr_minor),
    tickets: num(row.tickets),
  };
}

/** Sorted union of the keys of one map field across days (table columns). */
export const keysOf = (days: PlatformDay[], f: 'byStatus' | 'byPlan' | 'mrr') => [...new Set(days.flatMap((d) => Object.keys(d[f])))].sort();

// Pure helpers for the R1.1/R2 reports (FR-RPT-02/03/04): deltas against the previous period, the weekday × hour
// heatmap and its table fallback, and report query parameters.

export const ALL_VENUES = 'all';

export interface ReportFilter {
  venueId: string; // a venue ID or ALL_VENUES
  counterId: string; // '' = all counters
  from: string;
  to: string;
}

/** Query for /reports/trends and /reports/heatmap: "All venues" omits venueId; counters only with one venue. */
export function reportQuery(f: ReportFilter): Record<string, string> {
  const q: Record<string, string> = { from: f.from, to: f.to };
  if (f.venueId && f.venueId !== ALL_VENUES) {
    q.venueId = f.venueId;
    if (f.counterId) q.counterId = f.counterId;
  }
  return q;
}

/** Query for /reports/export.csv (venueId=all for every venue); a counter filter exports that counter only (W03). */
export function csvQuery(f: ReportFilter): Record<string, string> {
  const q: Record<string, string> = { from: f.from, to: f.to, venueId: f.venueId || ALL_VENUES };
  if (f.counterId && f.venueId && f.venueId !== ALL_VENUES) q.counterId = f.counterId;
  return q;
}

export type Direction = 'up' | 'down' | 'same' | 'none';
export interface Delta {
  diff: number | null;
  direction: Direction;
}

/** Current minus previous (rounded to 1 decimal); "none" when either side has no value. */
export function delta(current: number | null | undefined, previous: number | null | undefined): Delta {
  if (current === null || current === undefined || previous === null || previous === undefined) return { diff: null, direction: 'none' };
  const diff = Math.round((current - previous) * 10) / 10;
  return { diff, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same' };
}

/** Day order of the heatmap rows: Saturday first (Saudi week), then Sunday … Friday. Grid row 0 = Sunday. */
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

export interface HeatmapRow {
  weekday: number;
  cells: number[];
  total: number;
}

/** Grid (7 × 24) → rows in display order with totals; missing values count as 0. */
export function heatmapRows(grid: ReadonlyArray<ReadonlyArray<number>>, order: readonly number[] = WEEKDAY_ORDER): HeatmapRow[] {
  return order.map((weekday) => {
    const cells = Array.from({ length: 24 }, (_, h) => Number(grid[weekday]?.[h] ?? 0) || 0);
    return { weekday, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
}

/** Hours that have any tickets, so the table fallback skips empty night hours. */
export function activeHours(rows: readonly HeatmapRow[]): number[] {
  return Array.from({ length: 24 }, (_, h) => h).filter((h) => rows.some((r) => (r.cells[h] ?? 0) > 0));
}

export const heatmapMax = (rows: readonly HeatmapRow[]) => rows.reduce((m, r) => Math.max(m, ...r.cells), 0);

/** 0 for no tickets, else 1–5 (equal steps of the maximum). */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((value / max) * 5)));
}

/** "HH:00" label for an hour. */
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

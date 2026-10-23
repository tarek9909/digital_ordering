import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion, Select } from '@dop/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DataExport } from '../components/DataExport';
import { ErrorNote, Figures, Page, QueryView, Section, Stat, Table, Tabs, Td } from '../components/common';
import { SubNav } from '../components/SubNav';
import { api } from '../lib/api';
import { useRole } from '../lib/me';
import { formatDuration, isoDate, pct } from '../lib/format';
import { ALL_VENUES, activeHours, csvQuery, delta, heatLevel, heatmapMax, heatmapRows, hourLabel, reportQuery, type ReportFilter } from '../lib/reports';
import type { Counter, HeatmapReport, PilotReport, PilotSummary, TrendSummary, TrendsReport } from '../lib/types';
import { useCurrentVenueId, useVenues } from '../lib/venue';

// Reports (FR-RPT-02/03/04/10): trends against the previous period, weekday × hour heatmap, the per-day pilot table
// and CSV export (Pro). Filters: venue (or all venues, TR-FE-26), counter, date range. Wording never says a customer
// "heard" an alert (FR-ALR-11).

const REACH = ['push', 'live', 'closed', 'none'] as const;
// Chart colours come from the theme tokens (CSS variables), so charts follow the Ember palette with no hex here.
// Alert reach is an ink ramp, darkest for the alert that got furthest; the legend and table carry the meaning too.
const COLORS: Record<(typeof REACH)[number], string> = {
  push: 'var(--color-ink)',
  live: 'var(--color-ink-2)',
  closed: 'var(--color-muted)',
  none: 'var(--color-line)',
};
// Sequential warm ramp for heatmap levels 1–5 (ink mixed into the surface); level 0 stays the surface.
const HEAT = ['', ...[12, 28, 46, 68, 90].map((p) => `color-mix(in oklab, var(--color-ink) ${p}%, var(--color-surface))`)] as const;
const AXIS = {
  tick: { fill: 'var(--color-muted)', fontSize: 12 },
  stroke: 'var(--color-line)',
};
const TABS = ['trends', 'heatmap', 'daily'] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- pilot (per day)

function Row({ label, s }: { label: string; s: PilotSummary }) {
  return (
    <tr>
      <Td className="font-medium whitespace-nowrap">{label}</Td>
      <Td className="num">{s.tickets}</Td>
      {REACH.map((k) => (
        <Td key={k} className="num">
          {s.alertReach[k]}
        </Td>
      ))}
      <Td className="num">{pct(s.reachPushOrLivePct)}</Td>
      <Td className="num">{pct(s.acknowledgedPct)}</Td>
      <Td className="num">{formatDuration(s.prepSecondsP50)}</Td>
      <Td className="num">{formatDuration(s.prepSecondsP90)}</Td>
      <Td className="num">{formatDuration(s.pickupSecondsP50)}</Td>
      <Td className="num">{formatDuration(s.pickupSecondsP90)}</Td>
      <Td className="num">{s.uncollected}</Td>
    </tr>
  );
}

function ReachChart({ r }: { r: PilotReport }) {
  const { t } = useTranslation();
  const data = r.days.map((d) => ({ date: d.date.slice(5), ...d.alertReach }));
  return (
    <div className="h-72" dir="ltr" role="img" aria-label={t('reports.chartLabel')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="date" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} width={40} />
          <Tooltip cursor={{ fill: 'var(--color-primary-wash)' }} />
          <Legend />
          {REACH.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="reach"
              name={t(`common:alertLevel.${k}`)}
              fill={COLORS[k]}
              stroke="var(--color-surface)"
              strokeWidth={2}
              radius={i === REACH.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Daily({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['pilot', f.venueId, f.from, f.to],
    queryFn: () =>
      api.get<PilotReport>('/reports/pilot', {
        from: f.from,
        to: f.to,
        venueId: f.venueId === ALL_VENUES ? undefined : f.venueId,
      }),
  });
  const head = [
    t('reports.day'),
    t('reports.tickets'),
    ...REACH.map((k) => t(`common:alertLevel.${k}`)),
    t('today.reachPct'),
    t('today.ackPct'),
    t('reports.prep'),
    t('reports.prepP90'),
    t('reports.pickup'),
    t('reports.pickupP90'),
    t('reports.uncollected'),
  ];
  return (
    <QueryView q={q} skeleton="table">
      {(r) =>
        r.days.length === 0 ? (
          <EmptyState title={t('reports.emptyTitle')}>{t('reports.empty')}</EmptyState>
        ) : (
          <>
            {f.counterId && <p className="mb-3 text-sm text-muted">{t('reports.dailyNoCounter')}</p>}
            <Section title={t('reports.chartTitle')} description={t('reports.wordingNote')}>
              <ReachChart r={r} />
            </Section>
            <Section title={t('reports.tableTitle')} description={t('reports.prepNote')}>
              <Table caption={t('reports.tableTitle')} head={head}>
                {r.days.map((d) => (
                  <Row key={d.date} label={d.date} s={d} />
                ))}
                <Row label={t('reports.total')} s={r.total} />
              </Table>
            </Section>
          </>
        )
      }
    </QueryView>
  );
}

// ---------------------------------------------------------------- trends

type Metric = {
  key: keyof TrendSummary;
  label: string;
  format: (v: number | null) => string;
  unit: 'count' | 'pct' | 'sec' | 'stars';
  lowerIsBetter?: boolean;
};

function DeltaText({ cur, prev, m }: { cur: number | null; prev: number | null; m: Metric }) {
  const { t } = useTranslation();
  const d = delta(cur, prev);
  if (d.direction === 'none') return <span className="text-muted">{t('trends.noComparison')}</span>;
  if (d.direction === 'same') return <span className="text-muted">{t('trends.same')}</span>;
  const amount = Math.abs(d.diff ?? 0);
  const text = m.unit === 'pct' ? t('trends.points', { n: amount }) : m.unit === 'sec' ? formatDuration(amount) : String(amount);
  const better = m.lowerIsBetter ? d.direction === 'down' : d.direction === 'up';
  return (
    <span className={better ? 'text-ok' : 'text-danger'}>
      <span aria-hidden="true">{d.direction === 'up' ? '▲' : '▼'}</span> {d.direction === 'up' ? t('trends.up', { value: text }) : t('trends.down', { value: text })}
    </span>
  );
}

function Trends({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['trends', f],
    queryFn: () => api.get<TrendsReport>('/reports/trends', reportQuery(f)),
  });
  const metrics: Metric[] = [
    {
      key: 'tickets',
      label: t('trends.tickets'),
      format: (v) => (v === null ? '—' : String(v)),
      unit: 'count',
    },
    {
      key: 'reachPushOrLivePct',
      label: t('today.reachPct'),
      format: pct,
      unit: 'pct',
    },
    {
      key: 'acknowledgedPct',
      label: t('today.ackPct'),
      format: pct,
      unit: 'pct',
    },
    {
      key: 'repeatPct',
      label: t('trends.repeat'),
      format: pct,
      unit: 'pct',
      lowerIsBetter: true,
    },
    {
      key: 'undoPct',
      label: t('trends.undo'),
      format: pct,
      unit: 'pct',
      lowerIsBetter: true,
    },
    {
      key: 'prepSecondsP50',
      label: t('trends.prep'),
      format: formatDuration,
      unit: 'sec',
      lowerIsBetter: true,
    },
    {
      key: 'pickupSecondsP50',
      label: t('today.pickup'),
      format: formatDuration,
      unit: 'sec',
      lowerIsBetter: true,
    },
    {
      key: 'totalSecondsP50',
      label: t('trends.totalWait'),
      format: formatDuration,
      unit: 'sec',
      lowerIsBetter: true,
    },
    {
      key: 'cancelled',
      label: t('trends.cancelled'),
      format: (v) => (v === null ? '—' : String(v)),
      unit: 'count',
      lowerIsBetter: true,
    },
    {
      key: 'ratingAvg',
      label: t('trends.rating'),
      format: (v) => (v === null ? '—' : `${v} / 5`),
      unit: 'stars',
    },
  ];
  return (
    <QueryView q={q} skeleton="tiles">
      {(r) => {
        const cell = (m: Metric) => ({ cur: r.current[m.key] as number | null, prev: r.previous[m.key] as number | null });
        const lead = metrics.slice(0, 3);
        const rest = metrics.slice(3);
        return (
          <>
            <p className="mb-3 text-sm text-muted">{t('trends.comparedWith', { from: r.previous.from, to: r.previous.to })}</p>
            {/* The three headline numbers, large; the ticket count leads in ember. */}
            <Figures flat className="mb-6 grid-cols-1 sm:grid-cols-3">
              {lead.map((m, i) => {
                const { cur, prev } = cell(m);
                return (
                  <Stat
                    key={m.key}
                    lead={i === 0}
                    label={m.label}
                    value={m.format(cur)}
                    hint={
                      <span className="flex flex-col gap-0.5">
                        <DeltaText cur={cur} prev={prev} m={m} />
                        <span className="text-xs">{t('trends.previous', { value: m.format(prev) })}</span>
                      </span>
                    }
                  />
                );
              })}
            </Figures>
            <Section title={t('reports.secondaryTitle')} className="mb-6">
              <dl className="-my-2 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((m) => {
                  const { cur, prev } = cell(m);
                  return (
                    <div key={m.key} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
                      <div className="min-w-0">
                        <dt className="text-sm text-ink-2">{m.label}</dt>
                        <dd className="text-xs">
                          <DeltaText cur={cur} prev={prev} m={m} />
                        </dd>
                      </div>
                      <span className="num font-display text-xl font-extrabold tracking-tight whitespace-nowrap">{m.format(cur)}</span>
                    </div>
                  );
                })}
              </dl>
            </Section>
            <div className="grid items-start gap-6 xl:grid-cols-3">
              <Section title={t('trends.seriesTitle')} className="mb-0 xl:col-span-2">
                {r.series.length === 0 ? (
                  <p className="text-muted">{t('reports.empty')}</p>
                ) : (
                  <>
                    <div className="h-64" dir="ltr" role="img" aria-label={t('trends.seriesLabel')}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={r.series.map((s) => ({
                            date: s.date.slice(5),
                            collected: s.collected,
                            cancelled: s.cancelled,
                            uncollected: s.uncollected,
                          }))}
                          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                        >
                          <defs>
                            <pattern id="never-collected" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                              <rect width="6" height="6" fill="var(--color-danger-bg)" />
                              <rect width="2.5" height="6" fill="var(--color-danger)" />
                            </pattern>
                          </defs>
                          <CartesianGrid vertical={false} stroke="var(--color-line)" />
                          <XAxis dataKey="date" {...AXIS} />
                          <YAxis allowDecimals={false} {...AXIS} width={40} />
                          <Tooltip cursor={{ fill: 'var(--color-primary-wash)' }} />
                          <Legend />
                          <Bar dataKey="collected" stackId="day" name={t('trends.stackCollected')} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} />
                          <Bar dataKey="cancelled" stackId="day" name={t('trends.cancelled')} fill="var(--color-muted)" fillOpacity={0.55} stroke="var(--color-surface)" strokeWidth={2} />
                          <Bar dataKey="uncollected" stackId="day" name={t('trends.stackNever')} fill="url(#never-collected)" stroke="var(--color-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <details className="mt-3">
                      <summary className="inline-flex min-h-12 cursor-pointer items-center rounded-control px-2 font-semibold text-ink-2 hover:text-ink">{t('trends.showTable')}</summary>
                      <Table
                        caption={t('trends.seriesTitle')}
                        head={[t('reports.day'), t('trends.tickets'), t('today.reachPct'), t('today.ackPct'), t('trends.prep'), t('today.pickup'), t('trends.totalWait'), t('trends.cancelled'), t('trends.rating')]}
                      >
                        {r.series.map((s) => (
                          <tr key={s.date}>
                            <Td className="whitespace-nowrap">{s.date}</Td>
                            <Td className="num">{s.tickets}</Td>
                            <Td className="num">{pct(s.reachPushOrLivePct)}</Td>
                            <Td className="num">{pct(s.acknowledgedPct)}</Td>
                            <Td className="num">{formatDuration(s.prepSecondsP50)}</Td>
                            <Td className="num">{formatDuration(s.pickupSecondsP50)}</Td>
                            <Td className="num">{formatDuration(s.totalSecondsP50)}</Td>
                            <Td className="num">{s.cancelled}</Td>
                            <Td className="num">{s.ratingAvg ?? '—'}</Td>
                          </tr>
                        ))}
                      </Table>
                    </details>
                  </>
                )}
              </Section>
              <CancelReasons current={r.current} previous={r.previous} />
            </div>
            <aside className="mt-6 rounded-[var(--radius-card)] bg-canvas/60 px-5 py-4 text-sm text-muted">
              <h2 className="eyebrow mb-1">{t('reports.notesTitle')}</h2>
              {t('reports.prepNote')} {t('reports.wordingNote')}
            </aside>
          </>
        );
      }}
    </QueryView>
  );
}

/** Cancellations by reason for the range and the previous period (BRD §12.1, FR-RPT-02). */
function CancelReasons({ current, previous }: { current: TrendSummary; previous: TrendSummary }) {
  const { t } = useTranslation();
  const reasons = [...new Set([...Object.keys(current.cancelReasons ?? {}), ...Object.keys(previous.cancelReasons ?? {})])];
  return (
    <Section title={t('trends.cancelReasonsTitle')} description={t('trends.cancelReasonsHint', { n: current.cancelled })} className="mb-0">
      {current.cancelled === 0 && previous.cancelled === 0 ? (
        <p className="text-muted">{t('trends.noCancellations')}</p>
      ) : (
        <Table caption={t('trends.cancelReasonsTitle')} head={[t('trends.reason'), t('trends.thisPeriod'), t('trends.previousPeriod')]}>
          {reasons.map((k) => (
            <tr key={k}>
              <Td>{t(`trends.reasons.${k}`, { defaultValue: k })}</Td>
              <Td className="num">{current.cancelReasons?.[k] ?? 0}</Td>
              <Td className="num">{previous.cancelReasons?.[k] ?? 0}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- heatmap

function Heatmap({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['heatmap', f],
    queryFn: () => api.get<HeatmapReport>('/reports/heatmap', reportQuery(f)),
  });
  const day = (w: number) => t(`heatmap.days.${w}`);
  return (
    <QueryView q={q} skeleton="table">
      {(r) => {
        const rows = heatmapRows(r.grid);
        const max = heatmapMax(rows);
        if (max === 0) return <EmptyState title={t('reports.emptyTitle')}>{t('reports.empty')}</EmptyState>;
        const hours = activeHours(rows);
        let peak = { weekday: rows[0]!.weekday, hour: 0, n: 0 };
        for (const row of rows)
          row.cells.forEach((n, h) => {
            if (n > peak.n) peak = { weekday: row.weekday, hour: h, n };
          });
        return (
          <>
            <Section title={t('heatmap.title')} description={t('heatmap.hint')}>
              <div className="overflow-x-auto" aria-hidden="true">
                <div
                  dir="ltr"
                  className="grid min-w-[44rem] gap-[2px]"
                  style={{
                    gridTemplateColumns: '5rem repeat(24, minmax(1.5rem, 1fr))',
                  }}
                >
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-center text-[10px] text-muted">
                      {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                    </div>
                  ))}
                  {rows.map((row) => (
                    <HeatRow key={row.weekday} label={day(row.weekday)} cells={row.cells} max={max} peakHour={row.weekday === peak.weekday ? peak.hour : -1} />
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted" aria-hidden="true">
                <span>{t('heatmap.fewer')}</span>
                {HEAT.slice(1).map((c) => (
                  <span key={c} className="inline-block size-4 rounded-sm" style={{ background: c }} />
                ))}
                <span>{t('heatmap.more')}</span>
              </div>
              <p className="mt-4 flex items-center gap-3 text-ink-2">
                <span aria-hidden="true" className="inline-block size-3.5 shrink-0 rounded-[4px] bg-ink ring-2 ring-primary ring-offset-2 ring-offset-surface" />
                {t('heatmap.peak', { day: day(peak.weekday), hour: hourLabel(peak.hour), n: peak.n })}
              </p>
            </Section>
            <Section title={t('heatmap.tableTitle')} description={t('heatmap.tableHint')}>
              <Table caption={t('heatmap.tableTitle')} head={[t('heatmap.day'), ...hours.map(hourLabel), t('reports.total')]}>
                {rows.map((row) => (
                  <tr key={row.weekday}>
                    <Td className="whitespace-nowrap font-medium">{day(row.weekday)}</Td>
                    {hours.map((h) => (
                      <Td key={h} className="num">
                        {row.cells[h]}
                      </Td>
                    ))}
                    <Td className="num font-semibold">{row.total}</Td>
                  </tr>
                ))}
              </Table>
            </Section>
          </>
        );
      }}
    </QueryView>
  );
}

function HeatRow({ label, cells, max, peakHour }: { label: string; cells: number[]; max: number; peakHour: number }): ReactNode {
  return (
    <>
      <div className="flex items-center pe-2 text-xs font-medium">{label}</div>
      {cells.map((v, h) => {
        const level = heatLevel(v, max);
        return (
          <div
            key={h}
            title={`${label} ${hourLabel(h)}: ${v}`}
            className={`h-7 rounded-[4px] border border-line/60 ${h === peakHour ? "ring-2 ring-primary ring-offset-1 ring-offset-surface" : ""}`}
            style={{
              background: level ? HEAT[level] : 'transparent',
              color: level >= 3 ? 'var(--color-surface)' : 'inherit',
            }}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- filters, CSV, page

function useCounters(venueId: string) {
  return useQuery({
    queryKey: ['counters', venueId],
    queryFn: async () => (await api.get<{ items: Counter[] }>(`/venues/${venueId}/counters`)).items.filter((c) => !c.archived),
    enabled: Boolean(venueId) && venueId !== ALL_VENUES,
  });
}

/** CSV export (Pro, FR-RPT-04): fetched first so plan errors show as text, then saved as a file. */
function CsvButton({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const dl = useMutation({
    mutationFn: async () => {
      const blob = await api.get<Blob>('/reports/export.csv', csvQuery(f));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${f.from}-${f.to}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" busy={dl.isPending} onClick={() => dl.mutate()} title={t('reports.csvHint')}>
        <span aria-hidden="true">↓</span>
        {t('reports.csv')}
      </Button>
      <ErrorNote error={dl.error} />
      <LiveRegion text={dl.isSuccess ? t('reports.csvReady') : ''} />
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const isOwner = useRole() === 'owner';
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'trends';
  const current = useCurrentVenueId();
  const venues = useVenues().data ?? [];
  const initial = (): ReportFilter => ({
    venueId: current ?? ALL_VENUES,
    counterId: '',
    from: isoDate(new Date(Date.now() - 13 * 86_400_000)),
    to: isoDate(new Date()),
  });
  const [draft, setDraft] = useState<ReportFilter>(initial);
  const [filter, setFilter] = useState<ReportFilter>(initial);
  // On a cold load the venue is still unknown, so both filters start at "all venues". Once it resolves, an
  // untouched venue choice follows it (so the sole venue's counters can be chosen); a deliberate choice stays (AS07).
  const venueTouched = useRef(false);
  useEffect(() => {
    if (!current || venueTouched.current) return;
    setDraft((d) => (d.venueId === ALL_VENUES ? { ...d, venueId: current, counterId: '' } : d));
    setFilter((f) => (f.venueId === ALL_VENUES ? { ...f, venueId: current, counterId: '' } : f));
  }, [current]);
  const counters = useCounters(draft.venueId).data ?? [];
  const venueOptions = [...(venues.length > 1 ? [{ value: ALL_VENUES, label: t('reports.allVenues') }] : []), ...venues.map((v) => ({ value: v.id, label: v.name }))];
  const presets = [7, 14, 30] as const;
  const rangeFor = (days: number) => ({ from: isoDate(new Date(Date.now() - (days - 1) * 86_400_000)), to: isoDate(new Date()) });
  const activePreset = presets.find((n) => {
    const r = rangeFor(n);
    return filter.from === r.from && filter.to === r.to;
  });
  const pickPreset = (n: number) => {
    const r = rangeFor(n);
    setDraft((d) => ({ ...d, ...r }));
    setFilter((f) => ({ ...f, ...r }));
  };
  return (
    <Page title={t('reports.title')} description={t('reports.description')} tabs={<SubNav group="insights" />} actions={<CsvButton f={filter} />}>
      <section aria-label={t('reports.filters')} className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('reports.quickRange')}>
          {presets.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={activePreset === n}
              onClick={() => pickPreset(n)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors ${activePreset === n ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:border-ink-2 hover:text-ink'}`}
            >
              {t(`reports.last${n}`)}
            </button>
          ))}
        </div>
        {/* Phones: filters grow to fill the rows they wrap onto; from sm they sit side by side at their natural width. */}
        <form
          className="flex flex-wrap items-end gap-3 *:grow sm:*:grow-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from && draft.to && draft.from <= draft.to) setFilter(draft);
          }}
        >
          {venueOptions.length > 1 && (
            <Select
              className="min-w-48"
              label={t('reports.venue')}
              value={draft.venueId}
              options={venueOptions}
              onChange={(e) => {
                venueTouched.current = true;
                setDraft((d) => ({
                  ...d,
                  venueId: e.target.value,
                  counterId: '',
                }));
              }}
            />
          )}
          {draft.venueId !== ALL_VENUES && counters.length > 0 && (
            <Select
              className="min-w-40"
              label={t('reports.counter')}
              value={draft.counterId}
              options={[{ value: '', label: t('reports.allCounters') }, ...counters.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(e) => setDraft((d) => ({ ...d, counterId: e.target.value }))}
            />
          )}
          <Field label={t('reports.from')} type="date" dir="ltr" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <Field label={t('reports.to')} type="date" dir="ltr" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          <Button type="submit" variant="ink">
            {t('reports.show')}
          </Button>
        </form>
      </section>
      <Tabs label={t('reports.tabsLabel')} tabs={TABS} value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} idPrefix="r" labelOf={(k) => t(`reports.tabs.${k}`)} />
      <div className="mb-8 [&>section]:mb-8 [&>section:last-child]:mb-0" role="tabpanel" id={`rpanel-${tab}`} aria-labelledby={`rtab-${tab}`}>
        {tab === 'trends' && <Trends f={filter} />}
        {tab === 'heatmap' && <Heatmap f={filter} />}
        {tab === 'daily' && <Daily f={filter} />}
      </div>
      {isOwner && (
        <Section title={t('settings.exportTitle')}>
          <DataExport />
        </Section>
      )}
    </Page>
  );
}

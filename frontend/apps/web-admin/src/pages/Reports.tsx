import { useTranslation } from '@dop/i18n';
import { Button, Field, LiveRegion, Select } from '@dop/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorNote, QueryView, Section, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { formatDuration, isoDate, pct } from '../lib/format';
import { ALL_VENUES, activeHours, csvQuery, delta, heatLevel, heatmapMax, heatmapRows, hourLabel, reportQuery, type ReportFilter } from '../lib/reports';
import type { Counter, HeatmapReport, PilotReport, PilotSummary, TrendSummary, TrendsReport } from '../lib/types';
import { useCurrentVenueId, useVenues } from '../lib/venue';

// Reports (FR-RPT-02/03/04/10): trends against the previous period, weekday × hour heatmap, the per-day pilot table
// and CSV export (Pro). Filters: venue (or all venues, TR-FE-26), counter, date range. Wording never says a customer
// "heard" an alert (FR-ALR-11).

const REACH = ['push', 'live', 'closed', 'none'] as const;
// Categorical slots 1–4 of the validated chart palette, fixed order (identity also given by legend + table).
const COLORS: Record<(typeof REACH)[number], string> = { push: '#2a78d6', live: '#eb6834', closed: '#1baf7a', none: '#eda100' };
// Sequential blue ramp (steps 100, 250, 400, 550, 700) for heatmap levels 1–5; level 0 stays the surface.
const HEAT = ['', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] as const;
const TABS = ['trends', 'heatmap', 'daily'] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- pilot (per day)

function Row({ label, s }: { label: string; s: PilotSummary }) {
  return (
    <tr>
      <Td className="whitespace-nowrap font-medium">{label}</Td>
      <Td className="num">{s.tickets}</Td>
      {REACH.map((k) => (
        <Td key={k} className="num">
          {s.alertReach[k]}
        </Td>
      ))}
      <Td className="num">{pct(s.reachPushOrLivePct)}</Td>
      <Td className="num">{pct(s.acknowledgedPct)}</Td>
      <Td className="num">{formatDuration(s.prepSecondsP50)}</Td>
      <Td className="num">{formatDuration(s.pickupSecondsP50)}</Td>
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
          <CartesianGrid vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fill: '#4b5563', fontSize: 12 }} stroke="#d1d5db" />
          <YAxis allowDecimals={false} tick={{ fill: '#4b5563', fontSize: 12 }} stroke="#d1d5db" width={40} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
          <Legend />
          {REACH.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="reach" name={t(`common:alertLevel.${k}`)} fill={COLORS[k]} stroke="#ffffff" strokeWidth={2} radius={i === REACH.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Daily({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['pilot', f.venueId, f.from, f.to], queryFn: () => api.get<PilotReport>('/reports/pilot', { from: f.from, to: f.to, venueId: f.venueId === ALL_VENUES ? undefined : f.venueId }) });
  const head = [t('reports.day'), t('reports.tickets'), ...REACH.map((k) => t(`common:alertLevel.${k}`)), t('today.reachPct'), t('today.ackPct'), t('reports.prep'), t('reports.pickup'), t('reports.uncollected')];
  return (
    <QueryView q={q}>
      {(r) =>
        r.days.length === 0 ? (
          <p className="text-muted">{t('reports.empty')}</p>
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

type Metric = { key: keyof TrendSummary; label: string; format: (v: number | null) => string; unit: 'count' | 'pct' | 'sec' | 'stars'; lowerIsBetter?: boolean };

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
  const q = useQuery({ queryKey: ['trends', f], queryFn: () => api.get<TrendsReport>('/reports/trends', reportQuery(f)) });
  const metrics: Metric[] = [
    { key: 'tickets', label: t('trends.tickets'), format: (v) => (v === null ? '—' : String(v)), unit: 'count' },
    { key: 'reachPushOrLivePct', label: t('today.reachPct'), format: pct, unit: 'pct' },
    { key: 'acknowledgedPct', label: t('today.ackPct'), format: pct, unit: 'pct' },
    { key: 'repeatPct', label: t('trends.repeat'), format: pct, unit: 'pct', lowerIsBetter: true },
    { key: 'undoPct', label: t('trends.undo'), format: pct, unit: 'pct', lowerIsBetter: true },
    { key: 'prepSecondsP50', label: t('trends.prep'), format: formatDuration, unit: 'sec', lowerIsBetter: true },
    { key: 'pickupSecondsP50', label: t('today.pickup'), format: formatDuration, unit: 'sec', lowerIsBetter: true },
    { key: 'ratingAvg', label: t('trends.rating'), format: (v) => (v === null ? '—' : `${v} / 5`), unit: 'stars' },
  ];
  return (
    <QueryView q={q}>
      {(r) => (
        <>
          <Section title={t('trends.title')} description={t('trends.comparedWith', { from: r.previous.from, to: r.previous.to })}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map((m) => {
                const cur = r.current[m.key] as number | null;
                const prev = r.previous[m.key] as number | null;
                return (
                  <div key={m.key} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                    <div className="text-sm text-muted">{m.label}</div>
                    <div className="num mt-1 text-start text-3xl font-bold">{m.format(cur)}</div>
                    <div className="mt-1 text-sm">
                      <DeltaText cur={cur} prev={prev} m={m} />
                    </div>
                    <div className="mt-1 text-xs text-muted">{t('trends.previous', { value: m.format(prev) })}</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-muted">
              {t('reports.prepNote')} {t('reports.wordingNote')}
            </p>
          </Section>
          <Section title={t('trends.seriesTitle')}>
            {r.series.length === 0 ? (
              <p className="text-muted">{t('reports.empty')}</p>
            ) : (
              <>
                <div className="h-64" dir="ltr" role="img" aria-label={t('trends.seriesLabel')}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={r.series.map((s) => ({ date: s.date.slice(5), tickets: s.tickets }))} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fill: '#4b5563', fontSize: 12 }} stroke="#d1d5db" />
                      <YAxis allowDecimals={false} tick={{ fill: '#4b5563', fontSize: 12 }} stroke="#d1d5db" width={40} />
                      <Tooltip cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                      <Bar dataKey="tickets" name={t('trends.tickets')} fill="#2a78d6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <details className="mt-3">
                  <summary className="inline-flex min-h-12 cursor-pointer items-center font-medium">{t('trends.showTable')}</summary>
                  <Table caption={t('trends.seriesTitle')} head={[t('reports.day'), t('trends.tickets'), t('today.reachPct'), t('today.ackPct'), t('trends.prep'), t('today.pickup'), t('trends.rating')]}>
                    {r.series.map((s) => (
                      <tr key={s.date}>
                        <Td className="whitespace-nowrap">{s.date}</Td>
                        <Td className="num">{s.tickets}</Td>
                        <Td className="num">{pct(s.reachPushOrLivePct)}</Td>
                        <Td className="num">{pct(s.acknowledgedPct)}</Td>
                        <Td className="num">{formatDuration(s.prepSecondsP50)}</Td>
                        <Td className="num">{formatDuration(s.pickupSecondsP50)}</Td>
                        <Td className="num">{s.ratingAvg ?? '—'}</Td>
                      </tr>
                    ))}
                  </Table>
                </details>
              </>
            )}
          </Section>
        </>
      )}
    </QueryView>
  );
}

// ---------------------------------------------------------------- heatmap

function Heatmap({ f }: { f: ReportFilter }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['heatmap', f], queryFn: () => api.get<HeatmapReport>('/reports/heatmap', reportQuery(f)) });
  const day = (w: number) => t(`heatmap.days.${w}`);
  return (
    <QueryView q={q}>
      {(r) => {
        const rows = heatmapRows(r.grid);
        const max = heatmapMax(rows);
        if (max === 0) return <p className="text-muted">{t('reports.empty')}</p>;
        const hours = activeHours(rows);
        return (
          <>
            <Section title={t('heatmap.title')} description={t('heatmap.hint')}>
              <div className="overflow-x-auto" aria-hidden="true">
                <div dir="ltr" className="grid min-w-[44rem] gap-[2px]" style={{ gridTemplateColumns: '5rem repeat(24, minmax(1.5rem, 1fr))' }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-center text-[10px] text-muted">
                      {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                    </div>
                  ))}
                  {rows.map((row) => (
                    <HeatRow key={row.weekday} label={day(row.weekday)} cells={row.cells} max={max} />
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

function HeatRow({ label, cells, max }: { label: string; cells: number[]; max: number }): ReactNode {
  return (
    <>
      <div className="flex items-center pe-2 text-xs font-medium">{label}</div>
      {cells.map((v, h) => {
        const level = heatLevel(v, max);
        return (
          <div
            key={h}
            title={`${label} ${hourLabel(h)}: ${v}`}
            className="h-7 rounded-sm border border-line/40"
            style={{ background: level ? HEAT[level] : 'transparent', color: level >= 3 ? '#ffffff' : 'inherit' }}
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
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="secondary" busy={dl.isPending} onClick={() => dl.mutate()}>
          {t('reports.csv')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('reports.csvHint')}</p>
      <ErrorNote error={dl.error} />
      <LiveRegion text={dl.isSuccess ? t('reports.csvReady') : ''} />
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'trends';
  const current = useCurrentVenueId();
  const venues = useVenues().data ?? [];
  const initial = (): ReportFilter => ({ venueId: current ?? ALL_VENUES, counterId: '', from: isoDate(new Date(Date.now() - 13 * 86_400_000)), to: isoDate(new Date()) });
  const [draft, setDraft] = useState<ReportFilter>(initial);
  const [filter, setFilter] = useState<ReportFilter>(initial);
  const counters = useCounters(draft.venueId).data ?? [];
  const venueOptions = [...(venues.length > 1 ? [{ value: ALL_VENUES, label: t('reports.allVenues') }] : []), ...venues.map((v) => ({ value: v.id, label: v.name }))];

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('reports.title')}</h1>
      <Section title={t('reports.filters')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from && draft.to && draft.from <= draft.to) setFilter(draft);
          }}
        >
          {venueOptions.length > 1 && <Select label={t('reports.venue')} value={draft.venueId} options={venueOptions} onChange={(e) => setDraft((d) => ({ ...d, venueId: e.target.value, counterId: '' }))} />}
          {draft.venueId !== ALL_VENUES && counters.length > 0 && (
            <Select
              label={t('reports.counter')}
              value={draft.counterId}
              options={[{ value: '', label: t('reports.allCounters') }, ...counters.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(e) => setDraft((d) => ({ ...d, counterId: e.target.value }))}
            />
          )}
          <Field label={t('reports.from')} type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <Field label={t('reports.to')} type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          <Button type="submit">{t('reports.show')}</Button>
        </form>
        <div className="mt-4">
          <CsvButton f={filter} />
        </div>
      </Section>
      <div role="tablist" aria-label={t('reports.tabsLabel')} className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            id={`rtab-${k}`}
            aria-selected={tab === k}
            aria-controls={`rpanel-${k}`}
            onClick={() => setParams({ tab: k }, { replace: true })}
            className={`min-h-12 border-b-4 px-4 font-medium ${tab === k ? 'border-primary text-primary' : 'border-transparent'}`}
          >
            {t(`reports.tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`rpanel-${tab}`} aria-labelledby={`rtab-${tab}`}>
        {tab === 'trends' && <Trends f={filter} />}
        {tab === 'heatmap' && <Heatmap f={filter} />}
        {tab === 'daily' && <Daily f={filter} />}
      </div>
    </>
  );
}

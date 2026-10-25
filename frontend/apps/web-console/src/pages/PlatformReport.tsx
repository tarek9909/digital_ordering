import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, EmptyState, Field, Select, Skeleton, Stat } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorNote, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { minorToMajor } from '../lib/money';
import { keysOf, normalizeDay, type PlatformDay } from '../lib/platformReport';
import type { DeliveryHealth, PlatformCohort, PlatformReportResponse } from '../lib/types';

// Platform report (FR-RPT-07, TR-RPT-06): daily rollups of tenants by status and plan, signups, conversions,
// cancellations, MRR per currency and tickets. Lazy-loaded with recharts (TR-FE-05).

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function PlatformReportBody() {
  const { t } = useTranslation();
  const [range, setRange] = useState(() => ({ from: isoDay(new Date(Date.now() - 29 * 86_400_000)), to: isoDay(new Date()) }));
  const [query, setQuery] = useState(range);
  const q = useQuery({ queryKey: ['platform-report', query], queryFn: () => api.get<PlatformReportResponse>('/reports/platform', query) });
  const invalid = !range.from || !range.to || range.to < range.from;
  const run = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) setQuery(range);
  };

  const setPreset = (days: number) => {
    const next = { from: isoDay(new Date(Date.now() - (days - 1) * 86_400_000)), to: isoDay(new Date()) };
    setRange(next);
    setQuery(next);
  };

  return (
    <>
      <Card className="mb-6 border border-line/80 bg-surface shadow-xs">
        <form onSubmit={run} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <Field label={t('pilot.from')} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Field label={t('pilot.to')} type="date" value={range.to} error={invalid ? t('pilot.rangeInvalid') : undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <Button type="submit" disabled={invalid}>
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {t('pilot.run')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">{t('pilotUx.quickRange')}</span>
            {[7, 14, 30, 90].map((n) => (
              <button
                key={n}
                type="button"
                className="inline-flex min-h-8 items-center rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line transition-all hover:bg-surface hover:text-ink hover:ring-line-hover"
                onClick={() => setPreset(n)}
              >
                {t('pilotUx.lastDays', { count: n })}
              </button>
            ))}
          </div>
        </form>
      </Card>
      <ErrorNote error={q.error} />
      {q.isFetching && !q.data && <ReportSkeleton label={t('common:loading')} />}
      {q.data && <Results data={q.data} />}
    </>
  );
}

function Results({ data }: { data: PlatformReportResponse }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const days = data.days.map(normalizeDay);
  const statuses = keysOf(days, 'byStatus');
  const plans = keysOf(days, 'byPlan');
  const currencies = keysOf(days, 'mrr');
  const sum = (f: 'signups' | 'conversions' | 'cancellations' | 'tickets') => days.reduce((a, d) => a + d[f], 0);

  if (days.length === 0) return <EmptyState title={t('platformReport.empty')}>{t('platformReport.emptyHint')}</EmptyState>;
  // The one ember tile: revenue on the last day of the range, in the first currency.
  const mrrCurrency = currencies[0];
  const lastDay = days[days.length - 1]!;
  return (
    <div className="flex flex-col gap-6">
      {/* KPI Overview Tiles */}
      <div data-motion="stagger" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {mrrCurrency && (
          <div className="col-span-2 rounded-xl border border-primary/40 bg-primary/[0.04] p-4 shadow-xs ring-1 ring-primary/20 xl:col-span-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              {t('platformReport.mrrNow', { currency: mrrCurrency })}
            </span>
            <span className="mt-1 block font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {formatMoney(lastDay.mrr[mrrCurrency] ?? 0, mrrCurrency, 'en')}
            </span>
          </div>
        )}
        <Stat label={t('platformReport.churn')} value={pct(data.churnPct)} />
        <Stat label={t('platformReport.activeAtStart')} value={String(data.activeAtStart ?? 0)} />
        <Stat label={t('platformReport.signups')} value={String(sum('signups'))} />
        <Stat label={t('platformReport.conversions')} value={String(sum('conversions'))} />
        <Stat label={t('platformReport.cancellations')} value={String(sum('cancellations'))} />
        <Stat label={t('platformReport.tickets')} value={String(sum('tickets'))} />
      </div>
      <div className="grid gap-6 xl:grid-cols-5 xl:items-start">
        <div className="flex min-w-0 flex-col gap-2 xl:col-span-3">
          <Table
            className="max-h-[32rem] overflow-y-auto rounded-xl border border-line bg-surface shadow-xs"
            caption={t('platformReport.daily')}
            head={[
              t('platformReport.date'),
              ...statuses.map((s) => t(`tenantStatus.${s}`, { defaultValue: s })),
              ...plans.map((p) => t(`plan.${p}`, { defaultValue: p })),
              t('platformReport.signups'),
              t('platformReport.conversions'),
              t('platformReport.cancellations'),
              ...currencies.map((c) => t('platformReport.mrrIn', { currency: c })),
              t('platformReport.tickets'),
            ]}
          >
            {days.map((d) => (
              <tr key={d.date} className="hover:bg-canvas/40">
                <Td className="whitespace-nowrap">
                  <span dir="ltr" className="rounded-md bg-canvas px-2 py-0.5 font-mono text-xs font-semibold text-ink ring-1 ring-line">
                    {d.date}
                  </span>
                </Td>
                {statuses.map((s) => (
                  <Td key={`s-${s}`} className="num font-medium">
                    {d.byStatus[s] ?? 0}
                  </Td>
                ))}
                {plans.map((p) => (
                  <Td key={`p-${p}`} className="num font-medium">
                    {d.byPlan[p] ?? 0}
                  </Td>
                ))}
                <Td className="num font-medium text-ok">{d.signups}</Td>
                <Td className="num font-medium text-primary">{d.conversions}</Td>
                <Td className="num font-medium text-danger">{d.cancellations}</Td>
                {currencies.map((c) => (
                  <Td key={`m-${c}`} className="num font-mono font-medium">
                    {formatMoney(d.mrr[c] ?? 0, c, l)}
                  </Td>
                ))}
                <Td className="num font-medium">{d.tickets}</Td>
              </tr>
            ))}
          </Table>
          <p className="px-1 text-xs text-muted">{t('platformReport.groupsNote')}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <MrrChart days={days} currencies={currencies} />
          <Cohorts cohorts={data.cohorts ?? []} />
          <Delivery health={data.deliveryHealth} />
          <ReachByPhone reach={data.reachByUa ?? {}} />
        </div>
      </div>
    </div>
  );
}

// Smaller tiles so a row of figures takes one line instead of a screen.
const COMPACT = '*:min-w-0 *:break-words [&>div]:!gap-1 [&>div]:!p-3 [&>div>span:nth-child(2)]:!text-2xl';

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Sign-up cohorts by month: how many of each month's trial sign-ups converted to paid (FR-RPT-07, W09). */
export function Cohorts({ cohorts }: { cohorts: PlatformCohort[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="cohort-h" className="flex flex-col gap-2">
      <h2 id="cohort-h" className="text-lg font-bold">
        {t('platformReport.cohorts')}
      </h2>
      {cohorts.length === 0 ? (
        <p className="text-muted">{t('platformReport.cohortsEmpty')}</p>
      ) : (
        <Table
          caption={t('platformReport.cohortsCaption')}
          head={[t('platformReport.cohortMonth'), t('platformReport.signups'), t('platformReport.converted'), t('platformReport.complimentary'), t('platformReport.conversionPct')]}
        >
          {cohorts.map((c) => (
            <tr key={c.month}>
              <Td>
                <span dir="ltr">{c.month}</span>
              </Td>
              <Td className="num">{c.signups}</Td>
              <Td className="num">{c.converted}</Td>
              <Td className="num">{c.complimentary}</Td>
              <Td className="num">{pct(c.conversionPct)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-sm text-muted">{t('platformReport.cohortsNote')}</p>
    </section>
  );
}

/** Push and webhook delivery over the range (BRD §12.2, W09). */
export function Delivery({ health }: { health: DeliveryHealth | undefined }) {
  const { t } = useTranslation();
  const h = health ?? { pushSent: 0, pushFailures: 0, pushFailurePct: null, webhookFailures: 0 };
  return (
    <section aria-labelledby="delivery-h" className="flex flex-col gap-2">
      <h2 id="delivery-h" className="text-lg font-bold">
        {t('platformReport.deliveryHealth')}
      </h2>
      <Table caption={t('platformReport.deliveryCaption')} head={[t('platformReport.measure'), t('platformReport.value')]}>
        <tr>
          <RowHead>{t('platformReport.pushSent')}</RowHead>
          <Td className="num">{h.pushSent}</Td>
        </tr>
        <tr>
          <RowHead>{t('platformReport.pushFailures')}</RowHead>
          <Td className="num">{h.pushFailures}</Td>
        </tr>
        <tr>
          <RowHead>{t('platformReport.pushFailurePct')}</RowHead>
          <Td className="num">{pct(h.pushFailurePct)}</Td>
        </tr>
        <tr>
          <RowHead>{t('platformReport.webhookFailures')}</RowHead>
          <Td className="num">{h.webhookFailures}</Td>
        </tr>
      </Table>
    </section>
  );
}

const REACH_LEVELS = ['push', 'live', 'closed', 'none'] as const;

/** Alert reach by phone type (BRD §12.2, FR-RPT-07): alert level when marked Ready, per OS/browser family. */
export function ReachByPhone({ reach }: { reach: Record<string, Record<string, number>> }) {
  const { t } = useTranslation();
  const rows = Object.entries(reach)
    .map(([ua, levels]) => ({ ua, levels, total: REACH_LEVELS.reduce((a, l) => a + (levels[l] ?? 0), 0) }))
    .sort((a, b) => b.total - a.total || a.ua.localeCompare(b.ua));
  return (
    <section aria-labelledby="reach-ua-h" className="flex flex-col gap-2">
      <h2 id="reach-ua-h" className="text-lg font-bold">
        {t('platformReport.reachByUa')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted">{t('platformReport.reachByUaEmpty')}</p>
      ) : (
        <Table caption={t('platformReport.reachByUaCaption')} head={[t('platformReport.phoneType'), ...REACH_LEVELS.map((l) => t(`reach.${l}`)), t('platformReport.reachPct')]}>
          {rows.map((r) => (
            <tr key={r.ua}>
              <Td>{t(`platformReport.ua.${r.ua}`, { defaultValue: r.ua })}</Td>
              {REACH_LEVELS.map((l) => (
                <Td key={l} className="num">
                  {r.levels[l] ?? 0}
                </Td>
              ))}
              <Td className="num">{pct(r.total ? Math.round((((r.levels.push ?? 0) + (r.levels.live ?? 0)) / r.total) * 100) : null)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-sm text-muted">{t('platformReport.reachByUaNote')}</p>
    </section>
  );
}

const RowHead = ({ children }: { children: string }) => (
  <th scope="row" className="border-t border-line px-4 py-2.5 text-start font-medium">
    {children}
  </th>
);

/** Placeholder for the figures and the daily table while the first report loads. */
export function ReportSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-[var(--radius-card)]" />
    </div>
  );
}

function MrrChart({ days, currencies }: { days: PlatformDay[]; currencies: string[] }) {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState(currencies[0] ?? '');
  const metric = currency ? 'mrr' : 'signups';
  const points = days.map((d) => ({ date: d.date, value: metric === 'mrr' ? Number(minorToMajor(d.mrr[currency] ?? 0)) : d.signups }));
  const title = metric === 'mrr' ? t('platformReport.mrrChart', { currency }) : t('platformReport.signupsChart');
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {currencies.length > 1 && <Select label={t('platformReport.currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />}
      </div>
      <div className="h-44" dir="ltr" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-muted)' }} stroke="var(--color-line)" tickLine={false} />
            <YAxis allowDecimals={metric === 'mrr'} tick={{ fontSize: 12, fill: 'var(--color-muted)' }} stroke="var(--color-line)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', boxShadow: 'var(--shadow-card)' }} />
            <Line type="monotone" dataKey="value" name={title} stroke="var(--color-ink)" strokeWidth={2.5} dot={days.length <= 31 ? { r: 3, fill: 'var(--color-surface)', strokeWidth: 2 } : false} activeDot={{ r: 5, fill: 'var(--color-ink)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

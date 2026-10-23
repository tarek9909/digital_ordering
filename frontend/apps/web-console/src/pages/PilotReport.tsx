import { useTranslation } from '@dop/i18n';
import { Button, Card, EmptyState, Field, PageShell, Stat } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Checkbox, ErrorNote, Table, TableSkeleton, Td } from '../components/common';
import { api } from '../lib/api';
import { fmtDuration, fmtPct } from '../lib/format';
import type { ConsolePilotItem, Paged, TenantRow } from '../lib/types';

// Pilot report across tenants (FR-RPT-10). Wording: push sent / page open / acknowledged — never "heard"
// (FR-ALR-11); preparation time is measured from ticket creation (TR-RPT-05).

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const REACH = ['push', 'live', 'closed', 'none'] as const;
const COLORS: Record<(typeof REACH)[number], string> = {
  push: 'var(--color-ok)',
  live: 'var(--color-info)',
  closed: 'var(--color-warn)',
  none: 'var(--color-muted)',
};

export function PilotReportPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [range, setRange] = useState(() => ({
    from: isoDay(new Date(Date.now() - 13 * 86_400_000)),
    to: isoDay(new Date()),
  }));
  const [query, setQuery] = useState<{
    ids: string[];
    from: string;
    to: string;
  } | null>(null);
  const report = useQuery({
    queryKey: ['pilot', query],
    enabled: query !== null,
    queryFn: () =>
      api.get<{ items: ConsolePilotItem[] }>('/reports/pilot', {
        tenantIds: query!.ids.join(','),
        from: query!.from,
        to: query!.to,
      }),
  });

  const run = (e: FormEvent) => {
    e.preventDefault();
    if (selected.size === 0 || range.to < range.from) return;
    setQuery({ ids: [...selected.keys()], ...range });
  };

  return (
    <PageShell wide eyebrow={t('layout.groups.insights')} title={t('pilot.title')} description={t('pilot.description')}>
      <Card className="mb-6">
        <form onSubmit={run} className="flex flex-col gap-4" noValidate>
          <TenantPicker selected={selected} onChange={setSelected} />
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <Field label={t('pilot.from')} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Field
              label={t('pilot.to')}
              type="date"
              value={range.to}
              error={range.to < range.from ? t('pilot.rangeInvalid') : undefined}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
            <Button type="submit" disabled={selected.size === 0}>
              {t('pilot.run')}
            </Button>
          </div>
        </form>
      </Card>
      <ErrorNote error={report.error} />
      {report.isFetching && !report.data && <TableSkeleton label={t('common:loading')} rows={3} />}
      {report.data && <Results items={report.data.items} />}
      {query === null && <EmptyState title={t('pilot.pickTenantsTitle')}>{t('pilot.pickTenants')}</EmptyState>}
    </PageShell>
  );
}

function TenantPicker({ selected, onChange }: { selected: Map<string, string>; onChange: (m: Map<string, string>) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const list = useQuery({
    queryKey: ['tenants', 'picker', term],
    queryFn: () => api.get<Paged<TenantRow>>('/tenants', { q: term, limit: 20 }),
  });
  const toggle = (id: string, name: string, on: boolean) => {
    const m = new Map(selected);
    if (on) m.set(id, name);
    else m.delete(id);
    onChange(m);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">{t('pilot.tenants', { count: selected.size })}</legend>
      <div className="flex items-end gap-2">
        <Field label={t('tenants.search')} type="search" className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="secondary" onClick={() => setTerm(q)}>
          {t('pilot.find')}
        </Button>
      </div>
      <ErrorNote error={list.error} />
      <div className="grid max-h-64 gap-1 overflow-auto sm:grid-cols-2">
        {[...selected].map(([id, name]) => (
          <Checkbox key={id} label={name} checked onChange={() => toggle(id, name, false)} />
        ))}
        {list.data?.items
          .filter((r) => !selected.has(r.id))
          .map((r) => (
            <Checkbox key={r.id} label={`${r.name} (${r.slug})`} checked={false} onChange={(e) => toggle(r.id, r.name, e.target.checked)} />
          ))}
      </div>
    </fieldset>
  );
}

export function Results({ items }: { items: ConsolePilotItem[] }) {
  const { t } = useTranslation();
  const chart = items.map((i) => ({
    name: i.tenant.name,
    ...i.report.total.alertReach,
  }));
  // Combined figures for the selected restaurants: counts add up; reach is recomputed from the summed channels.
  const sum = (f: (s: ConsolePilotItem['report']['total']) => number) => items.reduce((a, i) => a + f(i.report.total), 0);
  const reachAll = sum((s) => REACH.reduce((a, k) => a + (s.alertReach[k] ?? 0), 0));
  const reachOk = sum((s) => (s.alertReach.push ?? 0) + (s.alertReach.live ?? 0));
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('pilot.summary')} data-motion="stagger" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat accent label={t('pilot.reachPct')} value={fmtPct(reachAll ? Math.round((reachOk / reachAll) * 1000) / 10 : null)} hint={t('pilot.summary')} />
        <Stat label={t('pilot.tickets')} value={String(sum((s) => s.tickets))} />
        <Stat label={t('pilot.ready')} value={String(sum((s) => s.readyTickets))} />
        <Stat label={t('pilot.uncollected')} value={String(sum((s) => s.uncollected))} />
      </section>
      <Table
        caption={t('pilot.title')}
        head={[
          t('pilot.tenant'),
          t('pilot.tickets'),
          t('pilot.ready'),
          t('pilot.reachPct'),
          t('pilot.acknowledgedPct'),
          t('pilot.prepP50'),
          t('pilot.prepP90'),
          t('pilot.pickupP50'),
          t('pilot.pickupP90'),
          t('pilot.uncollected'),
          t('pilot.undoPct'),
        ]}
      >
        {items.map(({ tenant, report: { total: s } }) => (
          <tr key={tenant.id}>
            <Td className="font-semibold whitespace-nowrap">{tenant.name}</Td>
            <Td className="num">{s.tickets}</Td>
            <Td className="num">{s.readyTickets}</Td>
            <Td className="num">{fmtPct(s.reachPushOrLivePct)}</Td>
            <Td className="num">{fmtPct(s.acknowledgedPct)}</Td>
            <Td className="num">{fmtDuration(s.prepSecondsP50)}</Td>
            <Td className="num">{fmtDuration(s.prepSecondsP90)}</Td>
            <Td className="num">{fmtDuration(s.pickupSecondsP50)}</Td>
            <Td className="num">{fmtDuration(s.pickupSecondsP90)}</Td>
            <Td className="num">{s.uncollected}</Td>
            <Td className="num">{fmtPct(s.undoPct)}</Td>
          </tr>
        ))}
      </Table>
      <p className="text-sm text-muted">{t('pilot.prepNote')}</p>
      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('pilot.reachChart')}</h2>
        <p className="mb-3 text-sm text-muted">{t('pilot.reachChartNote')}</p>
        <div className="h-72" dir="ltr" role="img" aria-label={t('pilot.reachChart')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-muted)' }} stroke="var(--color-line)" tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--color-muted)' }} stroke="var(--color-line)" tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'var(--color-primary-wash)' }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid var(--color-line)',
                  boxShadow: 'var(--shadow-card)',
                }}
              />
              <Legend iconType="circle" />
              {REACH.map((k) => (
                <Bar key={k} dataKey={k} stackId="r" name={t(`reach.${k}`)} fill={COLORS[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

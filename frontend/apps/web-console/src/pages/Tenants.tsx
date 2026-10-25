import { PLAN_CODES, TENANT_STATUSES } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion, PageShell, Pill, Select } from '@dop/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { ErrorNote, Initials, PagerControls, StatusBadge, Table, TableSkeleton, Td } from '../components/common';
import { CreateTenantForm } from './CreateTenant';
import { api } from '../lib/api';
import { fmtDate, fmtDay } from '../lib/format';
import { useMe } from '../lib/me';
import { useCursorPager } from '../lib/pager';
import { can } from '../lib/roles';
import type { Paged, TenantRow } from '../lib/types';

// Tenants list (FR-SA-04, TR-FE-25): search, status and plan filters, cursor paging.

export interface PlanOption {
  code: string;
  name: string;
  archived: boolean;
}

export function usePlanOptions() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['plan-options'], queryFn: async () => (await api.get<{ items: PlanOption[] }>('/plan-options')).items, staleTime: 5 * 60_000 });
  const catalogue: PlanOption[] = q.data ?? PLAN_CODES.map((code) => ({ code, name: code, archived: false }));
  return catalogue.map((p) => {
    const name = t(`plan.${p.code}`, { defaultValue: p.name });
    return { value: p.code, label: p.archived ? t('tenants.planArchived', { name }) : name };
  });
}

/** One-click Activate / Deactivate for a row; a fresh MFA check is still asked when the session needs one. */
function StatusToggle({ row }: { row: TenantRow }) {
  const { t } = useTranslation();
  const run = useFreshMfa();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState('');
  const inactive = row.status === 'suspended';
  if (!inactive && !['trial', 'active', 'past_due'].includes(row.status)) return null;
  const go = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await run(() => (inactive ? api.post(`/tenants/${row.id}/reactivate`) : api.post(`/tenants/${row.id}/suspend`, { reason: t('tenantsUx.toggleReason', { defaultValue: 'Deactivated from the tenants list' }) })));
      setDone(t(inactive ? 'actions.reactivate.done' : 'actions.suspend.done'));
      await qc.invalidateQueries({ queryKey: ['tenants'] });
    } catch (e) {
      if (!(e instanceof MfaCancelled)) setFailed(true);
    }
    setBusy(false);
  };
  return (
    <span className="relative z-10 inline-flex flex-col items-start gap-1">
      <LiveRegion toast text={done} />
      <Button variant="secondary" size="md" busy={busy} onClick={() => void go()} className={inactive ? '' : 'text-danger border-danger/30 hover:bg-danger/10'}>
        {t(inactive ? 'actions.reactivate.button' : 'actions.suspend.button')}
      </Button>
      {failed && <span role="alert" className="text-xs text-danger">{t('common:error', { defaultValue: 'Something went wrong.' })}</span>}
    </span>
  );
}

const STATUS_FILTERS = ['', ...TENANT_STATUSES.filter((s) => s !== 'deleted')] as const;

export function TenantsPage() {
  const { t, i18n } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const canCreate = can(role, 'tenants.lifecycle');
  const creating = canCreate && params.has('new');
  const setCreating = (on: boolean) => setParams(on ? { new: '1' } : {}, { replace: true });
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', plan: '' });
  const pager = useCursorPager();
  const planOptions = usePlanOptions();
  const list = useQuery({
    queryKey: ['tenants', filters, pager.cursor],
    queryFn: () => api.get<Paged<TenantRow>>('/tenants', { ...filters, limit: 50, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
  });

  const apply = (next: Partial<typeof filters>) => {
    pager.reset();
    setFilters((f) => ({ ...f, ...next }));
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    apply({ q: q.trim() });
  };
  const filtered = Boolean(filters.q || filters.status || filters.plan);
  const clear = () => {
    setQ('');
    apply({ q: '', status: '', plan: '' });
  };

  const items = list.data?.items ?? [];
  const activeCount = items.filter((x) => x.status === 'active').length;
  const trialCount = items.filter((x) => x.status === 'trial').length;
  const totalTickets = items.reduce((acc, curr) => acc + (curr.ticketsThisMonth || 0), 0);

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.tenants')}
      title={t('tenants.title')}
      description={t('tenants.description')}
      actions={
        canCreate && (
          <Button
            variant={creating ? 'secondary' : 'primary'}
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
            className="shadow-button font-bold"
          >
            {creating ? t('common:cancel') : `+ ${t('nav.createTenant')}`}
          </Button>
        )
      }
    >
      {creating && (
        <section aria-label={t('create.title')} className="mb-8 rounded-2xl bg-surface p-6 shadow-card border border-line">
          <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
            <h2 className="font-display text-xl font-bold text-ink">{t('create.title')}</h2>
            <Button variant="ghost" size="md" onClick={() => setCreating(false)}>
              {t('common:cancel')}
            </Button>
          </div>
          <CreateTenantForm onCreated={(id) => void nav(`/tenants/${id}`)} />
        </section>
      )}

      {/* KPI Overview Strip */}
      {items.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-xl bg-surface p-4 shadow-card border border-line">
            <span className="eyebrow text-xs text-muted">{t('tenants.title')}</span>
            <span className="num font-display text-2xl sm:text-3xl font-extrabold text-ink">{items.length}</span>
            <span className="text-xs text-muted">on this page</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-surface p-4 shadow-card border border-line">
            <span className="eyebrow text-xs text-muted">{t('tenantStatus.active')}</span>
            <span className="num font-display text-2xl sm:text-3xl font-extrabold text-ok">{activeCount}</span>
            <span className="text-xs text-muted">venues live</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-surface p-4 shadow-card border border-line">
            <span className="eyebrow text-xs text-muted">{t('tenantStatus.trial')}</span>
            <span className="num font-display text-2xl sm:text-3xl font-extrabold text-info">{trialCount}</span>
            <span className="text-xs text-muted">in trial period</span>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-surface p-4 shadow-card border border-line">
            <span className="eyebrow text-xs text-muted">{t('tenants.ticketsMonth')}</span>
            <span className="num font-display text-2xl sm:text-3xl font-extrabold text-primary">{totalTickets}</span>
            <span className="text-xs text-muted">orders this month</span>
          </div>
        </div>
      )}

      {/* Command & Filter Bar */}
      <div className="mb-5 flex flex-col gap-4 rounded-2xl bg-surface p-4 sm:p-5 shadow-card border border-line">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <form role="search" onSubmit={search} className="flex flex-1 items-end gap-2">
            <div className="relative min-w-0 flex-1">
              <Field
                label={t('tenants.search')}
                type="search"
                className="w-full"
                placeholder={t('tenantsUx.searchPlaceholder')}
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Button type="submit" variant="ink" className="min-w-24 shrink-0 font-bold shadow-button">
              {t('tenantsUx.searchButton')}
            </Button>
          </form>
          <div className="lg:w-64">
            <Select
              label={t('tenants.plan')}
              value={filters.plan}
              onChange={(e) => apply({ plan: e.target.value })}
              options={[{ value: '', label: t('tenantsUx.allPlans') }, ...planOptions]}
            />
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/50" role="group" aria-label={t('tenants.status')}>
          {STATUS_FILTERS.map((s) => {
            const on = filters.status === s;
            return (
              <button
                key={s || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => apply({ status: s })}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs sm:text-sm font-semibold ring-1 transition-all duration-150 ${
                  on
                    ? 'bg-ink text-white ring-ink shadow-sm'
                    : 'bg-canvas text-ink-2 ring-line hover:bg-surface hover:text-ink'
                }`}
              >
                {on && <span className="size-1.5 rounded-full bg-glow" aria-hidden="true" />}
                {s ? t(`tenantStatus.${s}`) : t('tenantsUx.allStatuses')}
              </button>
            );
          })}
          {filtered && (
            <Button variant="ghost" size="md" className="ms-auto text-xs sm:text-sm font-bold text-muted hover:text-danger" onClick={clear}>
              ✕ {t('tenantsUx.clear')}
            </Button>
          )}
        </div>
      </div>

      <ErrorNote error={list.error} />
      {list.isPending ? (
        <TableSkeleton label={t('common:loading')} />
      ) : (
        list.data &&
        (list.data.items.length === 0 && !pager.canPrev ? (
          <EmptyState
            title={t('tenants.empty')}
            action={
              filtered ? (
                <Button variant="secondary" onClick={clear}>
                  {t('tenantsUx.clear')}
                </Button>
              ) : undefined
            }
          >
            {t('tenants.emptyHint')}
          </EmptyState>
        ) : (
          <>
            {/* Mobile Cards */}
            <ul aria-label={t('tenants.title')} className="flex flex-col gap-3 md:hidden">
              {list.data.items.length === 0 && <li className="text-muted p-4 bg-surface rounded-xl text-center">{t('tenants.empty')}</li>}
              {list.data.items.map((r) => (
                <li
                  key={r.id}
                  className="relative flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card border border-line transition-all hover:border-primary/40 has-[a:hover]:bg-primary-wash/50"
                >
                  <div className="flex items-center gap-3">
                    <Initials name={r.name} tone="soft" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link
                        to={`/tenants/${r.id}`}
                        className="truncate font-bold text-ink text-base after:absolute after:inset-0 after:rounded-2xl"
                      >
                        {r.name}
                      </Link>
                      <span dir="ltr" className="console-mono-chip self-start mt-0.5">
                        {r.slug}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <StatusBadge status={r.status} />
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line/60 pt-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.plan')}</dt>
                      <dd className="font-semibold text-ink flex items-center gap-1.5 mt-0.5">
                        {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                        {r.complimentary && (
                          <Pill tone="ink" className="text-[0.625rem] py-0 px-1.5">
                            {t('tenants.complimentary')}
                          </Pill>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.ticketsMonth')}</dt>
                      <dd className="num font-bold text-primary mt-0.5">{r.ticketsThisMonth}</dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.owner')}</dt>
                      <dd className="truncate text-ink-2 font-mono text-xs mt-0.5">
                        <span dir="ltr">{r.ownerEmail ?? '—'}</span>
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.lastActivity')}</dt>
                      <dd className="text-ink-2 text-xs mt-0.5">
                        {fmtDate(r.lastActivityAt, i18n.language)}
                        {r.status === 'trial' && r.trialEndsAt && (
                          <span className="block text-[0.6875rem] text-muted">
                            {t('tenantsUx.trialEnds', { date: fmtDay(r.trialEndsAt, i18n.language) })}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {canCreate && <StatusToggle row={r} />}
                </li>
              ))}
            </ul>

            {/* Desktop Elevated Data Grid */}
            <Table
              className="hidden md:block"
              caption={t('tenants.title')}
              head={[
                t('tenantsUx.restaurant'),
                t('tenants.status'),
                t('tenants.plan'),
                t('tenants.owner'),
                t('tenants.ticketsMonth'),
                t('tenants.lastActivity'),
                ...(canCreate ? [t('tenantsUx.action', { defaultValue: 'Action' })] : []),
              ]}
            >
              {list.data.items.length === 0 && (
                <tr>
                  <Td className="text-muted text-center py-8" colSpan={canCreate ? 7 : 6}>
                    {t('tenants.empty')}
                  </Td>
                </tr>
              )}
              {list.data.items.map((r) => (
                <tr key={r.id} className="group transition-colors">
                  <Td>
                    <Link to={`/tenants/${r.id}`} className="flex min-h-12 items-center gap-3">
                      <Initials name={r.name} tone="soft" />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-bold text-ink group-hover:text-primary transition-colors">
                          {r.name}
                        </span>
                        <span dir="ltr" className="console-mono-chip self-start mt-0.5">
                          {r.slug}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                    {r.status === 'trial' && r.trialEndsAt && (
                      <span className="mt-1 block text-xs whitespace-nowrap text-muted font-medium">
                        {t('tenantsUx.trialEnds', { date: fmtDay(r.trialEndsAt, i18n.language) })}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="font-semibold text-ink">
                      {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                    </span>
                    {r.complimentary && (
                      <Pill tone="ink" className="ms-2 text-[0.625rem] py-0 px-2">
                        {t('tenants.complimentary')}
                      </Pill>
                    )}
                  </Td>
                  <Td>
                    <span dir="ltr" className="text-ink-2 font-mono text-xs">
                      {r.ownerEmail ?? '—'}
                    </span>
                  </Td>
                  <Td className="num font-bold text-ink">
                    <span className="inline-block px-2.5 py-1 rounded-md bg-canvas ring-1 ring-line font-mono text-xs">
                      {r.ticketsThisMonth}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2 text-xs">
                    <span className="font-medium">{fmtDate(r.lastActivityAt, i18n.language)}</span>
                    <span className="block text-[0.6875rem] text-muted">
                      {t('tenantsUx.createdOn', { date: fmtDay(r.createdAt, i18n.language) })}
                    </span>
                  </Td>
                  {canCreate && (
                    <Td>
                      <StatusToggle row={r} />
                    </Td>
                  )}
                </tr>
              ))}
            </Table>
            <PagerControls page={pager.page} canPrev={pager.canPrev} nextCursor={list.data.nextCursor} onPrev={pager.prev} onNext={pager.next} />
          </>
        ))
      )}
    </PageShell>
  );
}

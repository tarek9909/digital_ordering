import { PLAN_CODES, TENANT_STATUSES } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, LiveRegion, Modal, PageShell, Spinner } from '@dop/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { ErrorNote, TableSkeleton } from '../components/common';
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
  const q = useQuery({
    queryKey: ['plan-options'],
    queryFn: async () => (await api.get<{ items: PlanOption[] }>('/plan-options')).items,
    staleTime: 5 * 60_000,
  });
  const catalogue: PlanOption[] = q.data ?? PLAN_CODES.map((code) => ({ code, name: code, archived: false }));
  return catalogue.map((p) => {
    const name = t(`plan.${p.code}`, { defaultValue: p.name });
    return { value: p.code, label: p.archived ? t('tenants.planArchived', { name }) : name };
  });
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const AVATAR_PALETTES = [
  'from-amber-500/20 via-orange-500/10 to-amber-600/20 text-amber-800 dark:text-amber-200 ring-amber-500/30',
  'from-emerald-500/20 via-teal-500/10 to-emerald-600/20 text-emerald-800 dark:text-emerald-200 ring-emerald-500/30',
  'from-blue-500/20 via-indigo-500/10 to-blue-600/20 text-blue-800 dark:text-blue-200 ring-blue-500/30',
  'from-violet-500/20 via-purple-500/10 to-violet-600/20 text-violet-800 dark:text-violet-200 ring-violet-500/30',
  'from-rose-500/20 via-pink-500/10 to-rose-600/20 text-rose-800 dark:text-rose-200 ring-rose-500/30',
  'from-cyan-500/20 via-sky-500/10 to-cyan-600/20 text-cyan-800 dark:text-cyan-200 ring-cyan-500/30',
];

function getAvatarStyle(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index]!;
}

function BuildingStoreIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 7.5L10 3l7 4.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V7.5z" />
      <path d="M7 18v-7h6v7" />
    </svg>
  );
}

function ClockTrialIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  );
}

function ReceiptOrdersIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 2.5l2 1.5 2-1.5 2 1.5 2-1.5 2 1.5 2-1.5v15l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-15z" />
      <path d="M7 7h6" />
      <path d="M7 11h6" />
      <path d="M7 14h3" />
    </svg>
  );
}

function SearchIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L17.5 17.5" />
    </svg>
  );
}

function MailIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M3.5 5.5l6.5 5 6.5-5" />
    </svg>
  );
}

function SparklesIcon({ className = 'size-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1l1.8 4.2L14 7l-4.2 1.8L8 13l-1.8-4.2L2 7l4.2-1.8L8 1z" />
    </svg>
  );
}

function StatusDot({ status, active }: { status: string; active?: boolean }) {
  if (status === 'active') {
    return (
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-ok" />
      </span>
    );
  }
  if (status === 'trial') {
    return <span className={`size-2 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-info'}`} />;
  }
  if (status === 'past_due') {
    return <span className={`size-2 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-warn'}`} />;
  }
  if (status === 'suspended') {
    return <span className={`size-2 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-danger'}`} />;
  }
  return <span className={`size-2 shrink-0 rounded-full ${active ? 'bg-white' : 'bg-muted/70'}`} />;
}

function TenantStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`tenantStatus.${status}`, { defaultValue: status });

  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg/90 px-2.5 py-0.5 text-xs font-semibold text-ok ring-1 ring-ok/30 shadow-xs">
        <span className="nova-live-dot size-1.5 bg-ok" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === 'trial') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-info-bg/90 px-2.5 py-0.5 text-xs font-semibold text-info ring-1 ring-info/30 shadow-xs">
        <span className="size-1.5 rounded-full bg-info" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === 'past_due') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg/90 px-2.5 py-0.5 text-xs font-semibold text-warn ring-1 ring-warn/30 shadow-xs">
        <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-bg/90 px-2.5 py-0.5 text-xs font-semibold text-danger ring-1 ring-danger/30 shadow-xs">
        <span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-ink-2 ring-1 ring-line shadow-xs">
      <span className="size-1.5 rounded-full bg-muted/70" aria-hidden="true" />
      {label}
    </span>
  );
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
      await run(() =>
        inactive
          ? api.post(`/tenants/${row.id}/reactivate`)
          : api.post(`/tenants/${row.id}/suspend`, {
              reason: t('tenantsUx.toggleReason', { defaultValue: 'Deactivated from the tenants list' }),
            }),
      );
      setDone(t(inactive ? 'actions.reactivate.done' : 'actions.suspend.done'));
      await qc.invalidateQueries({ queryKey: ['tenants'] });
    } catch (e) {
      if (!(e instanceof MfaCancelled)) setFailed(true);
    }
    setBusy(false);
  };

  return (
    <span className="relative z-10 inline-flex flex-col items-end gap-1">
      <LiveRegion toast text={done} />
      <button
        type="button"
        disabled={busy}
        onClick={() => void go()}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs ${
          inactive
            ? 'border border-ok/40 bg-ok-bg/50 text-ok hover:bg-ok hover:text-white'
            : 'border border-line bg-surface text-muted hover:border-danger/40 hover:bg-danger-bg/70 hover:text-danger'
        }`}
      >
        {busy ? (
          <Spinner label={t('common:loading')} />
        ) : inactive ? (
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        ) : (
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M5 8h6" />
          </svg>
        )}
        <span>{t(inactive ? 'actions.reactivate.button' : 'actions.suspend.button')}</span>
      </button>
      {failed && (
        <span role="alert" className="text-xs text-danger font-medium">
          {t('common:error', { defaultValue: 'Something went wrong.' })}
        </span>
      )}
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
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <span>{t('layout.groups.tenants')}</span>
          <span className="size-1 rounded-full bg-muted/40" />
          <span className="text-muted font-normal lowercase tracking-normal">
            {items.length} {items.length === 1 ? 'restaurant' : 'restaurants'}
          </span>
        </span>
      }
      title={t('tenants.title')}
      description={t('tenants.description')}
      actions={
        canCreate && (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            className="group relative inline-flex items-center gap-2 rounded-xl px-4.5 py-2.5 font-semibold text-sm shadow-xs transition-all duration-150 hover:shadow active:scale-[0.98]"
          >
            <svg
              className="size-4 shrink-0 transition-transform duration-200 group-hover:rotate-90"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span>{t('nav.createTenant')}</span>
          </Button>
        )
      }
    >
      {/* Create Tenant Pop-up Modal */}
      {creating && (
        <Modal
          open={creating}
          onOpenChange={(open) => !open && setCreating(false)}
          title={t('create.title')}
          description={t('create.description')}
          size="lg"
        >
          <div className="pt-2">
            <CreateTenantForm
              onCreated={(id) => {
                setCreating(false);
                void nav(`/tenants/${id}`);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        </Modal>
      )}

      {/* KPI Overview Strip */}
      {items.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          {/* Card 1: Total Tenants */}
          <div className="group relative overflow-hidden rounded-2xl bg-surface p-4.5 sm:p-5 border border-line/80 shadow-xs hover:border-line hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                {t('tenants.title')}
              </span>
              <span className="grid size-8 place-items-center rounded-xl bg-canvas text-ink-2 ring-1 ring-line/70 group-hover:scale-105 transition-transform">
                <BuildingStoreIcon className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
                {items.length}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-muted/60" />
              <span>on this page</span>
            </div>
          </div>

          {/* Card 2: Active */}
          <div className="group relative overflow-hidden rounded-2xl bg-surface p-4.5 sm:p-5 border border-line/80 shadow-xs hover:border-ok/30 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                {t('tenantStatus.active')}
              </span>
              <span className="grid size-8 place-items-center rounded-xl bg-ok-bg text-ok ring-1 ring-ok/20 group-hover:scale-105 transition-transform">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-ok" />
                </span>
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ok">
                {activeCount}
              </span>
              {items.length > 0 && (
                <span className="text-xs font-semibold text-muted font-mono">
                  {Math.round((activeCount / items.length) * 100)}%
                </span>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="nova-live-dot size-1.5 bg-ok" />
              <span>venues live</span>
            </div>
          </div>

          {/* Card 3: Trial */}
          <div className="group relative overflow-hidden rounded-2xl bg-surface p-4.5 sm:p-5 border border-line/80 shadow-xs hover:border-info/30 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                {t('tenantStatus.trial')}
              </span>
              <span className="grid size-8 place-items-center rounded-xl bg-info-bg text-info ring-1 ring-info/20 group-hover:scale-105 transition-transform">
                <ClockTrialIcon className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-info">
                {trialCount}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-info" />
              <span>in trial period</span>
            </div>
          </div>

          {/* Card 4: Orders */}
          <div className="group relative overflow-hidden rounded-2xl bg-surface p-4.5 sm:p-5 border border-line/80 shadow-xs hover:border-primary/30 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                {t('tenants.ticketsMonth')}
              </span>
              <span className="grid size-8 place-items-center rounded-xl bg-primary-soft text-primary ring-1 ring-primary/20 group-hover:scale-105 transition-transform">
                <ReceiptOrdersIcon className="size-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
                {totalTickets}
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>orders this month</span>
            </div>
          </div>
        </div>
      )}

      {/* Command & Filter Bar */}
      <div className="mb-6 rounded-2xl bg-surface p-4 sm:p-5 border border-line/80 shadow-xs flex flex-col gap-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {/* Search Form */}
          <form role="search" onSubmit={search} className="relative flex-1">
            <label htmlFor="tenant-search-input" className="sr-only">
              {t('tenants.search')}
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute start-3.5 text-muted/70 flex items-center justify-center">
                <SearchIcon className="size-4.5" />
              </span>
              <input
                id="tenant-search-input"
                type="search"
                className="h-11 w-full rounded-xl border border-line/90 bg-canvas/40 ps-10 pe-24 text-sm font-medium text-ink placeholder:text-muted/70 transition-all duration-150 focus:border-primary focus:bg-surface focus:outline-none focus:ring-3 focus:ring-primary/15"
                placeholder={t('tenantsUx.searchPlaceholder')}
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="absolute end-1.5 flex items-center gap-1.5">
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ('');
                      apply({ q: '' });
                    }}
                    className="grid size-7 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink transition-colors"
                    aria-label="Clear search"
                  >
                    <span className="text-base leading-none">×</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="inline-flex h-8 items-center justify-center rounded-lg bg-ink px-3 text-xs font-semibold text-white shadow-xs hover:bg-panel-2 transition-all active:scale-95"
                >
                  {t('tenantsUx.searchButton')}
                </button>
              </div>
            </div>
          </form>

          {/* Plan Selector */}
          <div className="flex items-center gap-2.5 lg:w-64 shrink-0">
            <label htmlFor="tenant-plan-select" className="text-xs font-bold uppercase tracking-wider text-muted shrink-0 hidden sm:inline-block">
              {t('tenants.plan')}
            </label>
            <div className="relative flex-1">
              <select
                id="tenant-plan-select"
                aria-label={t('tenants.plan')}
                value={filters.plan}
                onChange={(e) => apply({ plan: e.target.value })}
                className="select-chevron h-11 w-full appearance-none rounded-xl border border-line/90 bg-canvas/40 ps-3.5 pe-9 text-sm font-semibold text-ink transition-all duration-150 hover:border-ink-2/30 focus:border-primary focus:bg-surface focus:outline-none focus:ring-3 focus:ring-primary/15 cursor-pointer"
              >
                <option value="">{t('tenantsUx.allPlans')}</option>
                {planOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-line/50" role="group" aria-label={t('tenants.status')}>
          {STATUS_FILTERS.map((s) => {
            const on = filters.status === s;
            const count = s === '' ? items.length : items.filter((x) => x.status === s).length;
            return (
              <button
                key={s || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => apply({ status: s })}
                className={`group inline-flex min-h-8.5 items-center gap-2 rounded-full px-3.5 py-1 text-xs font-semibold transition-all duration-150 ${
                  on
                    ? 'bg-ink text-white ring-1 ring-ink shadow-xs'
                    : 'bg-canvas/70 text-ink-2 ring-1 ring-line/70 hover:bg-surface hover:text-ink hover:ring-line'
                }`}
              >
                <StatusDot status={s} active={on} />
                <span>{s ? t(`tenantStatus.${s}`) : t('tenantsUx.allStatuses')}</span>
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[0.6875rem] font-mono font-medium ${
                      on ? 'bg-white/20 text-white' : 'bg-line/60 text-muted group-hover:text-ink'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {filtered && (
            <button
              type="button"
              className="ms-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-muted hover:text-danger hover:bg-danger-bg/50 transition-colors"
              onClick={clear}
            >
              <span>✕</span>
              <span>{t('tenantsUx.clear')}</span>
            </button>
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
                <Button variant="secondary" onClick={clear} className="rounded-xl">
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
            <ul aria-label={t('tenants.title')} className="flex flex-col gap-3.5 md:hidden">
              {list.data.items.length === 0 && (
                <li className="text-muted p-6 bg-surface rounded-2xl text-center border border-line/80">
                  {t('tenants.empty')}
                </li>
              )}
              {list.data.items.map((r) => (
                <li
                  key={r.id}
                  className="relative flex flex-col gap-3.5 rounded-2xl bg-surface p-4.5 shadow-xs border border-line/80 transition-all hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ring-1 shadow-2xs font-display text-xs font-bold ${getAvatarStyle(
                        r.name,
                      )}`}
                    >
                      {initialsOf(r.name) || '•'}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link
                        to={`/tenants/${r.id}`}
                        className="truncate font-semibold text-ink text-base hover:text-primary transition-colors"
                      >
                        {r.name}
                      </Link>
                      <span dir="ltr" className="mt-0.5 inline-flex items-center gap-1 font-mono text-[0.7rem] text-muted self-start bg-canvas px-1.5 py-0.5 rounded border border-line/60">
                        <span className="text-muted/40">/</span>
                        {r.slug}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <TenantStatusBadge status={r.status} />
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line/60 pt-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">{t('tenants.plan')}</dt>
                      <dd className="font-semibold text-ink flex items-center gap-1.5 mt-0.5">
                        {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                        {r.complimentary && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-panel text-white px-1.5 py-0.2 text-[0.6rem] font-bold uppercase tracking-wider">
                            {t('tenants.complimentary')}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">{t('tenants.ticketsMonth')}</dt>
                      <dd className="num font-bold text-ink mt-0.5 flex items-center gap-1">
                        <ReceiptOrdersIcon className="size-3 text-muted/70" />
                        <span>{r.ticketsThisMonth}</span>
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">{t('tenants.owner')}</dt>
                      <dd className="truncate text-ink-2 font-mono text-xs mt-0.5 flex items-center gap-1.5">
                        {r.ownerEmail ? (
                          <>
                            <MailIcon className="size-3.5 text-muted/60 shrink-0" />
                            <span dir="ltr">{r.ownerEmail}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">{t('tenants.lastActivity')}</dt>
                      <dd className="text-ink-2 text-xs mt-0.5">
                        {fmtDate(r.lastActivityAt, i18n.language)}
                        {r.status === 'trial' && r.planEndsAt && (
                          <span className="block text-[0.6875rem] text-muted mt-0.5">
                            {t('tenantsUx.trialEnds', { date: fmtDay(r.planEndsAt, i18n.language) })}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-between border-t border-line/60 pt-3 gap-2">
                    <Link
                      to={`/tenants/${r.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                    >
                      <span>View details</span>
                      <span aria-hidden="true" className="rtl:rotate-180">→</span>
                    </Link>
                    {canCreate && <StatusToggle row={r} />}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop Elevated Data Grid */}
            <div className="hidden md:block overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-xs">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-canvas/50">
                  <caption className="sr-only">{t('tenants.title')}</caption>
                  <thead className="sticky top-0 z-10 bg-canvas/90 backdrop-blur-md border-b border-line/80">
                    <tr>
                      <th scope="col" className="px-5 py-3.5 text-start text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenantsUx.restaurant')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenants.status')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenants.plan')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenants.owner')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-center text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenants.ticketsMonth')}
                      </th>
                      <th scope="col" className="px-4 py-3.5 text-start text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                        {t('tenants.lastActivity')}
                      </th>
                      {canCreate && (
                        <th scope="col" className="px-5 py-3.5 text-end text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                          {t('tenantsUx.action', { defaultValue: 'Action' })}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {list.data.items.length === 0 ? (
                      <tr>
                        <td className="text-muted text-center py-12" colSpan={canCreate ? 7 : 6}>
                          <div className="flex flex-col items-center justify-center gap-2">
                            <SearchIcon className="size-8 text-muted/40" />
                            <span className="font-semibold text-ink text-sm">{t('tenants.empty')}</span>
                            <span className="text-xs text-muted">{t('tenants.emptyHint')}</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      list.data.items.map((r) => (
                        <tr key={r.id} className="group transition-colors">
                          <td className="px-5 py-3.5 align-middle">
                            <Link to={`/tenants/${r.id}`} className="group/link flex items-center gap-3.5">
                              <span
                                aria-hidden="true"
                                className={`grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ring-1 shadow-2xs font-display text-xs font-bold transition-all group-hover/link:scale-105 ${getAvatarStyle(
                                  r.name,
                                )}`}
                              >
                                {initialsOf(r.name) || '•'}
                              </span>
                              <span className="flex min-w-0 flex-col">
                                <span className="font-semibold text-ink group-hover/link:text-primary transition-colors text-sm truncate flex items-center gap-1.5">
                                  {r.name}
                                  <svg
                                    className="size-3 text-muted/40 group-hover/link:text-primary opacity-0 group-hover/link:opacity-100 transition-all -translate-x-1 group-hover/link:translate-x-0 rtl:rotate-180"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M6 3l5 5-5 5" />
                                  </svg>
                                </span>
                                <span dir="ltr" className="mt-0.5 inline-flex items-center gap-1 font-mono text-[0.7rem] text-muted self-start bg-canvas px-1.5 py-0.5 rounded border border-line/60">
                                  <span className="text-muted/40">/</span>
                                  {r.slug}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex flex-col items-start gap-1">
                              <TenantStatusBadge status={r.status} />
                              {r.status === 'trial' && r.planEndsAt && (
                                <span className="text-[0.6875rem] font-medium text-muted flex items-center gap-1">
                                  <ClockTrialIcon className="size-3 text-muted/70 shrink-0" />
                                  {t('tenantsUx.trialEnds', { date: fmtDay(r.planEndsAt, i18n.language) })}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-ink text-sm">
                                {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                              </span>
                              {r.complimentary && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-panel text-white px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider shadow-2xs">
                                  <SparklesIcon className="size-2.5 text-glow" />
                                  {t('tenants.complimentary')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 align-middle">
                            {r.ownerEmail ? (
                              <span dir="ltr" className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-2 truncate max-w-56" title={r.ownerEmail}>
                                <MailIcon className="size-3.5 text-muted/60 shrink-0" />
                                <span className="truncate">{r.ownerEmail}</span>
                              </span>
                            ) : (
                              <span className="text-muted/50 text-xs font-mono">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 align-middle text-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-canvas border border-line/70 font-mono text-xs font-bold text-ink">
                              <ReceiptOrdersIcon className="size-3 text-muted/70" />
                              <span className="num">{r.ticketsThisMonth}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3.5 align-middle whitespace-nowrap text-xs">
                            <div className="flex flex-col">
                              <span className="font-medium text-ink-2">
                                {r.lastActivityAt ? fmtDate(r.lastActivityAt, i18n.language) : '—'}
                              </span>
                              <span className="text-[0.6875rem] text-muted mt-0.5">
                                {t('tenantsUx.createdOn', { date: fmtDay(r.createdAt, i18n.language) })}
                              </span>
                            </div>
                          </td>
                          {canCreate && (
                            <td className="px-5 py-3.5 align-middle text-end whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-2">
                                <StatusToggle row={r} />
                                <Link
                                  to={`/tenants/${r.id}`}
                                  className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-ink-2/30 hover:bg-canvas hover:text-ink transition-all shadow-2xs"
                                  title={r.name}
                                  aria-label={`View ${r.name}`}
                                >
                                  <svg className="size-3.5 rtl:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 3l5 5-5 5" />
                                  </svg>
                                </Link>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Integrated Pagination Footer */}
              <div className="flex items-center justify-between border-t border-line/70 bg-canvas/40 px-5 py-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-muted">
                  <span className="font-mono bg-canvas px-2.5 py-1 rounded-md border border-line/60 text-ink-2">
                    {t('pager.page', { page: pager.page })}
                  </span>
                  {list.data.items.length > 0 && (
                    <span className="hidden sm:inline text-muted/80">
                      · Showing {list.data.items.length} {list.data.items.length === 1 ? 'tenant' : 'tenants'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!pager.canPrev}
                    onClick={pager.prev}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink shadow-2xs hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                  >
                    <span aria-hidden="true" className="rtl:rotate-180">←</span>
                    <span>{t('pager.prev')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!list.data.nextCursor}
                    onClick={() => list.data.nextCursor && pager.next(list.data.nextCursor)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink shadow-2xs hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
                  >
                    <span>{t('pager.next')}</span>
                    <span aria-hidden="true" className="rtl:rotate-180">→</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Pagination Bar */}
            <nav
              aria-label={t('pager.label')}
              className="mt-4 flex md:hidden items-center justify-between gap-3 rounded-2xl bg-surface p-3 shadow-xs border border-line/80"
            >
              <button
                type="button"
                disabled={!pager.canPrev}
                onClick={pager.prev}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-2xs hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <span aria-hidden="true" className="rtl:rotate-180">←</span>
                <span>{t('pager.prev')}</span>
              </button>
              <span className="text-xs font-semibold font-mono text-muted bg-canvas px-3 py-1.5 rounded-lg border border-line/60">
                {t('pager.page', { page: pager.page })}
              </span>
              <button
                type="button"
                disabled={!list.data.nextCursor}
                onClick={() => list.data.nextCursor && pager.next(list.data.nextCursor)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-2xs hover:bg-canvas disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <span>{t('pager.next')}</span>
                <span aria-hidden="true" className="rtl:rotate-180">→</span>
              </button>
            </nav>
          </>
        ))
      )}
    </PageShell>
  );
}

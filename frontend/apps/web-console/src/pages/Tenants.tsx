import { PLAN_CODES, TENANT_STATUSES } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, PageShell, Pill, Select } from '@dop/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ErrorNote, Initials, PagerControls, primaryLinkClass, StatusBadge, Table, TableSkeleton, Td } from '../components/common';
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

/**
 * Plan filter choices from the catalogue (AS10), readable by every role that lists tenants. Built-in plans keep
 * their translated names; custom plans show their catalogue name. Until the catalogue loads (or if it fails) the
 * built-in codes are offered, so the filter always works.
 */
export function usePlanOptions() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['plan-options'], queryFn: async () => (await api.get<{ items: PlanOption[] }>('/plan-options')).items, staleTime: 5 * 60_000 });
  const catalogue: PlanOption[] = q.data ?? PLAN_CODES.map((code) => ({ code, name: code, archived: false }));
  return catalogue.map((p) => {
    const name = t(`plan.${p.code}`, { defaultValue: p.name });
    return { value: p.code, label: p.archived ? t('tenants.planArchived', { name }) : name };
  });
}

const STATUS_FILTERS = ['', ...TENANT_STATUSES.filter((s) => s !== 'deleted')] as const;

export function TenantsPage() {
  const { t, i18n } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', plan: '' });
  const pager = useCursorPager();
  const planOptions = usePlanOptions();
  const list = useQuery({
    queryKey: ['tenants', filters, pager.cursor],
    queryFn: () => api.get<Paged<TenantRow>>('/tenants', { ...filters, limit: 50, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
  });
  // Status and plan apply at once; the search applies on Enter or the Search button.
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

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.tenants')}
      title={t('tenants.title')}
      description={t('tenants.description')}
      actions={
        can(role, 'tenants.lifecycle') && (
          <Link to="/tenants/new" className={primaryLinkClass}>
            <span aria-hidden="true">+</span>
            {t('nav.createTenant')}
          </Link>
        )
      }
    >
      <div className="mb-5 flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-4 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <form role="search" onSubmit={search} className="flex flex-1 items-end gap-2">
            <Field label={t('tenants.search')} type="search" className="min-w-0 flex-1" placeholder={t('tenantsUx.searchPlaceholder')} value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="ink">
              {t('tenantsUx.searchButton')}
            </Button>
          </form>
          <Select label={t('tenants.plan')} className="lg:w-56" value={filters.plan} onChange={(e) => apply({ plan: e.target.value })} options={[{ value: '', label: t('tenantsUx.allPlans') }, ...planOptions]} />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('tenants.status')}>
          {STATUS_FILTERS.map((s) => {
            const on = filters.status === s;
            return (
              <button
                key={s || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => apply({ status: s })}
                className={`inline-flex min-h-12 items-center lg:min-h-10 rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors ${on ? 'bg-ink text-white ring-ink' : 'bg-surface text-ink-2 ring-line hover:text-ink'}`}
              >
                {s ? t(`tenantStatus.${s}`) : t('tenantsUx.allStatuses')}
              </button>
            );
          })}
          {filtered && (
            <Button variant="ghost" className="ms-auto text-sm" onClick={clear}>
              {t('tenantsUx.clear')}
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
          <EmptyState title={t('tenants.empty')} action={filtered ? <Button variant="secondary" onClick={clear}>{t('tenantsUx.clear')}</Button> : undefined}>
            {t('tenants.emptyHint')}
          </EmptyState>
        ) : (
          <>
            {/* Phones get one card per restaurant; the six-column table needs at least a tablet's width. */}
            <ul aria-label={t('tenants.title')} className="flex flex-col gap-3 md:hidden">
              {list.data.items.length === 0 && <li className="text-muted">{t('tenants.empty')}</li>}
              {list.data.items.map((r) => (
                <li key={r.id} className="relative flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-4 shadow-card transition-colors has-[a:hover]:bg-primary-wash">
                  <div className="flex items-center gap-3">
                    <Initials name={r.name} tone="soft" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* The link covers the whole card (after:inset-0) so the card is one large tap target. */}
                      <Link to={`/tenants/${r.id}`} className="truncate font-semibold text-ink after:absolute after:inset-0 after:rounded-[var(--radius-card)]">
                        {r.name}
                      </Link>
                      <span dir="ltr" className="max-w-full self-start truncate font-mono text-xs text-muted">
                        {r.slug}
                      </span>
                    </span>
                    <span className="shrink-0">
                      <StatusBadge status={r.status} />
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.plan')}</dt>
                      <dd className="font-medium break-words">
                        {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                        {r.complimentary && (
                          <Pill tone="ink" className="ms-2">
                            {t('tenants.complimentary')}
                          </Pill>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.ticketsMonth')}</dt>
                      <dd className="num font-semibold">{r.ticketsThisMonth}</dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.owner')}</dt>
                      <dd className="truncate text-ink-2">
                        <span dir="ltr">{r.ownerEmail ?? '—'}</span>
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-muted">{t('tenants.lastActivity')}</dt>
                      <dd className="text-ink-2">
                        {fmtDate(r.lastActivityAt, i18n.language)}
                        {r.status === 'trial' && r.trialEndsAt && <span className="block text-xs text-muted">{t('tenantsUx.trialEnds', { date: fmtDay(r.trialEndsAt, i18n.language) })}</span>}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <Table className="hidden md:block" caption={t('tenants.title')} head={[t('tenantsUx.restaurant'), t('tenants.status'), t('tenants.plan'), t('tenants.owner'), t('tenants.ticketsMonth'), t('tenants.lastActivity')]}>
              {list.data.items.length === 0 && (
                <tr>
                  <Td className="text-muted">{t('tenants.empty')}</Td>
                </tr>
              )}
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link to={`/tenants/${r.id}`} className="group flex min-h-12 items-center gap-3">
                      <Initials name={r.name} tone="soft" />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold whitespace-nowrap text-ink underline decoration-transparent underline-offset-4 group-hover:text-primary group-hover:decoration-primary">{r.name}</span>
                        <span dir="ltr" className="self-start font-mono text-xs whitespace-nowrap text-muted">
                          {r.slug}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                    {r.status === 'trial' && r.trialEndsAt && <span className="mt-1 block text-xs whitespace-nowrap text-muted">{t('tenantsUx.trialEnds', { date: fmtDay(r.trialEndsAt, i18n.language) })}</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                    {r.complimentary && (
                      <Pill tone="ink" className="ms-2">
                        {t('tenants.complimentary')}
                      </Pill>
                    )}
                  </Td>
                  <Td>
                    <span dir="ltr" className="text-ink-2">
                      {r.ownerEmail ?? '—'}
                    </span>
                  </Td>
                  <Td className="num font-semibold">{r.ticketsThisMonth}</Td>
                  <Td className="whitespace-nowrap text-ink-2">
                    {fmtDate(r.lastActivityAt, i18n.language)}
                    <span className="block text-xs text-muted">{t('tenantsUx.createdOn', { date: fmtDay(r.createdAt, i18n.language) })}</span>
                  </Td>
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

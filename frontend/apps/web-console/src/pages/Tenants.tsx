import { PLAN_CODES, TENANT_STATUSES } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell, Select, Spinner } from '@dop/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ErrorNote, PagerControls, StatusBadge, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useMe } from '../lib/me';
import { useCursorPager } from '../lib/pager';
import { can } from '../lib/roles';
import type { Paged, TenantRow } from '../lib/types';

// Tenants list (FR-SA-04, TR-FE-25): search, status and plan filters, cursor paging.

export function TenantsPage() {
  const { t, i18n } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const [draft, setDraft] = useState({ q: '', status: '', plan: '' });
  const [filters, setFilters] = useState(draft);
  const pager = useCursorPager();
  const list = useQuery({
    queryKey: ['tenants', filters, pager.cursor],
    queryFn: () => api.get<Paged<TenantRow>>('/tenants', { ...filters, limit: 50, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
  });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    pager.reset();
    setFilters(draft);
  };

  return (
    <PageShell
      title={t('tenants.title')}
      actions={
        can(role, 'tenants.lifecycle') && (
          <Link to="/tenants/new" className="inline-flex min-h-12 items-center gap-2 rounded-control bg-primary px-5 font-semibold text-on-primary shadow-[0_8px_20px_-8px_rgb(194_65_12/0.6)] hover:bg-primary-hover">
            <span aria-hidden="true">+</span>
            {t('nav.createTenant')}
          </Link>
        )
      }
    >
      <form role="search" onSubmit={apply} className="mb-5 grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card sm:grid-cols-4 sm:items-end">
        <Field label={t('tenants.search')} type="search" value={draft.q} maxLength={100} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <Select
          label={t('tenants.status')}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          options={[{ value: '', label: t('tenants.any') }, ...TENANT_STATUSES.filter((s) => s !== 'deleted').map((s) => ({ value: s, label: t(`tenantStatus.${s}`) }))]}
        />
        <Select
          label={t('tenants.plan')}
          value={draft.plan}
          onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
          options={[{ value: '', label: t('tenants.any') }, ...PLAN_CODES.map((p) => ({ value: p, label: t(`plan.${p}`) }))]}
        />
        <Button type="submit">{t('tenants.apply')}</Button>
      </form>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        list.data && (
          <>
            <Table
              caption={t('tenants.title')}
              head={[t('tenants.name'), t('tenants.slug'), t('tenants.status'), t('tenants.plan'), t('tenants.owner'), t('tenants.ticketsMonth'), t('tenants.lastActivity'), t('tenants.created')]}
            >
              {list.data.items.length === 0 && (
                <tr>
                  <Td className="text-muted">{t('tenants.empty')}</Td>
                </tr>
              )}
              {list.data.items.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link to={`/tenants/${r.id}`} className="inline-flex min-h-12 items-center font-semibold whitespace-nowrap text-ink underline decoration-primary/40 underline-offset-4 hover:text-primary hover:decoration-primary">
                      {r.name}
                    </Link>
                  </Td>
                  <Td>
                    <span dir="ltr" className="font-mono text-xs whitespace-nowrap text-muted">{r.slug}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>
                    {t(`plan.${r.plan}`, { defaultValue: r.plan })}
                    {r.complimentary && <span className="ms-1 text-xs text-muted">({t('tenants.complimentary')})</span>}
                  </Td>
                  <Td>
                    <span dir="ltr">{r.ownerEmail ?? '—'}</span>
                  </Td>
                  <Td className="num">{r.ticketsThisMonth}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(r.lastActivityAt, i18n.language)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(r.createdAt, i18n.language)}</Td>
                </tr>
              ))}
            </Table>
            <PagerControls page={pager.page} canPrev={pager.canPrev} nextCursor={list.data.nextCursor} onPrev={pager.prev} onNext={pager.next} />
          </>
        )
      )}
    </PageShell>
  );
}

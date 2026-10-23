import { AUDIT_ACTIONS } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell, Select } from '@dop/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AuditTable } from '../components/AuditTable';
import { ErrorNote, PagerControls, TableSkeleton } from '../components/common';
import { api } from '../lib/api';
import { localToIso } from '../lib/format';
import { useCursorPager } from '../lib/pager';
import type { AuditRow, Paged } from '../lib/types';

// Audit log explorer (FR-SA-14): filters and cursor paging.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AuditPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const initial = {
    tenantId: params.get('tenantId') ?? '',
    actorId: '',
    action: '',
    from: '',
    to: '',
  };
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [invalid, setInvalid] = useState<string[]>([]);
  const pager = useCursorPager();
  const q = useQuery({
    queryKey: ['audit', filters, pager.cursor],
    queryFn: () =>
      api.get<Paged<AuditRow>>('/audit', {
        tenantId: filters.tenantId || undefined,
        actorId: filters.actorId || undefined,
        action: filters.action || undefined,
        from: localToIso(filters.from),
        to: localToIso(filters.to),
        limit: 50,
        cursor: pager.cursor,
      }),
    placeholderData: keepPreviousData,
  });

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const bad = (['tenantId', 'actorId'] as const).filter((k) => draft[k] && !UUID.test(draft[k].trim()));
    setInvalid(bad);
    if (bad.length) return;
    pager.reset();
    setFilters({
      ...draft,
      tenantId: draft.tenantId.trim(),
      actorId: draft.actorId.trim(),
    });
  };
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <PageShell wide eyebrow={t('layout.groups.insights')} title={t('audit.title')} description={t('audit.description')}>
      <form role="search" onSubmit={apply} className="mb-5 grid gap-3 rounded-[var(--radius-card)] bg-surface p-4 shadow-card sm:grid-cols-3 lg:grid-cols-6 lg:items-end" noValidate>
        <Field label={t('audit.tenantId')} dir="ltr" value={draft.tenantId} onChange={set('tenantId')} error={invalid.includes('tenantId') ? t('audit.uuidInvalid') : undefined} />
        <Field label={t('audit.actorId')} dir="ltr" value={draft.actorId} onChange={set('actorId')} error={invalid.includes('actorId') ? t('audit.uuidInvalid') : undefined} />
        <Select label={t('audit.action')} value={draft.action} onChange={set('action')} options={[{ value: '', label: t('tenants.any') }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))]} />
        <Field label={t('audit.from')} type="datetime-local" value={draft.from} onChange={set('from')} />
        <Field label={t('audit.to')} type="datetime-local" value={draft.to} onChange={set('to')} />
        <Button type="submit">{t('tenants.apply')}</Button>
      </form>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <TableSkeleton label={t('common:loading')} />
      ) : (
        q.data && (
          <>
            <AuditTable rows={q.data.items} showTenant />
            {(q.data.items.length > 0 || pager.canPrev) && <PagerControls page={pager.page} canPrev={pager.canPrev} nextCursor={q.data.nextCursor} onPrev={pager.prev} onNext={pager.next} />}
          </>
        )
      )}
    </PageShell>
  );
}

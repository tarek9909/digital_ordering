import { useTranslation } from '@dop/i18n';
import { Button, Field, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Paged, TenantRow } from '../lib/types';
import { ErrorNote, StatusBadge } from './common';

/**
 * Choose restaurants by searching: the chosen ones show as removable chips, the results as rows to add.
 * `selected` maps tenant id → name.
 */
export function TenantPicker({ label, selected, onChange }: { label: string; selected: Map<string, string>; onChange: (m: Map<string, string>) => void }) {
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
  const results = list.data?.items.filter((r) => !selected.has(r.id)) ?? [];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 font-semibold">
        {label} <span className="num text-sm font-normal text-muted">({selected.size})</span>
      </legend>
      {selected.size > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('picker.chosen')}>
          {[...selected].map(([id, name]) => (
            <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ink py-1 ps-3 pe-1 text-sm font-semibold text-white">
              <span className="min-w-0 truncate">{name}</span>
              <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-white/15" aria-label={t('list.remove', { item: name })} onClick={() => toggle(id, name, false)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Field
          label={t('tenants.search')}
          type="search"
          className="min-w-0 flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setTerm(q.trim());
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => setTerm(q.trim())}>
          {t('pilot.find')}
        </Button>
      </div>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : results.length === 0 ? (
        <p className="text-sm text-muted">{t('picker.noResults')}</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-auto rounded-input border border-line">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-start hover:bg-primary-wash" aria-label={t('picker.add', { name: r.name })} onClick={() => toggle(r.id, r.name, true)}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{r.name}</span>
                  <span dir="ltr" className="max-w-full self-start truncate font-mono text-xs text-muted">
                    {r.slug}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span aria-hidden="true" className="grid size-7 place-items-center rounded-full font-bold ring-1 ring-line">
                    +
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

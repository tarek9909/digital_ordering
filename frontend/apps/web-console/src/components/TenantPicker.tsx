import { useTranslation } from '@dop/i18n';
import { Button, Field, Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Paged, TenantRow } from '../lib/types';
import { ErrorNote, StatusBadge } from './common';

/**
 * Choose restaurants by searching: chosen ones show as removable chips, results as selectable items.
 */
export function TenantPicker({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: Map<string, string>;
  onChange: (m: Map<string, string>) => void;
}) {
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
      <legend className="mb-1 font-semibold text-ink text-sm sm:text-base flex items-center gap-2">
        <span>{label}</span>
        <span className="num text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-canvas border border-line text-muted">
          {selected.size}
        </span>
      </legend>
      {selected.size > 0 && (
        <ul className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-canvas border border-line" aria-label={t('picker.chosen')}>
          {[...selected].map(([id, name]) => (
            <li
              key={id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-ink py-1 ps-2.5 pe-1 text-xs font-semibold text-white shadow-sm"
            >
              <span className="min-w-0 truncate">{name}</span>
              <button
                type="button"
                className="grid size-5 shrink-0 place-items-center rounded-md hover:bg-white/20 transition-colors"
                aria-label={t('list.remove', { item: name })}
                onClick={() => toggle(id, name, false)}
              >
                <span aria-hidden="true" className="text-sm leading-none">×</span>
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
          placeholder="Filter restaurants..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setTerm(q.trim());
            }
          }}
        />
        <Button type="button" variant="secondary" className="shrink-0 font-bold" onClick={() => setTerm(q.trim())}>
          {t('pilot.find')}
        </Button>
      </div>
      <ErrorNote error={list.error} />
      {list.isPending ? (
        <div className="p-4 text-center">
          <Spinner label={t('common:loading')} />
        </div>
      ) : results.length === 0 ? (
        <p className="text-xs sm:text-sm text-muted py-2">{t('picker.noResults')}</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-auto rounded-xl border border-line bg-surface custom-scrollbar shadow-sm">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2 text-start transition-colors hover:bg-primary-wash"
                aria-label={t('picker.add', { name: r.name })}
                onClick={() => toggle(r.id, r.name, true)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-ink text-sm">{r.name}</span>
                  <span dir="ltr" className="console-mono-chip self-start mt-0.5 text-[0.6875rem]">
                    {r.slug}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span aria-hidden="true" className="grid size-6 place-items-center rounded-md font-bold text-xs ring-1 ring-line text-muted bg-canvas">
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

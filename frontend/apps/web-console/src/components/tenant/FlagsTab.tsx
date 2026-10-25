import { useTranslation } from '@dop/i18n';
import { LiveRegion, Pill, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../lib/api';
import type { FeatureFlag } from '../../lib/types';
import { ErrorNote, Table, Td } from '../common';
import { MfaCancelled, useFreshMfa } from '../FreshMfa';

// Feature flags per tenant (FR-SA-11, TR-ALG-15).

type Choice = 'inherit' | 'on' | 'off';
const choiceOf = (f: FeatureFlag): Choice => (f.override === null ? 'inherit' : f.override ? 'on' : 'off');

export function FlagsTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const key = ['feature-flags', tenantId];
  const run = useFreshMfa();
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ items: FeatureFlag[] }>('/feature-flags', { tenantId }) });
  const set = useMutation({
    mutationFn: ({ flag, choice }: { flag: string; choice: Choice }) => {
      const path = `/tenants/${tenantId}/feature-flags/${encodeURIComponent(flag)}`;
      return run(() => (choice === 'inherit' ? api.delete(path) : api.put(path, { enabled: choice === 'on' })));
    },
    onSuccess: (_r, v) => {
      setAnnounce(t('flags.saved', { key: v.flag }));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (q.isPending) return <Spinner label={t('common:loading')} />;
  return (
    <div className="flex flex-col gap-4">
      <LiveRegion toast text={announce} />
      <div className="rounded-xl bg-canvas p-3.5 border border-line text-xs sm:text-sm text-muted">
        {t('flags.intro')}
      </div>
      <ErrorNote error={q.error ?? (set.error instanceof MfaCancelled ? null : set.error)} />
      <Table caption={t('flags.title')} head={[t('flags.key'), t('flags.description'), t('flags.default'), t('flags.override')]}>
        {q.data?.items.length === 0 && (
          <tr>
            <Td className="text-muted text-center py-6" colSpan={4}>
              {t('flags.none')}
            </Td>
          </tr>
        )}
        {q.data?.items.map((f) => (
          <tr key={f.key}>
            <Td>
              <code dir="ltr" className="console-mono-chip font-bold text-xs">
                {f.key}
              </code>
            </Td>
            <Td className="text-xs sm:text-sm text-ink-2 max-w-xs">{f.description ?? '—'}</Td>
            <Td>
              <Pill tone={f.defaultOn ? 'ok' : 'neutral'} className="text-xs">
                {f.defaultOn ? t('flags.on') : t('flags.off')}
              </Pill>
            </Td>
            <Td>
              <OverrideChoice
                flag={f}
                busy={set.isPending && set.variables?.flag === f.key}
                onChange={(choice) => set.mutate({ flag: f.key, choice })}
              />
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function OverrideChoice({ flag, busy, onChange }: { flag: FeatureFlag; busy: boolean; onChange: (c: Choice) => void }) {
  const { t } = useTranslation();
  const name = useId();
  const current = choiceOf(flag);
  return (
    <fieldset className="flex flex-wrap gap-2" disabled={busy} aria-busy={busy || undefined}>
      <legend className="sr-only">{t('flags.overrideFor', { key: flag.key })}</legend>
      {(['inherit', 'on', 'off'] as const).map((c) => {
        const on = current === c;
        return (
          <label
            key={c}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1 transition-all ${
              on
                ? c === 'on'
                  ? 'bg-ok-bg text-ok ring-ok/40'
                  : c === 'off'
                    ? 'bg-danger-bg text-danger ring-danger/40'
                    : 'bg-ink text-white ring-ink shadow-sm'
                : 'bg-surface text-ink-2 ring-line hover:bg-canvas'
            }`}
          >
            <input type="radio" className="sr-only" name={name} checked={on} onChange={() => onChange(c)} />
            {c === 'inherit' ? t('flags.inherit', { value: flag.defaultOn ? t('flags.on') : t('flags.off') }) : t(`flags.${c}`)}
          </label>
        );
      })}
    </fieldset>
  );
}

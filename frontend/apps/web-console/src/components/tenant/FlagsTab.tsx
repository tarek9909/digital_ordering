import { useTranslation } from '@dop/i18n';
import { LiveRegion, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api } from '../../lib/api';
import type { FeatureFlag } from '../../lib/types';
import { ErrorNote, Table, Td } from '../common';
import { MfaCancelled, useFreshMfa } from '../FreshMfa';

// Feature flags per tenant (FR-SA-11, TR-ALG-15). The plan's effect is resolved on the server, so the console shows
// the platform default and the tenant override: Inherit (no override) / On / Off.

type Choice = 'inherit' | 'on' | 'off';
const choiceOf = (f: FeatureFlag): Choice => (f.override === null ? 'inherit' : f.override ? 'on' : 'off');

export function FlagsTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const key = ['feature-flags', tenantId];
  const run = useFreshMfa(); // overrides unlock paid features: the server asks for a recent code
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
    <div className="flex flex-col gap-3">
      <LiveRegion text={announce} />
      <p className="text-sm text-muted">{t('flags.intro')}</p>
      <ErrorNote error={q.error ?? (set.error instanceof MfaCancelled ? null : set.error)} />
      <Table caption={t('flags.title')} head={[t('flags.key'), t('flags.description'), t('flags.default'), t('flags.override')]}>
        {q.data?.items.length === 0 && (
          <tr>
            <Td className="text-muted">{t('flags.none')}</Td>
          </tr>
        )}
        {q.data?.items.map((f) => (
          <tr key={f.key}>
            <Td>
              <code dir="ltr">{f.key}</code>
            </Td>
            <Td>{f.description ?? '—'}</Td>
            <Td>{f.defaultOn ? t('flags.on') : t('flags.off')}</Td>
            <Td>
              <OverrideChoice flag={f} busy={set.isPending && set.variables?.flag === f.key} onChange={(choice) => set.mutate({ flag: f.key, choice })} />
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
    <fieldset className="flex flex-wrap gap-3" disabled={busy} aria-busy={busy || undefined}>
      <legend className="sr-only">{t('flags.overrideFor', { key: flag.key })}</legend>
      {(['inherit', 'on', 'off'] as const).map((c) => (
        <label key={c} className="inline-flex min-h-12 items-center gap-2">
          <input type="radio" className="size-5" name={name} checked={current === c} onChange={() => onChange(c)} />
          {c === 'inherit' ? t('flags.inherit', { value: flag.defaultOn ? t('flags.on') : t('flags.off') }) : t(`flags.${c}`)}
        </label>
      ))}
    </fieldset>
  );
}

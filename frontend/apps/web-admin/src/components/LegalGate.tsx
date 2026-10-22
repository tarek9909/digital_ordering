import { useTranslation } from '@dop/i18n';
import { Button, Modal } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { wwwUrl } from '../lib/hosts';
import type { LegalPending } from '../lib/types';
import { ErrorNote } from './common';

const legalKey = ['legal-pending'] as const;

/** New terms, privacy or DPA versions must be accepted before going on (TR-PRV-09). The dialog cannot be closed. */
export function LegalGate() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: legalKey, queryFn: async () => (await api.get<{ items: LegalPending[] }>('/legal/pending')).items, staleTime: Infinity, retry: false });
  const accept = useMutation({
    mutationFn: (ids: string[]) => api.post('/legal/accept', { documentIds: ids }),
    onSuccess: () => qc.setQueryData(legalKey, []),
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <Modal open onOpenChange={() => undefined} title={t('legal.title')} description={t('legal.body')}>
      <ul className="mb-4 flex flex-col gap-1">
        {items.map((d) => (
          <li key={d.id}>
            <a className="inline-flex min-h-12 items-center text-primary underline" href={wwwUrl(`/legal/${d.kind}`)} target="_blank" rel="noreferrer">
              {t(`legal.kinds.${d.kind}`, { defaultValue: d.kind })} <span className="ms-1 text-muted" dir="ltr">({d.version})</span>
            </a>
          </li>
        ))}
      </ul>
      <ErrorNote error={accept.error} />
      <div className="mt-3 flex justify-end">
        <Button busy={accept.isPending} onClick={() => accept.mutate(items.map((d) => d.id).slice(0, 5))}>
          {t('legal.accept')}
        </Button>
      </div>
    </Modal>
  );
}

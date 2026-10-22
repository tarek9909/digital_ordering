import type { AuditPurpose } from '@dop/contracts';
import { noteBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, LiveRegion, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { purposeHeaders } from '../../lib/purpose';
import type { TenantNote } from '../../lib/types';
import { ErrorNote, TextArea } from '../common';

// Internal notes (FR-SA-15): visible to the platform team only, never to the tenant.

export function NotesTab({ tenantId, purpose }: { tenantId: string; purpose: AuditPurpose }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [announce, setAnnounce] = useState('');
  const key = ['tenant-notes', tenantId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.call<{ items: TenantNote[] }>('GET', `/tenants/${tenantId}/notes`, { headers: purposeHeaders(purpose) }),
  });
  const add = useMutation({
    mutationFn: (text: string) => api.post(`/tenants/${tenantId}/notes`, { body: text }, purposeHeaders(purpose)),
    onSuccess: () => {
      setBody('');
      setAnnounce(t('notes.added'));
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = noteBody.safeParse({ body });
    setInvalid(!r.success);
    if (r.success) add.mutate(r.data.body);
  };

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion text={announce} />
      <p className="text-sm text-muted">{t('notes.privacy')}</p>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <ErrorNote error={add.error} />
          <TextArea label={t('notes.new')} maxLength={5000} value={body} error={invalid ? t('notes.invalid') : undefined} onChange={(e) => setBody(e.target.value)} className="min-h-24 rounded-input border border-line bg-surface p-3 text-base" />
          <div className="flex justify-end">
            <Button type="submit" busy={add.isPending}>
              {t('notes.add')}
            </Button>
          </div>
        </form>
      </Card>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : q.data?.items.length === 0 ? (
        <p className="text-muted">{t('notes.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('notes.list')}>
          {q.data?.items.map((n) => (
            <li key={n.id}>
              <Card>
                <p className="mb-1 text-sm text-muted">
                  {n.author} · {fmtDate(n.createdAt, i18n.language)}
                </p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

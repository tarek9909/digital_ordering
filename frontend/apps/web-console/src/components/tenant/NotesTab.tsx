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
import { ErrorNote, Initials, TextArea } from '../common';

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
    <div className="flex flex-col gap-6 max-w-3xl">
      <LiveRegion toast text={announce} />
      <div className="rounded-xl bg-canvas p-3.5 border border-line text-xs sm:text-sm text-muted flex items-center gap-2">
        <span className="text-base">🔒</span>
        <span>{t('notes.privacy')}</span>
      </div>

      {/* Note Composer */}
      <Card className="rounded-2xl border border-line shadow-card p-5">
        <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
          <ErrorNote error={add.error} />
          <TextArea
            label={t('notes.new')}
            maxLength={5000}
            value={body}
            placeholder="Write internal team notes, support context, special contract arrangements..."
            error={invalid ? t('notes.invalid') : undefined}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-24 rounded-xl border border-line bg-surface p-3.5 text-sm sm:text-base focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted font-mono">{body.length} / 5000</span>
            <Button type="submit" size="md" className="font-bold shadow-button px-5" busy={add.isPending}>
              {t('notes.add')}
            </Button>
          </div>
        </form>
      </Card>

      <ErrorNote error={q.error} />
      {q.isPending ? (
        <div className="p-8 text-center">
          <Spinner label={t('common:loading')} />
        </div>
      ) : q.data?.items.length === 0 ? (
        <div className="rounded-2xl bg-surface p-8 text-center border border-dashed border-line text-muted">
          <p className="font-semibold text-sm">{t('notes.empty')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3.5" aria-label={t('notes.list')}>
          {q.data?.items.map((n) => (
            <li key={n.id}>
              <Card className="rounded-2xl border border-line shadow-card p-4.5 hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3 border-b border-line/50 pb-2.5 mb-2.5">
                  <Initials name={n.author} tone="soft" />
                  <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                    <span className="font-bold text-sm text-ink truncate">{n.author}</span>
                    <span className="text-xs text-muted whitespace-nowrap">{fmtDate(n.createdAt, i18n.language)}</span>
                  </div>
                </div>
                <p className="break-words whitespace-pre-wrap text-sm text-ink-2 leading-relaxed">{n.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

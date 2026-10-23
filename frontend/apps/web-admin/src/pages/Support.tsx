import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, LiveRegion, PageShell } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmButton, ErrorNote, QueryView, Section, StatusPill, Table, Td, usePageEyebrow } from '../components/common';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import type { SupportCode, SupportSession, SupportStatus } from '../lib/types';
import { useCountdown } from './Displays';

// Support access (FR-ADM-14, FR-SUP-02/04): the platform team asks for access; owners and managers approve or
// refuse, end an active session at any time, or read a one-time code to the agent on the phone.

export const supportSessionsKey = ['support-sessions'] as const;
export const fetchSupportSessions = async () => (await api.get<{ items: SupportSession[] }>('/support-sessions')).items;

const TONES: Record<SupportStatus, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  requested: 'warn',
  active: 'ok',
  refused: 'danger',
  ended: 'neutral',
  expired: 'neutral',
};

function CodeView({ code, onNew, busy }: { code: SupportCode; onNew: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const left = useCountdown(code.expiresAt);
  return (
    <div className="ember-glow flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-ink p-5 text-center text-white">
      <p className="text-white/80">{t('support.codeIntro')}</p>
      {left > 0 ? (
        <>
          <p data-motion="pop" dir="ltr" className="num font-display text-5xl font-extrabold tracking-[0.25em] text-glow" aria-label={code.code.split('').join(' ')}>
            {code.code.slice(0, 4)} {code.code.slice(4)}
          </p>
          <p className="text-white/70">
            {t('support.expiresIn')} <span className="num font-semibold">{formatDuration(left)}</span>
          </p>
        </>
      ) : (
        <p role="status" className="font-semibold text-white">
          {t('support.codeExpired')}
        </p>
      )}
      <Button variant="secondary" className="border-white/20 bg-white/10 text-white hover:bg-white/20" busy={busy} onClick={onNew}>
        {t('support.newCode')}
      </Button>
    </div>
  );
}

export function SupportPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState<SupportCode | null>(null);
  const q = useQuery({
    queryKey: supportSessionsKey,
    queryFn: fetchSupportSessions,
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: supportSessionsKey });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'refuse' | 'end' }) => api.post(`/support-sessions/${id}/${action}`),
    onSuccess: refresh,
  });
  const gen = useMutation({
    mutationFn: () => api.post<SupportCode>('/support-codes'),
    onSuccess: setCode,
  });
  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '—');
  const busy = (id: string, action: string) => decide.isPending && decide.variables?.id === id && decide.variables.action === action;

  const eyebrow = usePageEyebrow('tenant');
  return (
    <PageShell eyebrow={eyebrow} title={t('nav.support')} description={t('support.description')}>
      <Section title={t('support.codeTitle')} description={t('support.codeHint')}>
        <ErrorNote error={gen.error} />
        {code ? (
          <CodeView code={code} busy={gen.isPending} onNew={() => gen.mutate()} />
        ) : (
          <Button busy={gen.isPending} onClick={() => gen.mutate()}>
            {t('support.generate')}
          </Button>
        )}
      </Section>
      <Section title={t('support.sessions')} description={t('support.sessionsHint')}>
        <ErrorNote error={decide.error} />
        <QueryView q={q} skeleton="table">
          {(items) =>
            items.length === 0 ? (
              <EmptyState title={t('support.none')}>{t('support.noneBody')}</EmptyState>
            ) : (
              <Table caption={t('support.sessions')} head={[t('support.agent'), t('support.reason'), t('support.status'), t('support.requested'), t('support.until'), '']}>
                {items.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-semibold whitespace-nowrap">{s.agentName}</Td>
                    <Td className="max-w-sm break-words">{s.reason}</Td>
                    <Td>
                      <StatusPill tone={TONES[s.status] ?? 'neutral'}>
                        {t(`support.statuses.${s.status}`, {
                          defaultValue: s.status,
                        })}
                      </StatusPill>
                      {s.kind === 'emergency' && (
                        <span className="ms-2">
                          <StatusPill tone="danger">{t('support.emergency')}</StatusPill>
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{date(s.requestedAt)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{date(s.status === 'active' ? s.expiresAt : s.endedAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {s.status === 'requested' && (
                          <>
                            <Button variant="ink" busy={busy(s.id, 'approve')} onClick={() => decide.mutate({ id: s.id, action: 'approve' })}>
                              {t('support.approve')}
                            </Button>
                            <Button variant="secondary" busy={busy(s.id, 'refuse')} onClick={() => decide.mutate({ id: s.id, action: 'refuse' })}>
                              {t('support.refuse')}
                            </Button>
                          </>
                        )}
                        {s.status === 'active' && (
                          <ConfirmButton
                            label={t('support.end')}
                            title={t('support.endTitle')}
                            description={t('support.endBody', {
                              name: s.agentName,
                            })}
                            confirmLabel={t('support.end')}
                            variant="danger"
                            busy={busy(s.id, 'end')}
                            onConfirm={() => decide.mutateAsync({ id: s.id, action: 'end' }).catch(() => undefined)}
                          />
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )
          }
        </QueryView>
      </Section>
      <LiveRegion text={decide.isSuccess ? t('support.updated') : code ? t('support.codeReady') : ''} />
    </PageShell>
  );
}

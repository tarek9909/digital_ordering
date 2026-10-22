import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmButton, ErrorNote, QueryView, Section, StatusPill, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import type { SupportCode, SupportSession, SupportStatus } from '../lib/types';
import { useCountdown } from './Displays';

// Support access (FR-ADM-14, FR-SUP-02/04): the platform team asks for access; owners and managers approve or
// refuse, end an active session at any time, or read a one-time code to the agent on the phone.

export const supportSessionsKey = ['support-sessions'] as const;
export const fetchSupportSessions = async () => (await api.get<{ items: SupportSession[] }>('/support-sessions')).items;

const TONES: Record<SupportStatus, 'ok' | 'warn' | 'danger' | 'info'> = { requested: 'warn', active: 'ok', refused: 'danger', ended: 'info', expired: 'info' };

function CodeView({ code, onNew, busy }: { code: SupportCode; onNew: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const left = useCountdown(code.expiresAt);
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-primary p-4 text-center">
      <p>{t('support.codeIntro')}</p>
      {left > 0 ? (
        <>
          <p dir="ltr" className="num text-5xl font-black tracking-[0.25em]" aria-label={code.code.split('').join(' ')}>
            {code.code.slice(0, 4)} {code.code.slice(4)}
          </p>
          <p className="text-muted">
            {t('support.expiresIn')} <span className="num font-semibold">{formatDuration(left)}</span>
          </p>
        </>
      ) : (
        <p role="status" className="font-semibold text-danger">
          {t('support.codeExpired')}
        </p>
      )}
      <Button variant="secondary" busy={busy} onClick={onNew}>
        {t('support.newCode')}
      </Button>
    </div>
  );
}

export function SupportPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState<SupportCode | null>(null);
  const q = useQuery({ queryKey: supportSessionsKey, queryFn: fetchSupportSessions, refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: supportSessionsKey });
  const decide = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'refuse' | 'end' }) => api.post(`/support-sessions/${id}/${action}`), onSuccess: refresh });
  const gen = useMutation({ mutationFn: () => api.post<SupportCode>('/support-codes'), onSuccess: setCode });
  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '—');
  const busy = (id: string, action: string) => decide.isPending && decide.variables?.id === id && decide.variables.action === action;

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.support')}</h1>
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
        <QueryView q={q}>
          {(items) =>
            items.length === 0 ? (
              <p className="text-muted">{t('support.none')}</p>
            ) : (
              <Table caption={t('support.sessions')} head={[t('support.agent'), t('support.reason'), t('support.status'), t('support.requested'), t('support.until'), '']}>
                {items.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.agentName}</Td>
                    <Td className="max-w-sm break-words">{s.reason}</Td>
                    <Td>
                      <StatusPill tone={TONES[s.status] ?? 'info'}>{t(`support.statuses.${s.status}`, { defaultValue: s.status })}</StatusPill>
                      {s.kind === 'emergency' && (
                        <span className="ms-2">
                          <StatusPill tone="danger">{t('support.emergency')}</StatusPill>
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{date(s.requestedAt)}</Td>
                    <Td className="whitespace-nowrap">{date(s.status === 'active' ? s.expiresAt : s.endedAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {s.status === 'requested' && (
                          <>
                            <Button busy={busy(s.id, 'approve')} onClick={() => decide.mutate({ id: s.id, action: 'approve' })}>
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
                            description={t('support.endBody', { name: s.agentName })}
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
    </>
  );
}

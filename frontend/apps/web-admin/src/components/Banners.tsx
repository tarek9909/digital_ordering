import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { daysUntil } from '../lib/access';
import { SEVERITY_TONE, pickMessage, readDismissed, visibleAnnouncements, writeDismissed } from '../lib/announcements';
import { api, authApi } from '../lib/api';
import { errorText } from '../lib/errors';
import { useMe, useTenant } from '../lib/me';
import type { Announcement } from '../lib/types';
import { fetchSupportSessions, supportSessionsKey } from '../pages/Support';

/** "Platform support is viewing this account — End session" (FR-SUP-04, TR-FE-22); polled every 30 s. */
function SupportBanner({ isSupport }: { isSupport: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: supportSessionsKey, queryFn: fetchSupportSessions, refetchInterval: 30_000, staleTime: 15_000 });
  const end = useMutation({ mutationFn: (id: string) => api.post(`/support-sessions/${id}/end`), onSuccess: () => qc.invalidateQueries({ queryKey: supportSessionsKey }) });
  const active = (q.data ?? []).filter((s) => s.status === 'active');
  const requested = (q.data ?? []).filter((s) => s.status === 'requested');
  return (
    <>
      {active.map((s) => (
        <Banner
          key={s.id}
          tone="warn"
          action={
            isSupport ? undefined : (
              <Button variant="secondary" busy={end.isPending && end.variables === s.id} onClick={() => end.mutate(s.id)}>
                {t('banners.endSupport')}
              </Button>
            )
          }
        >
          {isSupport ? t('banners.youAreSupport') : t('banners.supportActive', { name: s.agentName })}
          {s.expiresAt && <span className="ms-2 font-normal">{t('banners.supportUntil', { date: formatDateTime(s.expiresAt, i18n.language) })}</span>}
          {end.error ? <span className="ms-2">{errorText(t, end.error)}</span> : null}
        </Banner>
      ))}
      {!isSupport && requested.length > 0 && (
        <Banner
          tone="info"
          action={
            <Link to="/support" className="inline-flex min-h-12 items-center rounded-lg bg-surface px-4 font-semibold text-ink underline">
              {t('banners.reviewSupport')}
            </Link>
          }
        >
          {t('banners.supportRequested', { name: requested[0]!.agentName })}
        </Banner>
      )}
      <LiveRegion text={end.isSuccess ? t('banners.supportEnded') : ''} />
    </>
  );
}

function Announcements() {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ['announcements'], queryFn: async () => (await api.get<{ items: Announcement[] }>('/announcements')).items, staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });
  const [dismissed, setDismissed] = useState(readDismissed);
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    writeDismissed(next);
    setDismissed(next);
  };
  return (
    <>
      {visibleAnnouncements(q.data ?? [], dismissed).map((a) => (
        <Banner
          key={a.id}
          tone={SEVERITY_TONE[a.severity] ?? 'info'}
          action={
            a.severity === 'critical' ? undefined : (
              <Button variant="ghost" onClick={() => dismiss(a.id)}>
                {t('banners.dismiss')}
              </Button>
            )
          }
        >
          <span className="sr-only">{t(`banners.severity.${a.severity}`, { defaultValue: '' })} </span>
          {pickMessage(a.message, i18n.language)}
        </Banner>
      ))}
    </>
  );
}

/** Global banner area (TR-FE-22): announcements, support session, billing state, trial, deletion, email verification. */
export function Banners() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const tenant = useTenant().data;
  const isOwner = me?.currentRole === 'owner';
  const isSupport = me?.support === true;
  const resend = useMutation({ mutationFn: () => authApi.post('/email/resend') });
  const date = (iso: string) => formatDateTime(iso, i18n.language);
  if (!me) return null;

  const billingLink = isOwner ? (
    <Link to="/billing" className="inline-flex min-h-12 items-center rounded-lg bg-surface px-4 font-semibold text-ink underline">
      {t('banners.goToBilling')}
    </Link>
  ) : undefined;

  return (
    <div className="flex flex-col">
      {!isSupport && <Announcements />}
      <SupportBanner isSupport={isSupport} />
      {tenant && (
        <>
          {tenant.status === 'past_due' && (
            <Banner tone="warn" action={billingLink}>
              {tenant.grace_ends_at ? t('banners.pastDueUntil', { date: date(tenant.grace_ends_at) }) : t('banners.pastDue')}
            </Banner>
          )}
          {tenant.status === 'suspended' && (
            <Banner tone="danger" action={billingLink}>
              {t('banners.suspended')}
            </Banner>
          )}
          {tenant.status === 'trial_expired' && (
            <Banner tone="danger" action={billingLink}>
              {t('banners.trialExpired')}
            </Banner>
          )}
          {tenant.status === 'cancelled' && (
            <Banner tone="danger" action={billingLink}>
              {t('banners.cancelled')}
            </Banner>
          )}
          {tenant.status === 'trial' && !tenant.complimentary && tenant.trial_ends_at && (
            <Banner tone="info" action={billingLink}>
              {t('banners.trial', { count: daysUntil(tenant.trial_ends_at), date: date(tenant.trial_ends_at) })}
            </Banner>
          )}
          {tenant.deletion_requested_at && (
            <Banner
              tone="warn"
              action={
                isOwner ? (
                  <Link to="/settings#deletion" className="inline-flex min-h-12 items-center rounded-lg bg-surface px-4 font-semibold text-ink underline">
                    {t('banners.cancelDeletion')}
                  </Link>
                ) : undefined
              }
            >
              {t('banners.deletionRequested', { date: date(tenant.deletion_requested_at) })}
            </Banner>
          )}
        </>
      )}
      {!isSupport && !me.user.emailVerified && (
        <Banner
          tone="warn"
          action={
            <Button variant="secondary" busy={resend.isPending} disabled={resend.isSuccess} onClick={() => resend.mutate()}>
              {resend.isSuccess ? t('banners.resent') : t('banners.resend')}
            </Button>
          }
        >
          {t('banners.verifyEmail', { email: me.user.email })}
          {resend.error ? <span className="ms-2">{errorText(t, resend.error)}</span> : null}
        </Banner>
      )}
      <LiveRegion text={resend.isSuccess ? t('banners.resent') : ''} />
    </div>
  );
}

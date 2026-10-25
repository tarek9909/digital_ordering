import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, authApi } from '../lib/api';
import { errorText } from '../lib/errors';
import { useMe, useTenant } from '../lib/me';
import type { SupportSession } from '../lib/types';
import { linkClass } from './common';

const supportSessionsKey = ['support-sessions'] as const;
const fetchSupportSessions = async () => (await api.get<{ items: SupportSession[] }>('/support-sessions')).items;

/** "Platform support is viewing this account — End session" (FR-SUP-04, TR-FE-22); polled every 30 s. */
function SupportBanner({ isSupport }: { isSupport: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: supportSessionsKey,
    queryFn: fetchSupportSessions,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const end = useMutation({
    mutationFn: (id: string) => api.post(`/support-sessions/${id}/end`),
    onSuccess: () => qc.invalidateQueries({ queryKey: supportSessionsKey }),
  });
  const active = (q.data ?? []).filter((s) => s.status === 'active');
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
          {s.expiresAt && (
            <span className="ms-2 font-normal">
              {t('banners.supportUntil', {
                date: formatDateTime(s.expiresAt, i18n.language),
              })}
            </span>
          )}
          {end.error ? <span className="ms-2">{errorText(t, end.error)}</span> : null}
        </Banner>
      ))}
      <LiveRegion toast text={end.isSuccess ? t('banners.supportEnded') : ''} />
    </>
  );
}

/** Global banner area (TR-FE-22): support session, billing state, trial, deletion, email verification. */
export function Banners() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const tenant = useTenant().data;
  const isOwner = me?.currentRole === 'owner';
  const isSupport = me?.support === true;
  const resend = useMutation({
    mutationFn: () => authApi.post('/email/resend'),
  });
  const date = (iso: string) => formatDateTime(iso, i18n.language);
  if (!me) return null;

  const billingLink = isOwner ? (
    <Link to="/billing" className={linkClass('quiet')}>
      {t('banners.goToBilling')}
    </Link>
  ) : undefined;

  return (
    // Padded only when a banner shows (live regions are visually hidden).
    <div className="flex max-w-6xl flex-col gap-2 has-[>:not(.sr-only)]:px-4 has-[>:not(.sr-only)]:pt-5 sm:has-[>:not(.sr-only)]:px-8 lg:has-[>:not(.sr-only)]:px-10">
      <SupportBanner isSupport={isSupport} />
      {tenant && (
        <>
          {tenant.status === 'past_due' && (
            <Banner tone="warn" action={billingLink}>
              {tenant.grace_ends_at
                ? t('banners.pastDueUntil', {
                    date: date(tenant.grace_ends_at),
                  })
                : t('banners.pastDue')}
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
          {tenant.deletion_requested_at && (
            <Banner
              tone="warn"
              action={
                isOwner ? (
                  <Link to="/settings/deletion" className={linkClass('quiet')}>
                    {t('banners.cancelDeletion')}
                  </Link>
                ) : undefined
              }
            >
              {t('banners.deletionRequested', {
                date: date(tenant.deletion_requested_at),
              })}
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
          {/* The address can be one long word: let it break on a phone. */}
          <span className="break-words">{t('banners.verifyEmail', { email: me.user.email })}</span>
          {resend.error ? <span className="ms-2">{errorText(t, resend.error)}</span> : null}
        </Banner>
      )}
      <LiveRegion toast text={resend.isSuccess ? t('banners.resent') : ''} />
    </div>
  );
}

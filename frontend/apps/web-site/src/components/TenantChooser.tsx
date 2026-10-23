import { setCsrfToken } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, LiveRegion, Spinner } from '@dop/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { authApi, type MeResponse, type Membership } from '../lib/api';
import { errorText, isApiError } from '../lib/errors';
import { FormError } from './FormCard';
import { textLink } from './PageHeader';

/**
 * After a www sign-in: list the restaurants of this account and hand off to the chosen one's admin
 * (POST /handoff, one-time code, TRD §14). GET /me first so the CSRF token is set before the POST.
 */
export function TenantChooser({ onSignedOut }: { onSignedOut: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['www-tenants'],
    queryFn: async () => {
      const me = await authApi.get<MeResponse>('/me');
      setCsrfToken(me.csrfToken);
      const r = await authApi.get<{ tenants: Membership[] }>('/tenants');
      return { me, tenants: r.tenants };
    },
    retry: false,
  });

  useEffect(() => {
    if (isApiError(q.error, 'UNAUTHENTICATED')) onSignedOut();
  }, [q.error, onSignedOut]);

  const handoff = useMutation({
    mutationFn: (slug: string) =>
      authApi.post<{ code: string; url: string }>('/handoff', {
        tenantSlug: slug,
      }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => setError(errorText(t, e)),
  });

  const signOut = useMutation({
    mutationFn: () => authApi.post<void>('/sign-out'),
    onSettled: onSignedOut,
  });

  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.isError) return <FormError text={errorText(t, q.error)} />;

  const { me, tenants } = q.data;
  return (
    <div className="flex flex-col gap-4">
      <p>{t('signin.chooseIntro', { name: me.user.name })}</p>
      {tenants.length === 0 ? (
        <p>
          {t('signin.noTenants')}{' '}
          <Link to="/contact" className={textLink}>
            {t('nav.contact')}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('signin.chooseTitle')}>
          {tenants.map((m) => (
            <li key={m.tenantId}>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  handoff.mutate(m.slug);
                }}
                disabled={handoff.isPending}
                className="flex min-h-16 w-full items-center justify-between gap-3 rounded-input border border-line bg-surface px-4 py-2 text-start transition-colors hover:border-ink-2/30 hover:bg-primary-wash disabled:opacity-60"
              >
                <span className="flex flex-col">
                  <span className="font-semibold">{m.name}</span>
                  <span className="font-mono text-xs text-muted" dir="ltr">
                    {m.slug}
                  </span>
                </span>
                <span className="flex flex-col items-end text-sm">
                  <span>{t(`roles.${m.role}`)}</span>
                  <span className="text-muted">{t([`tenantStatus.${m.status}`, 'tenantStatus.unknown'])}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {handoff.isPending && <Spinner label={t('signin.opening')} />}
      <LiveRegion text={handoff.isPending ? t('signin.opening') : ''} />
      <FormError text={error} />
      <Button variant="secondary" onClick={() => signOut.mutate()} busy={signOut.isPending}>
        {t('common:signOut')}
      </Button>
    </div>
  );
}

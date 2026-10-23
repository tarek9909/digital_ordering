import { useTranslation } from '@dop/i18n';
import { Banner, Button, LiveRegion, Spinner } from '@dop/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormCard, FormError } from '../components/FormCard';
import { pillLink, textLink } from '../components/PageHeader';
import { authApi } from '../lib/api';
import { errorText, isApiError } from '../lib/errors';

/**
 * `/confirm-email?token=` → POST /email/change/confirm (FR-ADM-18, W05). Confirms a new sign-in email from the
 * link sent to that address. The token is single-use, so it is sent once; only a failure that did not reach a
 * verdict (network, server) offers a retry.
 */
export function ConfirmEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const valid = token.length >= 16 && token.length <= 100;
  const sent = useRef(false);
  const m = useMutation({
    mutationFn: (tk: string) => authApi.post<{ email: string }>('/email/change/confirm', { token: tk }),
  });
  const { mutate } = m;

  useEffect(() => {
    if (sent.current || !valid) return;
    sent.current = true;
    mutate(token);
  }, [token, valid, mutate]);

  const expired = !valid || isApiError(m.error, 'INVITATION_EXPIRED') || isApiError(m.error, 'VALIDATION_FAILED') || isApiError(m.error, 'NOT_FOUND');
  if (expired) {
    return (
      <FormCard title={t('confirmEmail.title')}>
        <FormError text={t('confirmEmail.expired')} />
        <p>{t('confirmEmail.expiredHelp')}</p>
        <Link to="/sign-in" className={textLink}>
          {t('common:signIn')}
        </Link>
      </FormCard>
    );
  }
  if (isApiError(m.error, 'EMAIL_TAKEN')) {
    return (
      <FormCard title={t('confirmEmail.title')}>
        <FormError text={t('confirmEmail.taken')} />
        <p>{t('confirmEmail.takenHelp')}</p>
        <Link to="/sign-in" className={textLink}>
          {t('common:signIn')}
        </Link>
      </FormCard>
    );
  }
  if (m.isError) {
    return (
      <FormCard title={t('confirmEmail.title')}>
        <FormError text={errorText(t, m.error)} />
        <Button type="button" onClick={() => mutate(token)}>
          {t('confirmEmail.retry')}
        </Button>
      </FormCard>
    );
  }
  if (m.isSuccess) {
    const done = t('confirmEmail.done', { email: m.data.email });
    return (
      <FormCard title={t('confirmEmail.title')}>
        <LiveRegion text={done} />
        <Banner tone="ok">
          {t('confirmEmail.doneLead')}{' '}
          <bdi dir="ltr" className="break-all">
            {m.data.email}
          </bdi>
        </Banner>
        <p>{t('confirmEmail.signedOut')}</p>
        <Link to="/sign-in" className={pillLink.primary}>
          {t('confirmEmail.continue')}
        </Link>
      </FormCard>
    );
  }
  return (
    <FormCard title={t('confirmEmail.title')}>
      <Spinner label={t('confirmEmail.checking')} />
      <p>{t('confirmEmail.checking')}</p>
    </FormCard>
  );
}

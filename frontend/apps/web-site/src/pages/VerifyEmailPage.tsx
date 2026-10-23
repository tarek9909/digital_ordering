import { useTranslation } from '@dop/i18n';
import { Banner, LiveRegion, Spinner } from '@dop/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormCard, FormError } from '../components/FormCard';
import { pillLink, textLink } from '../components/PageHeader';
import { authApi } from '../lib/api';
import { errorText, isApiError } from '../lib/errors';

/** `/verify-email?token=` → POST /email/verify. The token is single-use, so it is sent exactly once. */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const sent = useRef(false);
  const m = useMutation({
    mutationFn: (tk: string) => authApi.post<void>('/email/verify', { token: tk }),
  });
  const { mutate } = m;

  useEffect(() => {
    if (sent.current || token.length < 16) return;
    sent.current = true;
    mutate(token);
  }, [token, mutate]);

  if (token.length < 16 || m.isError) {
    const text = !m.isError || isApiError(m.error, 'INVITATION_EXPIRED') || isApiError(m.error, 'VALIDATION_FAILED') ? t('verify.expired') : errorText(t, m.error);
    return (
      <FormCard title={t('verify.title')}>
        <FormError text={text} />
        <p>{t('verify.expiredHelp')}</p>
        <Link to="/sign-in" className={textLink}>
          {t('common:signIn')}
        </Link>
      </FormCard>
    );
  }
  if (m.isSuccess) {
    return (
      <FormCard title={t('verify.title')}>
        <LiveRegion text={t('verify.done')} />
        <Banner tone="ok">{t('verify.done')}</Banner>
        <Link to="/sign-in" className={pillLink.primary}>
          {t('verify.continue')}
        </Link>
      </FormCard>
    );
  }
  return (
    <FormCard title={t('verify.title')}>
      <Spinner label={t('verify.checking')} />
      <p>{t('verify.checking')}</p>
    </FormCard>
  );
}

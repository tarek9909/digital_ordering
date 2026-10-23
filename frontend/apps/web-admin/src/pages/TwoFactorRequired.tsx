import { useTranslation } from '@dop/i18n';
import { totpConfirmBody } from '@dop/contracts';
import { Banner, Button, Field } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { errorText } from '../lib/errors';
import { QueryView } from '../components/common';
import { authApi, BASENAME } from '../lib/api';
import { useMe } from '../lib/me';
import { TotpEnrolment } from './Account';
import { AuthCard } from './SignIn';

/**
 * Mandatory two-factor (TR-AUTH-11, NFR-SEC-04): owners and managers of multi-venue restaurants must use an
 * authenticator. Any admin call answering 401 MFA_REQUIRED lands here; after enrolment the app reloads.
 */
/** Confirms this session with the authenticator code. */
export function StepUp({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const { t } = useTranslation();
  const form = useForm({
    resolver: zodResolver(totpConfirmBody),
    defaultValues: { code: '' },
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      await authApi.post('/mfa/verify', body);
      onDone();
    } catch (e) {
      form.setError('code', { type: 'server', message: errorText(t, e) });
    }
  });
  const err = form.formState.errors.code;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Banner tone="info">{t('mfaRequired.enterCode')}</Banner>
      <Field
        label={t('mfaRequired.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        error={err ? (err.type === 'server' ? err.message : t('mfaRequired.codeFormat')) : undefined}
        {...form.register('code')}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={form.formState.isSubmitting}>
          {t('mfaRequired.confirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={onSignOut}>
          {t('common:signOut')}
        </Button>
      </div>
    </form>
  );
}

export function TwoFactorRequiredPage() {
  const { t } = useTranslation();
  const me = useMe();
  const reload = () => window.location.assign(`${BASENAME}/`);
  const signOut = async () => {
    try {
      await authApi.post('/sign-out');
    } finally {
      window.location.assign(`${BASENAME}/sign-in`);
    }
  };
  return (
    <AuthCard title={t('mfaRequired.title')}>
      <p className="text-ink-2">{t('mfaRequired.body')}</p>
      <QueryView q={me}>
        {(m) =>
          m.user.mfaEnrolled ? (
            // Enrolled already, but this session was opened without the code: confirm it here (A04).
            <StepUp onDone={reload} onSignOut={() => void signOut()} />
          ) : (
            <TotpEnrolment onEnrolled={reload} />
          )
        }
      </QueryView>
    </AuthCard>
  );
}

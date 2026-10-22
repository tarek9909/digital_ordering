import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@dop/client-sdk';
import { forgotPasswordBody, resetPasswordBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, LiveRegion } from '@dop/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { FormCard, FormError } from '../components/FormCard';
import { authApi } from '../lib/api';
import { errorText, fieldMessage } from '../lib/errors';

/** Forgot password: always answers "if the account exists, we sent a link" (no enumeration). */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(forgotPasswordBody), defaultValues: { email: '' } });
  const m = useMutation({
    mutationFn: (b: { email: string }) => authApi.post<{ accepted: boolean }>('/password/forgot', b),
    onSuccess: () => setSent(true),
    onError: (e) => setFormError(errorText(t, e)),
  });
  if (sent) {
    return (
      <FormCard title={t('password.forgotTitle')}>
        <LiveRegion text={t('password.forgotSent')} />
        <p>{t('password.forgotSent')}</p>
        <Link to="/sign-in" className="inline-flex min-h-12 items-center underline">
          {t('common:signIn')}
        </Link>
      </FormCard>
    );
  }
  return (
    <FormCard title={t('password.forgotTitle')} intro={t('password.forgotIntro')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          m.mutate(v);
        })}
      >
        <Field label={t('common:email')} type="email" autoComplete="email" dir="ltr" error={fieldMessage(t, errors.email)} {...register('email')} />
        <FormError text={formError} />
        <Button type="submit" size="lg" busy={m.isPending}>
          {t('password.sendLink')}
        </Button>
      </form>
    </FormCard>
  );
}

/** Reset password from the emailed link `/reset-password?token=`. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(resetPasswordBody), defaultValues: { token, password: '' } });
  const m = useMutation({
    mutationFn: (b: { token: string; password: string }) => authApi.post<void>('/password/reset', b),
    onSuccess: () => setDone(true),
    onError: (e) => {
      setFormError(e instanceof ApiError && e.code === 'INVITATION_EXPIRED' ? t('password.linkExpired') : errorText(t, e));
      const pw = e instanceof ApiError ? e.fieldErrors().password : undefined;
      if (pw) setError('password', { type: 'server', message: pw });
    },
  });
  if (!token) {
    return (
      <FormCard title={t('password.resetTitle')}>
        <FormError text={t('password.linkExpired')} />
        <Link to="/forgot-password" className="inline-flex min-h-12 items-center underline">
          {t('password.requestNew')}
        </Link>
      </FormCard>
    );
  }
  if (done) {
    return (
      <FormCard title={t('password.resetTitle')}>
        <LiveRegion text={t('password.resetDone')} />
        <p>{t('password.resetDone')}</p>
        <Link to="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 font-semibold text-on-primary">
          {t('common:signIn')}
        </Link>
      </FormCard>
    );
  }
  return (
    <FormCard title={t('password.resetTitle')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((v) => {
          setFormError(null);
          m.mutate(v);
        })}
      >
        <input type="hidden" {...register('token')} />
        <Field
          label={t('password.newPassword')}
          type="password"
          autoComplete="new-password"
          hint={t('password.hint')}
          error={fieldMessage(t, errors.password)}
          {...register('password')}
        />
        <FormError text={formError} />
        {formError && (
          <Link to="/forgot-password" className="inline-flex min-h-12 items-center underline">
            {t('password.requestNew')}
          </Link>
        )}
        <Button type="submit" size="lg" busy={m.isPending}>
          {t('password.resetSubmit')}
        </Button>
      </form>
    </FormCard>
  );
}

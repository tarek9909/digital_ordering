import { signInBody, signInMfaBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, Field } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { authApi } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import { wwwUrl } from '../lib/hosts';
import { fetchMe, meKey } from '../lib/me';
import type { SignInResponse } from '../lib/types';

const codeSchema = signInMfaBody.pick({ code: true });

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-4 text-2xl font-bold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

/** After a session cookie is set: load /me (CSRF token) and go on. */
export function useFinishSignIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  return async () => {
    const me = await fetchMe();
    qc.setQueryData(meKey, me);
    if (!me.currentRole) return false;
    navigate(from, { replace: true });
    return true;
  };
}

export function MfaStep({ mfaToken, onDone }: { mfaToken: string; onDone: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });
  const submit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await authApi.post<SignInResponse>('/sign-in/mfa', { mfaToken, code });
      if (!(await onDone())) setError(t('signIn.notMember'));
    } catch (e) {
      setError(errorText(t, e));
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p>{t('signIn.mfaPrompt')}</p>
      <Field
        label={t('signIn.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        error={form.formState.errors.code ? t('signIn.codeInvalid') : undefined}
        {...form.register('code')}
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" busy={form.formState.isSubmitting}>
        {t('signIn.verify')}
      </Button>
    </form>
  );
}

export function SignInPage() {
  const { t } = useTranslation();
  const finish = useFinishSignIn();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(signInBody), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (body) => {
    setError(null);
    try {
      const r = await authApi.post<SignInResponse>('/sign-in', body);
      if (r.mfaRequired && r.mfaToken) return setMfaToken(r.mfaToken);
      if (r.mfaEnrollmentRequired) return setError(t('signIn.enrollElsewhere'));
      if (!(await finish())) setError(t('signIn.notMember'));
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['email', 'password'])) setError(errorText(t, e));
    }
  });

  return (
    <AuthCard title={t('signIn.title')}>
      {mfaToken ? (
        <MfaStep mfaToken={mfaToken} onDone={finish} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t('common:email')} type="email" autoComplete="username" error={errors.email ? t('form.email') : undefined} {...form.register('email')} />
          <Field label={t('common:password')} type="password" autoComplete="current-password" error={errors.password ? t('form.required') : undefined} {...form.register('password')} />
          {error && <Banner tone="danger">{error}</Banner>}
          <Button type="submit" busy={isSubmitting}>
            {t('common:signIn')}
          </Button>
          {/* Google sign-in (R1.1): the API answers 404 when it is not configured; the browser shows that page. */}
          <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 font-semibold" href="/api/auth/v1/oauth/google/start">
            <span aria-hidden="true" className="font-black text-[#4285f4]">
              G
            </span>
            {t('signIn.google')}
          </a>
          <a className="inline-flex min-h-12 items-center text-primary underline" href={wwwUrl('/forgot-password')}>
            {t('signIn.forgot')}
          </a>
        </form>
      )}
    </AuthCard>
  );
}

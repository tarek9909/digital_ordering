import { signInBody, signInMfaBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { AuthShell, Banner, Button, Field } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { authApi } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import { wwwUrl } from '../lib/hosts';
import { switchLang } from '../lib/lang';
import { linkClass, textLinkClass } from '../components/common';
import { fetchMe, meKey } from '../lib/me';
import type { SignInResponse } from '../lib/types';

const codeSchema = signInMfaBody.pick({ code: true });

/** Sign-in, invitation, two-factor and handoff screens: the shared split screen with the admin's story. */
export function AuthCard({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const other = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <AuthShell
      appTitle={t('common:appName')}
      panelEyebrow={t('auth.eyebrow')}
      headline={t('auth.headline')}
      points={[t('auth.points.live'), t('auth.points.reach'), t('auth.points.team')]}
      title={title}
      eyebrow={eyebrow}
      corner={
        <Button variant="ghost" lang={other} onClick={() => switchLang(other)}>
          {other === 'ar' ? 'العربية' : 'English'}
        </Button>
      }
    >
      {children}
    </AuthShell>
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
  const form = useForm({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
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
      <p className="text-ink-2">{t('signIn.mfaPrompt')}</p>
      <Field
        label={t('signIn.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="[&_input]:text-center [&_input]:font-mono [&_input]:text-2xl [&_input]:tracking-[0.4em]"
        autoFocus
        error={form.formState.errors.code ? t('signIn.codeInvalid') : undefined}
        {...form.register('code')}
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" size="lg" busy={form.formState.isSubmitting}>
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
  const form = useForm({
    resolver: zodResolver(signInBody),
    defaultValues: { email: '', password: '' },
  });
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
          <Button type="submit" size="lg" busy={isSubmitting}>
            {t('common:signIn')}
          </Button>
          {/* Google sign-in (R1.1): the API answers 404 when it is not configured; the browser shows that page. */}
          <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {t('signIn.or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          <a className={linkClass('secondary')} href="/api/auth/v1/oauth/google/start">
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-canvas font-display text-sm font-extrabold text-ink">
              G
            </span>
            {t('signIn.google')}
          </a>
          <a className={`${textLinkClass} self-center text-sm`} href={wwwUrl('/forgot-password')}>
            {t('signIn.forgot')}
          </a>
        </form>
      )}
    </AuthCard>
  );
}

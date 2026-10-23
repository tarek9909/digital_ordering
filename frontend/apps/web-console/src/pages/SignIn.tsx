import { zodResolver } from '@hookform/resolvers/zod';
import { signInBody, totpConfirmBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, LiveRegion } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote } from '../components/common';
import { authApi } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { fetchMe, meKey } from '../lib/me';
import type { SignInResponse } from '../lib/types';

// Console sign-in with mandatory MFA (TRD §14): password → (enrol TOTP) → code.

type Step = { kind: 'password' } | { kind: 'code'; mfaToken: string; enroll?: { secret: string; uri: string } };

export function SignInPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const qc = useQueryClient();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/tenants';

  const done = async () => {
    await qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
    void nav(from.startsWith('/') && !from.startsWith('//') ? from : '/tenants', { replace: true });
  };

  return (
    <AuthShell title={t('signIn.title')} eyebrow={t('auth.step', { n: step.kind === 'password' ? 1 : 2 })}>
      {step.kind === 'password' ? (
          <PasswordStep
            onResult={async (r) => {
              if ('ok' in r) return done();
              if (r.mfaEnrollmentRequired) {
                const enroll = await authApi.post<{ secret: string; uri: string }>('/sign-in/mfa/enroll', { mfaToken: r.mfaToken });
                setStep({ kind: 'code', mfaToken: r.mfaToken, enroll });
              } else setStep({ kind: 'code', mfaToken: r.mfaToken });
            }}
          />
        ) : (
          <CodeStep step={step} onDone={done} onBack={() => setStep({ kind: 'password' })} />
        )}
    </AuthShell>
  );
}

function PasswordStep({ onResult }: { onResult: (r: SignInResponse) => Promise<void> }) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(signInBody), defaultValues: { email: '', password: '' } });
  const [error, setError] = useState<unknown>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await onResult(await authApi.post<SignInResponse>('/sign-in', v));
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['email', 'password'])) setError(e);
    }
  });
  const errs = form.formState.errors;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <Field label={t('common:email')} type="email" autoComplete="username" error={errs.email && t('form.emailInvalid')} {...form.register('email')} />
      <Field label={t('common:password')} type="password" autoComplete="current-password" error={errs.password && t('form.required')} {...form.register('password')} />
      <Button type="submit" size="lg" busy={form.formState.isSubmitting}>
        {t('common:signIn')}
      </Button>
    </form>
  );
}

function CodeStep({ step, onDone, onBack }: { step: Extract<Step, { kind: 'code' }>; onDone: () => Promise<void>; onBack: () => void }) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(totpConfirmBody), defaultValues: { code: '' } });
  const [error, setError] = useState<unknown>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await authApi.post('/sign-in/mfa', { mfaToken: step.mfaToken, code: v.code });
      await onDone();
    } catch (e) {
      setError(e);
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <LiveRegion text={step.enroll ? t('signIn.enrollTitle') : t('signIn.codeTitle')} />
      {step.enroll ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('signIn.enrollTitle')}</h2>
          <p className="text-muted">{t('signIn.enrollBody')}</p>
          <p className="font-medium">{t('signIn.secret')}</p>
          <code dir="ltr" className="rounded-input border border-line bg-canvas p-3 font-mono text-lg tracking-widest break-all select-all">
            {step.enroll.secret}
          </code>
          <details>
            <summary className="min-h-12 cursor-pointer py-3">{t('signIn.uri')}</summary>
            <code dir="ltr" className="block rounded-input bg-canvas p-3 font-mono text-xs break-all select-all">
              {step.enroll.uri}
            </code>
          </details>
        </div>
      ) : (
        <p className="text-muted">{t('signIn.codeBody')}</p>
      )}
      <ErrorNote error={error} />
      <Field
        label={t('mfa.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        error={form.formState.errors.code && t('mfa.codeInvalid')}
        {...form.register('code')}
      />
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('common:back')}
        </Button>
        <Button type="submit" busy={form.formState.isSubmitting}>
          {t('mfa.verify')}
        </Button>
      </div>
    </form>
  );
}

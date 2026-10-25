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
    <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
      <ErrorNote error={error} />
      <div className="flex flex-col gap-3.5">
        <Field
          label={t('common:email')}
          type="email"
          autoComplete="username"
          dir="ltr"
          placeholder="admin@tanbeeh.io"
          error={errs.email && t('form.emailInvalid')}
          {...form.register('email')}
        />
        <Field
          label={t('common:password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          error={errs.password && t('form.required')}
          {...form.register('password')}
        />
      </div>
      <Button type="submit" size="lg" className="w-full mt-2 font-bold shadow-button" busy={form.formState.isSubmitting}>
        {t('common:signIn')}
      </Button>
    </form>
  );
}

function CodeStep({ step, onDone, onBack }: { step: Extract<Step, { kind: 'code' }>; onDone: () => Promise<void>; onBack: () => void }) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(totpConfirmBody), defaultValues: { code: '' } });
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await authApi.post('/sign-in/mfa', { mfaToken: step.mfaToken, code: v.code });
      await onDone();
    } catch (e) {
      setError(e);
    }
  });

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
      <LiveRegion text={step.enroll ? t('signIn.enrollTitle') : t('signIn.codeTitle')} />
      {step.enroll ? (
        <div className="flex flex-col gap-3 rounded-xl bg-canvas p-4 border border-line">
          <h2 className="text-base font-bold text-ink">{t('signIn.enrollTitle')}</h2>
          <p className="text-xs sm:text-sm text-muted">{t('signIn.enrollBody')}</p>
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">{t('signIn.secret')}</span>
            <div className="flex items-center gap-2">
              <code dir="ltr" className="flex-1 rounded-lg border border-line bg-surface p-2.5 font-mono text-sm tracking-wider font-bold text-ink select-all">
                {step.enroll.secret}
              </code>
              <button
                type="button"
                onClick={() => copySecret(step.enroll!.secret)}
                className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-canvas hover:text-ink transition-colors"
              >
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
          <details className="text-xs text-muted pt-1">
            <summary className="cursor-pointer py-1 font-medium hover:text-ink">{t('signIn.uri')}</summary>
            <code dir="ltr" className="mt-1 block rounded-lg bg-surface p-2 font-mono text-[0.6875rem] break-all select-all border border-line">
              {step.enroll.uri}
            </code>
          </details>
        </div>
      ) : (
        <div className="rounded-xl bg-canvas/60 p-3.5 border border-line text-sm text-muted">
          {t('signIn.codeBody')}
        </div>
      )}
      <ErrorNote error={error} />
      <Field
        label={t('mfa.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="font-mono text-center tracking-[0.35em] text-lg font-bold"
        autoFocus
        error={form.formState.errors.code && t('mfa.codeInvalid')}
        {...form.register('code')}
      />
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← {t('common:back')}
        </Button>
        <Button type="submit" size="md" className="font-bold shadow-button px-6" busy={form.formState.isSubmitting}>
          {t('mfa.verify')}
        </Button>
      </div>
    </form>
  );
}

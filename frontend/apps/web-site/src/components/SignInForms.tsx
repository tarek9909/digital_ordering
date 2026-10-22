import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@dop/client-sdk';
import { signInBody, signInMfaBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field } from '@dop/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { authApi, type SignInResponse } from '../lib/api';
import { errorText, fieldMessage } from '../lib/errors';
import { mapFieldErrors } from '../lib/forms';
import { FormError } from './FormCard';

type Next = { kind: 'session' } | { kind: 'mfa'; mfaToken: string };

function toNext(r: SignInResponse): Next {
  return 'ok' in r ? { kind: 'session' } : { kind: 'mfa', mfaToken: r.mfaToken };
}

/** Email + password (TRD §12.4 POST /sign-in on the www host). */
export function CredentialsForm({ onDone }: { onDone: (n: Next) => void }) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(signInBody), defaultValues: { email: '', password: '' } });
  const m = useMutation({
    mutationFn: (b: { email: string; password: string }) => authApi.post<SignInResponse>('/sign-in', b),
    onSuccess: (r) => onDone(toNext(r)),
    onError: (e) => {
      setFormError(e instanceof ApiError && e.code === 'UNAUTHENTICATED' ? t('signin.wrongCredentials') : errorText(t, e));
      if (e instanceof ApiError) for (const [f, msg] of mapFieldErrors(e.fieldErrors(), ['email', 'password'] as const).fields) setError(f, { type: 'server', message: msg });
    },
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((v) => {
        setFormError(null);
        m.mutate(v);
      })}
    >
      <Field label={t('common:email')} type="email" autoComplete="username" dir="ltr" error={fieldMessage(t, errors.email)} {...register('email')} />
      <Field label={t('common:password')} type="password" autoComplete="current-password" error={fieldMessage(t, errors.password)} {...register('password')} />
      <FormError text={formError} />
      <Button type="submit" size="lg" busy={m.isPending}>
        {t('common:signIn')}
      </Button>
      {/* Google sign-in for existing accounts (AS02); the API answers 404 when it is not configured. */}
      <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 font-semibold" href="/api/auth/v1/oauth/google/start">
        <span aria-hidden="true" className="font-black text-[#4285f4]">
          G
        </span>
        {t('signin.google')}
      </a>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/forgot-password" className="inline-flex min-h-12 items-center underline">
          {t('signin.forgot')}
        </Link>
        <Link to="/contact" className="inline-flex min-h-12 items-center underline">
          {t('signin.noAccount')}
        </Link>
      </div>
    </form>
  );
}

/**
 * Google sign-in found an existing account with a password for that email (M-1): the password proves the account is
 * the caller's before Google is linked. Someone who does not know it resets it from their mailbox first.
 */
export function LinkGoogleForm({ linkToken, onDone, onBack }: { linkToken: string; onDone: (n: Next) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => authApi.post<SignInResponse>('/oauth/google/link', { linkToken, password }),
    onSuccess: (r) => onDone(toNext(r)),
    onError: (e) => setFormError(e instanceof ApiError && e.code === 'UNAUTHENTICATED' ? t('signin.linkWrong') : errorText(t, e)),
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        if (password) m.mutate();
      }}
    >
      <p>{t('signin.linkIntro')}</p>
      <Field label={t('common:password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormError text={formError} />
      <Button type="submit" size="lg" busy={m.isPending}>
        {t('signin.linkSubmit')}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/forgot-password" className="inline-flex min-h-12 items-center underline">
          {t('signin.forgot')}
        </Link>
        <button type="button" className="inline-flex min-h-12 items-center underline" onClick={onBack}>
          {t('signin.linkCancel')}
        </button>
      </div>
    </form>
  );
}

/** Six-digit TOTP step when the account has two-factor sign-in. */
export function MfaForm({ mfaToken, onDone, onBack }: { mfaToken: string; onDone: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(signInMfaBody), defaultValues: { mfaToken, code: '' } });
  const m = useMutation({
    mutationFn: (b: { mfaToken: string; code: string }) => authApi.post<SignInResponse>('/sign-in/mfa', b),
    onSuccess: () => onDone(),
    onError: (e) => setFormError(e instanceof ApiError && e.code === 'UNAUTHENTICATED' ? t('signin.wrongCode') : errorText(t, e)),
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((v) => {
        setFormError(null);
        m.mutate(v);
      })}
    >
      <p>{t('signin.mfaIntro')}</p>
      <input type="hidden" {...register('mfaToken')} />
      <Field
        label={t('signin.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        className="num"
        error={errors.code ? t('signin.codeFormat') : undefined}
        {...register('code')}
      />
      <FormError text={formError} />
      <Button type="submit" size="lg" busy={m.isPending}>
        {t('signin.verify')}
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>
        {t('common:back')}
      </Button>
    </form>
  );
}

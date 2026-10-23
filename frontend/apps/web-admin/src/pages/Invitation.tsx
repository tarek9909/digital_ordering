import { acceptInvitationBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { ErrorNote, Loading, textLinkClass } from '../components/common';
import { authApi } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import type { InvitationDetails, SignInResponse } from '../lib/types';
import { AuthCard, MfaStep, useFinishSignIn } from './SignIn';

const newUserSchema = acceptInvitationBody.required();
const existingUserSchema = acceptInvitationBody.pick({ password: true }).required();

function useAccept(token: string) {
  const { t } = useTranslation();
  const finish = useFinishSignIn();
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const accept = async (body: { name?: string; password: string }, onFieldErrors: (e: unknown) => boolean) => {
    setError(null);
    try {
      const r = await authApi.post<SignInResponse>(`/invitations/${encodeURIComponent(token)}/accept`, body);
      if (r.mfaRequired && r.mfaToken) return setMfaToken(r.mfaToken);
      if (!(await finish())) setError(t('signIn.notMember'));
    } catch (e) {
      if (!onFieldErrors(e)) setError(errorText(t, e));
    }
  };
  return { accept, error, mfaToken, finish };
}

function NewUserForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const { accept, error, mfaToken, finish } = useAccept(token);
  const form = useForm({
    resolver: zodResolver(newUserSchema),
    defaultValues: { name: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  if (mfaToken) return <MfaStep mfaToken={mfaToken} onDone={finish} />;
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit((b) => accept(b, (e) => applyFieldErrors(e, form.setError, ['name', 'password'])))}>
      <Field label={t('invitation.name')} autoComplete="name" error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Field
        label={t('invitation.newPassword')}
        type="password"
        autoComplete="new-password"
        hint={t('form.passwordHint')}
        error={errors.password ? (errors.password.type === 'server' ? errors.password.message : t('form.passwordHint')) : undefined}
        {...form.register('password')}
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" size="lg" busy={isSubmitting}>
        {t('invitation.accept')}
      </Button>
    </form>
  );
}

function ExistingUserForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const { accept, error, mfaToken, finish } = useAccept(token);
  const form = useForm({
    resolver: zodResolver(existingUserSchema),
    defaultValues: { password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  if (mfaToken) return <MfaStep mfaToken={mfaToken} onDone={finish} />;
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit((b) => accept(b, (e) => applyFieldErrors(e, form.setError, ['password'])))}>
      <p className="text-ink-2">{t('invitation.existingUser')}</p>
      <Field label={t('common:password')} type="password" autoComplete="current-password" error={errors.password ? t('form.required') : undefined} {...form.register('password')} />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" size="lg" busy={isSubmitting}>
        {t('invitation.accept')}
      </Button>
    </form>
  );
}

export function InvitationPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const q = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => authApi.get<InvitationDetails>(`/invitations/${encodeURIComponent(token)}`),
    enabled: token.length >= 16,
    retry: false,
  });

  return (
    <AuthCard title={t('invitation.title')}>
      {token.length < 16 ? (
        <Banner tone="danger">{t('errors.INVITATION_EXPIRED')}</Banner>
      ) : q.error ? (
        <div className="flex flex-col gap-4">
          <ErrorNote error={q.error} />
          <Link to="/sign-in" className={textLinkClass}>
            {t('handoff.signInInstead')}
          </Link>
        </div>
      ) : !q.data ? (
        <Loading />
      ) : (
        <>
          <p className="mb-2 text-ink-2">
            {t('invitation.intro', {
              tenant: q.data.tenantName,
              email: q.data.email,
              role: t(`roles.${q.data.role}`),
            })}
          </p>
          {q.data.userExists ? <ExistingUserForm token={token} /> : <NewUserForm token={token} />}
        </>
      )}
    </AuthCard>
  );
}

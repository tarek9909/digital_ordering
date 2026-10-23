import { changeEmailBody, changePasswordBody, deleteMeBody, mePatch, totpConfirmBody, totpRemoveBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, PageShell, Select } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Checkbox, ConfirmButton, ErrorNote, QueryView, Section, StatusPill } from '../components/common';
import { api, authApi, BASENAME } from '../lib/api';
import { applyFieldErrors, errorText, isCode } from '../lib/errors';
import { meKey, useMe } from '../lib/me';
import type { Me } from '../lib/types';

const profileSchema = mePatch.required();

function Profile({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: me.user.name,
      locale: me.user.locale === 'en' ? 'en' : 'ar',
    },
  });
  const { errors, isSubmitting, isDirty, isSubmitSuccessful } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      await api.patch('/me', body);
      form.reset(body);
      await qc.invalidateQueries({ queryKey: meKey });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'locale'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field label={t('account.name')} autoComplete="name" error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Field label={t('common:email')} value={me.user.email} readOnly dir="ltr" hint={t('account.emailChangeBelow')} />
      <Select
        label={t('account.emailLanguage')}
        options={[
          { value: 'ar', label: t('languages.ar') },
          { value: 'en', label: t('languages.en') },
        ]}
        {...form.register('locale')}
      />
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      <div>
        <Button type="submit" variant="ink" busy={isSubmitting} disabled={!isDirty}>
          {t('common:save')}
        </Button>
      </div>
      <LiveRegion text={isSubmitSuccessful && !isDirty ? t('common:saved') : ''} />
    </form>
  );
}

/** Email change (W05, FR-ADM-18): confirmed with the password, completed from the link sent to the new address. */
function EmailChange({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(changeEmailBody),
    defaultValues: { newEmail: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    setSent(null);
    try {
      const r = await api.post<{ pendingEmail: string }>('/me/email', body);
      setSent(r.pendingEmail);
      form.reset();
      await qc.invalidateQueries({ queryKey: meKey });
    } catch (e) {
      if (isCode(e, 'UNAUTHENTICATED'))
        form.setError('password', {
          type: 'server',
          message: t('account.wrongPassword'),
        });
      else if (isCode(e, 'EMAIL_TAKEN'))
        form.setError('newEmail', {
          type: 'server',
          message: t('account.emailTaken'),
        });
      else if (!applyFieldErrors(e, form.setError, ['newEmail', 'password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  const pending = sent ?? me.user.pendingEmail ?? null;
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <p className="text-ink-2">{t('account.currentEmail', { email: me.user.email })}</p>
      {pending && <Banner tone="info">{t('account.emailPending', { email: pending })}</Banner>}
      <Field
        type="email"
        dir="ltr"
        autoComplete="email"
        label={t('account.newEmail')}
        error={errors.newEmail ? (errors.newEmail.type === 'server' ? errors.newEmail.message : t('form.email')) : undefined}
        {...form.register('newEmail')}
      />
      <Field
        type="password"
        autoComplete="current-password"
        label={t('account.currentPassword')}
        error={errors.password ? (errors.password.type === 'server' ? errors.password.message : t('form.required')) : undefined}
        {...form.register('password')}
      />
      <p className="text-sm text-muted">{t('account.emailChangeHint')}</p>
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      <div>
        <Button type="submit" variant="ink" busy={isSubmitting}>
          {t('account.changeEmail')}
        </Button>
      </div>
      <LiveRegion text={sent ? t('account.emailPending', { email: sent }) : ''} />
    </form>
  );
}

/** The member's own notification preferences in this restaurant (W06, FR-RPT-05). */
function Preferences({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (weeklySummary: boolean) => api.put('/me/preferences', { weeklySummary }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
  if (!me.preferences) return null;
  const checked = save.isPending && save.variables !== undefined ? save.variables : me.preferences.weeklySummary;
  return (
    <div className="flex flex-col gap-3">
      <Checkbox label={t('account.weeklySummary')} hint={t('account.weeklySummaryHint')} checked={checked} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
      <ErrorNote error={save.error} />
      <LiveRegion text={save.isSuccess ? t('common:saved') : ''} />
    </div>
  );
}

function Password() {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(changePasswordBody),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    setDone(false);
    try {
      await api.post('/me/password', body);
      form.reset();
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['currentPassword', 'newPassword'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field
        type="password"
        autoComplete="current-password"
        label={t('account.currentPassword')}
        error={errors.currentPassword ? (errors.currentPassword.message && errors.currentPassword.type === 'server' ? errors.currentPassword.message : t('form.required')) : undefined}
        {...form.register('currentPassword')}
      />
      <Field
        type="password"
        autoComplete="new-password"
        label={t('account.newPassword')}
        hint={t('form.passwordHint')}
        error={errors.newPassword ? (errors.newPassword.type === 'server' ? t('account.passwordRejected') : t('form.passwordHint')) : undefined}
        {...form.register('newPassword')}
      />
      <p className="text-sm text-muted">{t('account.passwordSignsOut')}</p>
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      {done && <Banner tone="ok">{t('account.passwordChanged')}</Banner>}
      <div>
        <Button type="submit" variant="ink" busy={isSubmitting}>
          {t('account.changePassword')}
        </Button>
      </div>
      <LiveRegion text={done ? t('account.passwordChanged') : ''} />
    </form>
  );
}

/** Authenticator enrolment: start → QR and key → confirm with a code. Also used by the mandatory two-factor screen. */
export function TotpEnrolment({ onEnrolled }: { onEnrolled: () => void | Promise<unknown> }) {
  const { t } = useTranslation();
  const [enrolment, setEnrolment] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [password, setPassword] = useState('');
  // Starting an authenticator re-proves the account (H-5): the password, or a recent sign-in for Google-only accounts.
  const qcEnroll = useQueryClient();
  const enroll = useMutation({
    meta: { credentialCheck: true },
    onError: () => qcEnroll.invalidateQueries({ queryKey: meKey }),
    mutationFn: () => authApi.post<{ secret: string; uri: string }>('/mfa/totp/enroll', password ? { password } : {}),
    onSuccess: (r) => {
      setPassword('');
      setEnrolment(r);
    },
  });
  const form = useForm({
    resolver: zodResolver(totpConfirmBody),
    defaultValues: { code: '' },
  });
  const confirm = form.handleSubmit(async (body) => {
    try {
      await authApi.post('/mfa/totp/confirm', body);
      setEnrolment(null);
      form.reset();
      await onEnrolled();
    } catch (e) {
      form.setError('code', { type: 'server', message: errorText(t, e) });
    }
  });

  if (!enrolment)
    return (
      <div className="flex flex-col gap-3">
        <p className="max-w-2xl text-ink-2">{t('account.mfaIntro')}</p>
        <Field
          className="max-w-xs"
          label={t('account.mfaPassword')}
          type="password"
          autoComplete="current-password"
          hint={t('account.mfaPasswordHint')}
          value={password}
          // A wrong password is shown on the field; a fresh sign-in requirement or other refusal below (AS11).
          error={isCode(enroll.error, 'UNAUTHENTICATED') ? t('account.wrongPassword') : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        {isCode(enroll.error, 'FORBIDDEN') ? (
          <Banner tone="warn">{t('account.mfaSignInAgain')}</Banner>
        ) : (
          enroll.error && !isCode(enroll.error, 'UNAUTHENTICATED') && <ErrorNote error={enroll.error} />
        )}
        <div>
          <Button variant="ink" busy={enroll.isPending} onClick={() => enroll.mutate()}>
            {t('account.mfaStart')}
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
      <p className="text-ink-2">{t('account.mfaScan')}</p>
      <div className="w-fit rounded-[var(--radius-card)] bg-surface p-4 shadow-card ring-1 ring-line">
        <QRCodeSVG value={enrolment.uri} size={180} role="img" aria-label={t('account.mfaQr')} />
      </div>
      <p className="text-sm">
        {t('account.mfaSecret')}{' '}
        <code dir="ltr" className="rounded-input bg-canvas px-2 py-1 font-mono break-all ring-1 ring-line">
          {enrolment.secret}
        </code>
      </p>
      <Field
        className="max-w-xs"
        label={t('account.mfaCode')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        dir="ltr"
        error={form.formState.errors.code ? (form.formState.errors.code.type === 'server' ? form.formState.errors.code.message : t('signIn.codeInvalid')) : undefined}
        {...form.register('code')}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="ink" busy={form.formState.isSubmitting}>
          {t('account.mfaConfirm')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEnrolment(null)}>
          {t('common:cancel')}
        </Button>
      </div>
    </form>
  );
}

function TwoFactor({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Turning two-factor off needs a code from the current authenticator (H-5).
  const form = useForm({ resolver: zodResolver(totpRemoveBody), defaultValues: { code: '' } });
  const remove = useMutation({
    meta: { credentialCheck: true },
    mutationFn: (body: { code: string }) => authApi.delete('/mfa/totp', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
    onError: () => qc.invalidateQueries({ queryKey: meKey }),
  });

  if (me.user.mfaEnrolled)
    return (
      <div className="flex flex-col gap-3">
        <p>
          <StatusPill tone="ok">{t('account.mfaOn')}</StatusPill>
        </p>
        <p className="text-sm">{t('account.mfaRemoveCode')}</p>
        <Field
          className="max-w-xs"
          label={t('account.mfaCode')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          error={form.formState.errors.code || isCode(remove.error, 'UNAUTHENTICATED') ? t('signIn.codeInvalid') : undefined}
          {...form.register('code')}
        />
        {/* A wrong code is shown on the field; the multi-venue policy refusal (FORBIDDEN) or a lock-out below. */}
        {isCode(remove.error, 'FORBIDDEN') ? (
          <Banner tone="warn">{t('account.mfaRequiredByVenues')}</Banner>
        ) : (
          remove.error && !isCode(remove.error, 'UNAUTHENTICATED') && <ErrorNote error={remove.error} />
        )}
        <div>
          <ConfirmButton
            label={t('account.mfaRemove')}
            title={t('account.mfaRemoveTitle')}
            description={t('account.mfaRemoveBody')}
            confirmLabel={t('account.mfaRemove')}
            variant="danger"
            busy={remove.isPending}
            onConfirm={() => form.handleSubmit((b) => remove.mutateAsync(b).catch(() => undefined))()}
          />
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <p>
        <StatusPill tone="warn">{t('account.mfaOff')}</StatusPill>
      </p>
      <TotpEnrolment onEnrolled={() => qc.invalidateQueries({ queryKey: meKey })} />
    </div>
  );
}

/** Delete my user account (FR-ADM-20, TR-PRV-11); the only owner of a restaurant must transfer ownership first. */
function DeleteAccount() {
  const { t } = useTranslation();
  const form = useForm({
    resolver: zodResolver(deleteMeBody),
    defaultValues: { password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      await authApi.delete('/me', body);
      window.location.assign(`${BASENAME}/sign-in`);
    } catch (e) {
      if (isCode(e, 'UNAUTHENTICATED')) form.setError('password', { type: 'server', message: 'wrong' });
      else if (isCode(e, 'FORBIDDEN')) form.setError('root', { message: t('account.deleteOnlyOwner') });
      else if (!applyFieldErrors(e, form.setError, ['password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3" noValidate>
      <p className="max-w-2xl text-ink-2">{t('account.deleteHint')}</p>
      <Field
        type="password"
        autoComplete="current-password"
        label={t('team.yourPassword')}
        error={errors.password ? (errors.password.type === 'server' ? t('settings.passwordWrong') : t('form.required')) : undefined}
        {...form.register('password')}
      />
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      <div>
        <ConfirmButton
          label={t('account.deleteAccount')}
          title={t('account.deleteTitle')}
          description={t('account.deleteConfirm')}
          confirmLabel={t('account.deleteAccount')}
          variant="danger"
          busy={isSubmitting}
          onConfirm={() => submit()}
        />
      </div>
    </form>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const me = useMe();
  const eyebrow = me.data?.user.email;
  return (
    <PageShell eyebrow={eyebrow ? <span dir="ltr">{eyebrow}</span> : undefined} title={t('nav.account')} description={t('account.description')}>
      <QueryView q={me} skeleton="form">
        {(m) => (
          <>
            <Section title={t('account.profile')}>
              <Profile me={m} />
            </Section>
            <Section title={t('account.email')}>
              <EmailChange me={m} />
            </Section>
            <Section title={t('account.password')}>
              <Password />
            </Section>
            {m.preferences && (
              <Section title={t('account.preferences')}>
                <Preferences me={m} />
              </Section>
            )}
            <Section title={t('account.mfa')} description={t('account.mfaOptional')}>
              <TwoFactor me={m} />
            </Section>
            <Section tone="danger" title={t('account.deleteTitle')}>
              <DeleteAccount />
            </Section>
          </>
        )}
      </QueryView>
    </PageShell>
  );
}

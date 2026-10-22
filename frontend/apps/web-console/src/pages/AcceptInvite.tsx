import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field } from '@dop/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote } from '../components/common';
import { authApi } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'mismatch' });

/** Platform invitation acceptance: /accept?token= */
export function AcceptInvitePage() {
  const { t } = useTranslation();
  const token = useSearchParams()[0].get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await authApi.post(`/platform-invitations/${encodeURIComponent(token)}/accept`, { password: v.password });
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['password'])) setError(e);
    }
  });
  const errs = form.formState.errors;
  return (
    <AuthShell title={t('accept.title')}>
      {!token ? (
          <Banner tone="danger">{t('accept.missingToken')}</Banner>
        ) : done ? (
          <div className="flex flex-col gap-4">
            <Banner tone="ok">{t('accept.done')}</Banner>
            <Link to="/sign-in" className="inline-flex min-h-12 items-center justify-center rounded-control bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover">
              {t('common:signIn')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <p className="text-muted">{t('accept.body')}</p>
            <ErrorNote error={error} />
            <Field
              label={t('accept.password')}
              type="password"
              autoComplete="new-password"
              hint={t('form.passwordHint')}
              error={errs.password && (errs.password.type === 'server' ? errs.password.message : t('form.passwordHint'))}
              {...form.register('password')}
            />
            <Field label={t('accept.confirm')} type="password" autoComplete="new-password" error={errs.confirm && t('form.passwordMismatch')} {...form.register('confirm')} />
            <Button type="submit" size="lg" busy={form.formState.isSubmitting}>
              {t('accept.submit')}
            </Button>
          </form>
        )}
    </AuthShell>
  );
}

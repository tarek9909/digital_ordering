import { zodResolver } from '@hookform/resolvers/zod';
import { PLATFORM_ROLES, platformUserCreateBody, type PlatformRole } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Modal, PageShell, Pill, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorNote, FormButtons, Initials, Segmented, Table, Td } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { fmtDate } from '../lib/format';
import { useMe } from '../lib/me';
import type { PlatformUser } from '../lib/types';

// Platform users (FR-SA-12): invite, change role, disable, reset MFA (typed email + fresh MFA, TR-FE-23).

const key = ['platform-users'];

export function PlatformUsersPage() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const [resetFor, setResetFor] = useState<PlatformUser | null>(null);
  const run = useFreshMfa();
  const list = useQuery({ queryKey: key, queryFn: () => api.get<{ items: PlatformUser[] }>('/platform-users') });

  const patch = useMutation({
    mutationFn: (v: { id: string; body: { role?: PlatformRole; status?: 'active' | 'disabled' } }) => run(() => api.patch(`/platform-users/${v.id}`, v.body)),
    onSuccess: () => {
      setAnnounce(t('common:saved'));
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const roleOptions = PLATFORM_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }));

  const [inviting, setInviting] = useState(false);
  const users = list.data?.items ?? [];
  const mfaOn = me?.mfaRequired !== false;
  const noMfa = !mfaOn ? 0 : users.filter((u) => u.status === 'active' && !u.mfa_enrolled_at).length;

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.platform')}
      title={t('users.title')}
      description={t('users.description')}
      actions={
        <Button onClick={() => setInviting(true)} className="shadow-button font-bold">
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          {t('users.invite')}
        </Button>
      }
    >
      <LiveRegion toast text={announce} />
      <ErrorNote error={list.error ?? (patch.error instanceof MfaCancelled ? null : patch.error)} />

      {list.data && (
        <section aria-label={t('usersUx.summary')} className="mb-6 grid gap-3 sm:grid-cols-3">
          {PLATFORM_ROLES.map((r) => {
            const count = users.filter((u) => u.role === r && u.status !== 'disabled').length;
            return (
              <div key={r} className="flex flex-col gap-1 rounded-2xl bg-surface p-4.5 shadow-card border border-line">
                <span className="eyebrow text-xs text-muted font-bold uppercase tracking-wider">{t(`role.${r}`)}</span>
                <span className="num font-display text-2xl sm:text-3xl font-extrabold text-ink">{count}</span>
                <span className="text-xs text-muted font-medium">{t(`usersUx.roleHint.${r}`)}</span>
              </div>
            );
          })}
        </section>
      )}

      {noMfa > 0 && (
        <div className="mb-5">
          <Banner tone="warn">
            <span className="font-semibold">{t('usersUx.noMfa', { count: noMfa })}</span>
          </Banner>
        </div>
      )}

      {list.isPending ? (
        <div className="p-8 text-center">
          <Spinner label={t('common:loading')} />
        </div>
      ) : (
        list.data && (
          <Table caption={t('users.title')} head={[t('users.name'), t('users.role'), t('users.status'), ...(mfaOn ? [t('users.mfa')] : []), t('users.lastSignIn'), t('users.actions')]}>
            {users.map((u) => {
              const self = u.id === me?.platformUser.id;
              return (
                <tr key={u.id} className={u.status === 'disabled' ? 'opacity-60 bg-canvas/30' : undefined}>
                  <Td>
                    <span className="flex min-h-12 items-center gap-3">
                      <Initials name={u.name} tone={self ? 'ink' : 'soft'} />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-bold text-sm text-ink whitespace-nowrap flex items-center gap-1.5">
                          {u.name}
                          {self && (
                            <Pill tone="ink" className="text-[0.625rem] py-0 px-2">
                              {t('usersUx.you')}
                            </Pill>
                          )}
                        </span>
                        <span dir="ltr" className="self-start font-mono text-xs text-muted">
                          {u.email}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <Select
                      label={t('users.roleFor', { name: u.name })}
                      className="min-w-40 [&>label]:sr-only text-xs"
                      value={u.role}
                      disabled={self || patch.isPending}
                      options={roleOptions}
                      onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as PlatformRole } })}
                    />
                  </Td>
                  <Td>
                    <Pill tone={u.status === 'active' ? 'ok' : u.status === 'invited' ? 'info' : 'neutral'} className="text-xs">
                      {t(`users.statusValue.${u.status}`, { defaultValue: u.status })}
                    </Pill>
                  </Td>
                  {mfaOn && (
                  <Td>
                    {u.mfa_enrolled_at ? (
                      <Pill tone="ok" className="text-xs">{t('users.mfaOn')}</Pill>
                    ) : (
                      <Pill tone="warn" className="text-xs">{t('users.mfaOff')}</Pill>
                    )}
                  </Td>
                  )}
                  <Td className="whitespace-nowrap text-xs text-ink-2 font-medium">
                    {u.last_sign_in_at ? fmtDate(u.last_sign_in_at, i18n.language) : t('usersUx.never')}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {!self && (
                        <Button
                          variant="ghost"
                          size="md"
                          className="text-xs font-bold text-muted hover:text-ink"
                          disabled={patch.isPending}
                          onClick={() => patch.mutate({ id: u.id, body: { status: u.status === 'disabled' ? 'active' : 'disabled' } })}
                        >
                          {u.status === 'disabled' ? t('users.enable') : t('users.disable')}
                        </Button>
                      )}
                      {u.mfa_enrolled_at && (
                        <Button variant="ghost" size="md" className="text-xs font-bold text-danger hover:bg-danger-bg/40" onClick={() => setResetFor(u)}>
                          {t('users.resetMfa')}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )
      )}

      {inviting && (
        <Modal open onOpenChange={(o) => !o && setInviting(false)} title={t('users.invite')} description={t('usersUx.inviteIntro')}>
          <div className="pt-2">
            <InviteForm
              onCancel={() => setInviting(false)}
              onDone={() => {
                setInviting(false);
                setAnnounce(t('users.invited'));
              }}
            />
          </div>
        </Modal>
      )}

      {resetFor && (
        <ResetMfaDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => {
            setResetFor(null);
            setAnnounce(t('users.mfaResetDone'));
            void qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
    </PageShell>
  );
}

function InviteForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa();
  const [error, setError] = useState<unknown>(null);
  const form = useForm({ resolver: zodResolver(platformUserCreateBody), defaultValues: { email: '', name: '', role: 'support' as PlatformRole } });
  const role = form.watch('role');
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await run(() => api.post('/platform-users', v));
      form.reset();
      onDone();
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      if (e instanceof MfaCancelled) return;
      if (!applyFieldErrors(e, form.setError, ['email', 'name', 'role'])) setError(e);
    }
  });
  const errs = form.formState.errors;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
      <ErrorNote error={error} />
      <Field label={t('users.name')} placeholder="Full name" error={errs.name && t('form.required')} {...form.register('name')} />
      <Field label={t('common:email')} type="email" dir="ltr" placeholder="colleague@tanbeeh.io" error={errs.email && t('form.emailInvalid')} {...form.register('email')} />
      <Segmented label={t('users.role')} value={role} onChange={(r) => form.setValue('role', r)} options={PLATFORM_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
      <p className="-mt-1 text-xs text-muted bg-canvas p-2.5 rounded-xl border border-line">{t(`usersUx.roleHint.${role}`)}</p>
      <FormButtons onCancel={onCancel} busy={form.formState.isSubmitting} label={t('users.sendInvite')} />
    </form>
  );
}

const confirmSchema = z.object({ confirm: z.string().trim().min(1) });

function ResetMfaDialog({ user, onClose, onDone }: { user: PlatformUser; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const run = useFreshMfa();
  const [error, setError] = useState<unknown>(null);
  const form = useForm({ resolver: zodResolver(confirmSchema), defaultValues: { confirm: '' } });
  const submit = form.handleSubmit(async (v) => {
    if (v.confirm.toLowerCase() !== user.email.toLowerCase()) {
      form.setError('confirm', { type: 'mismatch' });
      return;
    }
    setError(null);
    try {
      await run(() => api.post(`/platform-users/${user.id}/reset-mfa`));
      onDone();
    } catch (e) {
      if (!(e instanceof MfaCancelled)) setError(e);
    }
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t('users.resetMfaTitle')} description={t('users.resetMfaBody', { email: user.email })}>
      <form onSubmit={submit} className="flex flex-col gap-4.5 pt-2" noValidate>
        <div className="rounded-xl bg-danger-bg/40 p-3.5 border border-danger/25 text-xs sm:text-sm text-danger font-medium">
          Resetting MFA will force the user to re-enroll their authenticator app on their next sign-in.
        </div>
        <ErrorNote error={error} />
        <Field
          label={t('users.typeEmail', { email: user.email })}
          dir="ltr"
          autoComplete="off"
          placeholder={user.email}
          error={form.formState.errors.confirm && t('users.emailMismatch')}
          {...form.register('confirm')}
        />
        <div className="flex flex-wrap justify-end gap-2.5 pt-2 border-t border-line/60">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="danger" className="font-bold shadow-button" busy={form.formState.isSubmitting}>
            {t('users.resetMfa')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

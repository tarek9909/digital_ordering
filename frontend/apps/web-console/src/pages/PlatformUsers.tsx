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
  // Role and status changes need a recent second factor (L-6); run() asks for it when the server says so.
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
  const noMfa = users.filter((u) => u.status === 'active' && !u.mfa_enrolled_at).length;

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.platform')}
      title={t('users.title')}
      description={t('users.description')}
      actions={
        <Button onClick={() => setInviting(true)}>
          <span aria-hidden="true">+</span>
          {t('users.invite')}
        </Button>
      }
    >
      <LiveRegion text={announce} />
      <ErrorNote error={list.error ?? (patch.error instanceof MfaCancelled ? null : patch.error)} />
      {list.data && (
        <section aria-label={t('usersUx.summary')} className="mb-6 grid gap-3 sm:grid-cols-3">
          {PLATFORM_ROLES.map((r) => (
            <div key={r} className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface p-4 shadow-card">
              <span className="eyebrow">{t(`role.${r}`)}</span>
              <span className="num font-display text-2xl font-extrabold tracking-tight">{users.filter((u) => u.role === r && u.status !== 'disabled').length}</span>
              <span className="text-xs text-muted">{t(`usersUx.roleHint.${r}`)}</span>
            </div>
          ))}
        </section>
      )}
      {noMfa > 0 && (
        <div className="mb-4">
          <Banner tone="warn">{t('usersUx.noMfa', { count: noMfa })}</Banner>
        </div>
      )}
      {list.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        list.data && (
          <Table caption={t('users.title')} head={[t('users.name'), t('users.role'), t('users.status'), t('users.mfa'), t('users.lastSignIn'), t('users.actions')]}>
            {users.map((u) => {
              const self = u.id === me?.platformUser.id;
              return (
                <tr key={u.id} className={u.status === 'disabled' ? 'opacity-60' : undefined}>
                  <Td>
                    <span className="flex min-h-12 items-center gap-3">
                      <Initials name={u.name} tone={self ? 'ink' : 'soft'} />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold whitespace-nowrap">
                          {u.name}
                          {self && (
                            <Pill tone="ink" className="ms-2">
                              {t('usersUx.you')}
                            </Pill>
                          )}
                        </span>
                        <span dir="ltr" className="self-start text-sm text-muted">
                          {u.email}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <Select
                      label={t('users.roleFor', { name: u.name })}
                      className="min-w-40 [&>label]:sr-only"
                      value={u.role}
                      disabled={self || patch.isPending}
                      options={roleOptions}
                      onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as PlatformRole } })}
                    />
                  </Td>
                  <Td>
                    <Pill tone={u.status === 'active' ? 'ok' : u.status === 'invited' ? 'info' : 'neutral'}>{t(`users.statusValue.${u.status}`, { defaultValue: u.status })}</Pill>
                  </Td>
                  <Td>{u.mfa_enrolled_at ? <Pill tone="ok">{t('users.mfaOn')}</Pill> : <Pill tone="warn">{t('users.mfaOff')}</Pill>}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{u.last_sign_in_at ? fmtDate(u.last_sign_in_at, i18n.language) : t('usersUx.never')}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {!self && (
                        <Button
                          variant="ghost"
                          className="text-sm"
                          disabled={patch.isPending}
                          onClick={() => patch.mutate({ id: u.id, body: { status: u.status === 'disabled' ? 'active' : 'disabled' } })}
                        >
                          {u.status === 'disabled' ? t('users.enable') : t('users.disable')}
                        </Button>
                      )}
                      {u.mfa_enrolled_at && (
                        <Button variant="ghost" className="text-sm text-danger" onClick={() => setResetFor(u)}>
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
          <InviteForm
            onCancel={() => setInviting(false)}
            onDone={() => {
              setInviting(false);
              setAnnounce(t('users.invited'));
            }}
          />
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
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <Field label={t('users.name')} error={errs.name && t('form.required')} {...form.register('name')} />
      <Field label={t('common:email')} type="email" dir="ltr" error={errs.email && t('form.emailInvalid')} {...form.register('email')} />
      <Segmented label={t('users.role')} value={role} onChange={(r) => form.setValue('role', r)} options={PLATFORM_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
      <p className="-mt-2 text-sm text-muted">{t(`usersUx.roleHint.${role}`)}</p>
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
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <ErrorNote error={error} />
        <Field
          label={t('users.typeEmail', { email: user.email })}
          dir="ltr"
          autoComplete="off"
          error={form.formState.errors.confirm && t('users.emailMismatch')}
          {...form.register('confirm')}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
            {t('users.resetMfa')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

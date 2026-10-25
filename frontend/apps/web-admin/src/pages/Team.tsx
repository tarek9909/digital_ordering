import { formatDateTime } from '@dop/client-sdk';
import { memberCreateBody, ownershipTransferBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Modal, Select } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AddDialog, ConfirmButton, DialogActions, ErrorNote, TabPanel, QueryView, Section, SectionTabs, StatusPill, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import { meKey, useMe } from '../lib/me';
import type { Member, TeamList } from '../lib/types';

const teamKey = ['team'] as const;
const transferForm = ownershipTransferBody.pick({ password: true });

/** The owner creates the account and hands the email and password over in person; nothing is emailed. */
function AddMemberForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const empty = { name: '', email: '', password: '', role: 'manager' as const };
  const form = useForm({
    resolver: zodResolver(memberCreateBody),
    defaultValues: empty,
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      await api.post('/members', body);
      await qc.invalidateQueries({ queryKey: teamKey });
      onDone();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'email', 'password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t('team.name')} autoComplete="off" error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Field type="email" dir="ltr" autoComplete="off" label={t('common:email')} error={errors.email ? t('form.email') : undefined} {...form.register('email')} />
      <Field
        type="password"
        autoComplete="new-password"
        label={t('team.password')}
        hint={t('team.passwordHint')}
        error={errors.password ? (errors.password.type === 'server' ? errors.password.message : t('team.passwordHint')) : undefined}
        {...form.register('password')}
      />
      <Select label={t('team.role')} options={[{ value: 'manager', label: t('roles.manager') }]} {...form.register('role')} />
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      <DialogActions onCancel={onDone} submitLabel={t('team.add')} busy={isSubmitting} />
    </form>
  );
}

function TransferDialog({ member }: { member: Member }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(transferForm),
    defaultValues: { password: '' },
  });
  const submit = form.handleSubmit(async ({ password }) => {
    try {
      await api.post('/ownership-transfer', { memberId: member.id, password });
      setOpen(false);
      await Promise.all([qc.invalidateQueries({ queryKey: teamKey }), qc.invalidateQueries({ queryKey: meKey })]);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <>
      <Button variant="secondary" onClick={() => (form.reset(), setOpen(true))}>
        {t('team.transfer')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('team.transferTitle', { name: member.name })} description={t('team.transferBody')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            type="password"
            autoComplete="current-password"
            label={t('team.yourPassword')}
            error={form.formState.errors.password ? t('form.required') : undefined}
            {...form.register('password')}
          />
          {form.formState.errors.root && <Banner tone="danger">{form.formState.errors.root.message}</Banner>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
              {t('team.transfer')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function TeamPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const me = useMe().data;
  const isOwner = me?.currentRole === 'owner';
  const q = useQuery({
    queryKey: teamKey,
    queryFn: () => api.get<TeamList>('/members'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKey }),
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKey }),
  });

  return (
    <TabPanel
      description={t('team.description')}
      actions={
        isOwner && (
          <AddDialog label={t('team.add')} title={t('team.addTitle')} description={t('team.addHint')}>
            {(close) => <AddMemberForm onDone={close} />}
          </AddDialog>
        )
      }
    >
      <ErrorNote error={revoke.error ?? removeMember.error} />
      <QueryView q={q} skeleton="table">
        {(team) => (
          <SectionTabs
            label={t('team.description')}
            idPrefix="team"
            base="/team"
            sections={[
              {
                key: 'members',
                label: t('team.members'),
                node: (
            <Section title={t('team.members')}>
              <Table caption={t('team.members')} head={[t('team.name'), t('common:email'), t('team.role'), t('team.mfa'), t('team.since'), '']}>
                {team.members.map((m) => (
                  <tr key={m.id}>
                    <Td className="font-semibold whitespace-nowrap">{m.name}</Td>
                    <Td>
                      <span dir="ltr" className="text-ink-2">
                        {m.email}
                      </span>
                    </Td>
                    <Td>
                      <StatusPill tone={m.role === 'owner' ? 'ink' : 'neutral'}>{t(`roles.${m.role}`)}</StatusPill>
                    </Td>
                    <Td>{m.mfa ? <StatusPill tone="ok">{t('team.mfaOn')}</StatusPill> : <StatusPill tone="warn">{t('team.mfaOff')}</StatusPill>}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(m.since, i18n.language)}</Td>
                    <Td className="text-end">
                      {isOwner && m.role !== 'owner' && (
                        <div className="flex justify-end gap-2">
                          <TransferDialog member={m} />
                          <ConfirmButton
                            label={t('team.remove')}
                            title={t('team.removeTitle', { name: m.name })}
                            description={t('team.removeBody')}
                            confirmLabel={t('team.remove')}
                            variant="danger"
                            busy={removeMember.isPending && removeMember.variables === m.id}
                            onConfirm={() => removeMember.mutateAsync(m.id).catch(() => undefined)}
                          />
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Section>
                ),
              },
              // Members are added directly now; invitations sent before that can still be revoked.
              team.invitations.length > 0 && {
                key: 'invitations',
                label: t('team.invitations'),
                node: (
              <Section title={t('team.invitations')}>
                <Table caption={t('team.invitations')} head={[t('common:email'), t('team.role'), t('team.expires'), '']}>
                  {team.invitations.map((inv) => (
                    <tr key={inv.id}>
                      <Td>
                        <span dir="ltr" className="font-semibold">
                          {inv.email}
                        </span>
                      </Td>
                      <Td>
                        <StatusPill tone="neutral">{t(`roles.${inv.role}`)}</StatusPill>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-2">{formatDateTime(inv.expiresAt, i18n.language)}</Td>
                      <Td className="text-end">
                        <Button variant="secondary" busy={revoke.isPending && revoke.variables === inv.id} onClick={() => revoke.mutate(inv.id)}>
                          {t('team.revoke')}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </Section>
                ),
              },
            ]}
          />
        )}
      </QueryView>
      <LiveRegion toast text={removeMember.isSuccess ? t('team.removed') : revoke.isSuccess ? t('team.revoked') : ''} />
    </TabPanel>
  );
}

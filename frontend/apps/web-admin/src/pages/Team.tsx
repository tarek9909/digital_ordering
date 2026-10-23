import { formatDateTime } from '@dop/client-sdk';
import { invitationBody, ownershipTransferBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, EmptyState, Field, LiveRegion, Modal } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmButton, ErrorNote, Page, QueryView, Section, StatusPill, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import { meKey, useMe } from '../lib/me';
import type { Member, TeamList } from '../lib/types';

const teamKey = ['team'] as const;
const transferForm = ownershipTransferBody.pick({ password: true });

function InviteForm() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(invitationBody),
    defaultValues: { email: '', role: 'manager' as const },
  });
  const [sent, setSent] = useState<string | null>(null);
  const submit = form.handleSubmit(async (body) => {
    setSent(null);
    try {
      await api.post('/invitations', body);
      setSent(body.email);
      form.reset({ email: '', role: 'manager' });
      await qc.invalidateQueries({ queryKey: teamKey });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['email'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-3" noValidate>
      <Field className="min-w-64 flex-1" type="email" label={t('team.inviteEmail')} error={form.formState.errors.email ? t('form.email') : undefined} {...form.register('email')} />
      <div className="sm:pt-7">
        <Button type="submit" busy={form.formState.isSubmitting}>
          {t('team.invite')}
        </Button>
      </div>
      {form.formState.errors.root && (
        <div className="w-full">
          <Banner tone="danger">{form.formState.errors.root.message}</Banner>
        </div>
      )}
      {sent && (
        <div className="w-full">
          <Banner tone="ok">{t('team.invited', { email: sent })}</Banner>
        </div>
      )}
      <LiveRegion text={sent ? t('team.invited', { email: sent }) : ''} />
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
          <div className="flex justify-end gap-3">
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
    <Page title={t('nav.team')} description={t('team.description')}>
      <Section title={t('team.inviteTitle')} description={t('team.inviteHint')}>
        <InviteForm />
      </Section>
      <ErrorNote error={revoke.error ?? removeMember.error} />
      <QueryView q={q} skeleton="table">
        {(team) => (
          <>
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
            <Section title={t('team.invitations')}>
              {team.invitations.length === 0 ? (
                <EmptyState title={t('team.noInvitations')}>{t('team.noInvitationsBody')}</EmptyState>
              ) : (
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
              )}
            </Section>
          </>
        )}
      </QueryView>
      <LiveRegion text={removeMember.isSuccess ? t('team.removed') : revoke.isSuccess ? t('team.revoked') : ''} />
    </Page>
  );
}

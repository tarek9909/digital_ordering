import { useTranslation } from '@dop/i18n';
import { EmptyState, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import type { StaffMember } from '../lib/types';
import { AddDialog, ConfirmButton, DialogActions, ErrorNote, QueryView, Section, StatusPill, Table, Td } from './common';

// Named staff (R2, FR-ACC-07): each person gets a personal 4–6 digit PIN; the board asks for it before actions.

const memberSchema = z.object({
  name: z.string().trim().min(1).max(60),
  pin: z.string().regex(/^\d{4,6}$/),
});

function AddMember({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const form = useForm({
    resolver: zodResolver(memberSchema),
    defaultValues: { name: '', pin: '' },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    setError(null);
    try {
      await api.post(`/venues/${venueId}/staff-members`, body);
      await qc.invalidateQueries({ queryKey: ['staff-members', venueId] });
      onDone();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'pin'])) setError(e);
    }
  });
  const pinError = errors.pin
    ? errors.pin.type === 'server' && errors.pin.message === 'weak'
      ? t('staff.pinWeak')
      : errors.pin.type === 'server' && errors.pin.message === 'taken'
        ? t('staffMembers.pinTaken')
        : t('staff.pinFormat')
    : undefined;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t('staffMembers.name')} autoComplete="off" error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Field
        className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
        label={t('staffMembers.pin')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        dir="ltr"
        hint={t('staff.pinHint')}
        error={pinError}
        {...form.register('pin')}
      />
      <ErrorNote error={error} />
      <DialogActions onCancel={onDone} submitLabel={t('staffMembers.add')} busy={form.formState.isSubmitting} variant="ink" />
    </form>
  );
}

export function StaffMembers({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['staff-members', venueId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: StaffMember[] }>(`/venues/${venueId}/staff-members`)).items,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <Section
      title={t('staffMembers.title')}
      description={t('staffMembers.hint')}
      actions={
        <AddDialog label={t('staffMembers.add')} title={t('staffMembers.title')} description={t('staffMembers.hint')}>
          {(close) => <AddMember venueId={venueId} onDone={close} />}
        </AddDialog>
      }
    >
      <div>
        <ErrorNote error={deactivate.error} />
        <QueryView q={q} skeleton="table">
          {(items) =>
            items.length === 0 ? (
              <EmptyState title={t('staffMembers.none')}>{t('staffMembers.noneBody')}</EmptyState>
            ) : (
              <Table caption={t('staffMembers.title')} head={[t('staffMembers.name'), t('staffMembers.status'), '']}>
                {items.map((m) => (
                  <tr key={m.id}>
                    <Td className="font-semibold">{m.name}</Td>
                    <Td>{m.active ? <StatusPill tone="ok">{t('staffMembers.active')}</StatusPill> : <StatusPill tone="neutral">{t('staffMembers.inactive')}</StatusPill>}</Td>
                    <Td className="text-end">
                      {m.active && (
                        <ConfirmButton
                          label={t('staffMembers.deactivate')}
                          title={t('staffMembers.deactivateTitle', {
                            name: m.name,
                          })}
                          description={t('staffMembers.deactivateBody')}
                          confirmLabel={t('staffMembers.deactivate')}
                          variant="danger"
                          busy={deactivate.isPending && deactivate.variables === m.id}
                          onConfirm={() => deactivate.mutateAsync(m.id).catch(() => undefined)}
                        />
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )
          }
        </QueryView>
      </div>
      <LiveRegion text={deactivate.isSuccess ? t('staffMembers.deactivated') : ''} />
    </Section>
  );
}

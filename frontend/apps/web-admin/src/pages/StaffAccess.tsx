import { formatDateTime } from '@dop/client-sdk';
import { staffPinBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmButton, CopyButton, ErrorNote, QueryView, Section, Table, Td } from '../components/common';
import { StaffMembers } from '../components/StaffMembers';
import { api } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import type { Device, StaffAccess } from '../lib/types';
import { useRole } from '../lib/me';
import { useCurrentVenueId } from '../lib/venue';

function PinForm({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(staffPinBody), defaultValues: { pin: '' } });
  const { errors, isSubmitting } = form.formState;
  const save = useMutation({
    mutationFn: (pin: string) => api.put(`/venues/${venueId}/staff-access/pin`, { pin }),
    onSuccess: () => {
      form.reset({ pin: '' });
      void qc.invalidateQueries({ queryKey: ['staff-access', venueId] });
      void qc.invalidateQueries({ queryKey: ['devices', venueId] });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  const submit = form.handleSubmit(async ({ pin }) => {
    setError(null);
    try {
      await save.mutateAsync(pin);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['pin'])) setError(errorText(t, e));
    }
  });
  const pinError = errors.pin ? (errors.pin.type === 'server' && errors.pin.message === 'weak' ? t('staff.pinWeak') : t('staff.pinFormat')) : undefined;
  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3" noValidate>
      <Field label={t('staff.newPin')} inputMode="numeric" autoComplete="off" maxLength={6} dir="ltr" hint={t('staff.pinHint')} error={pinError} {...form.register('pin')} />
      <p className="text-sm text-muted">{t('staff.pinSignsOut')}</p>
      {error && <Banner tone="danger">{error}</Banner>}
      <div>
        <Button type="submit" busy={isSubmitting}>
          {t('staff.changePin')}
        </Button>
      </div>
      <LiveRegion text={save.isSuccess ? t('staff.pinChanged') : ''} />
    </form>
  );
}

function Devices({ venueId }: { venueId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices', venueId], queryFn: async () => (await api.get<{ items: Device[] }>(`/venues/${venueId}/devices`)).items, refetchInterval: 60_000 });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices', venueId] }),
  });
  return (
    <Section title={t('staff.devices')} description={t('staff.devicesHint')}>
      <ErrorNote error={remove.error} />
      <QueryView q={q}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-muted">{t('staff.noDevices')}</p>
          ) : (
            <Table caption={t('staff.devices')} head={[t('staff.deviceName'), t('staff.mode'), t('staff.lastSeen'), t('staff.added'), '']}>
              {items.map((d) => (
                <tr key={d.id}>
                  <Td>{d.name}</Td>
                  <Td>{t(`staff.modes.${d.mode}`, { defaultValue: d.mode })}</Td>
                  <Td>{formatDateTime(d.lastSeenAt, i18n.language)}</Td>
                  <Td>{formatDateTime(d.createdAt, i18n.language)}</Td>
                  <Td>
                    <ConfirmButton
                      label={t('staff.remove')}
                      title={t('staff.removeTitle', { name: d.name })}
                      description={t('staff.removeBody')}
                      confirmLabel={t('staff.remove')}
                      variant="danger"
                      busy={remove.isPending && remove.variables === d.id}
                      onConfirm={() => remove.mutateAsync(d.id).catch(() => undefined)}
                    />
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }
      </QueryView>
      <LiveRegion text={remove.isSuccess ? t('staff.removed') : ''} />
    </Section>
  );
}

export function StaffAccessPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const venueId = useCurrentVenueId();
  // A support session manages devices but never sees the staff link or sets the PIN (M-13).
  const support = useRole() === 'support';
  const q = useQuery({ queryKey: ['staff-access', venueId], queryFn: () => api.get<StaffAccess>(`/venues/${venueId}/staff-access`), enabled: Boolean(venueId) && !support });
  const rotate = useMutation({
    mutationFn: () => api.post<StaffAccess>(`/venues/${venueId}/staff-access/rotate-link`),
    onSuccess: (s) => {
      qc.setQueryData(['staff-access', venueId], s);
      void qc.invalidateQueries({ queryKey: ['devices', venueId] });
    },
  });
  if (!venueId) return null;
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.staff')}</h1>
      {support ? (
        <Banner tone="info">{t('staff.supportNoCredentials')}</Banner>
      ) : (
        <>
      <Section title={t('staff.linkTitle')} description={t('staff.linkHint')}>
        <QueryView q={q}>
          {(s) => (
            <div className="flex flex-wrap items-start gap-6">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={s.link} size={180} role="img" aria-label={t('staff.qrLabel')} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <code dir="ltr" className="block rounded bg-canvas p-3 text-sm break-all">
                  {s.link}
                </code>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={s.link} label={t('staff.copy')} />
                  <ConfirmButton
                    label={t('staff.rotate')}
                    title={t('staff.rotateTitle')}
                    description={t('staff.rotateBody')}
                    confirmLabel={t('staff.rotate')}
                    variant="danger"
                    busy={rotate.isPending}
                    onConfirm={() => rotate.mutateAsync().catch(() => undefined)}
                  />
                </div>
                <p className="text-sm text-muted">
                  {t('staff.rotatedAt', { date: formatDateTime(s.keyRotatedAt, i18n.language) })} · {t('staff.pinChangedAt', { date: formatDateTime(s.pinChangedAt, i18n.language) })}
                </p>
                {rotate.error && <Banner tone="danger">{errorText(t, rotate.error)}</Banner>}
                <LiveRegion text={rotate.isSuccess ? t('staff.rotated') : ''} />
              </div>
            </div>
          )}
        </QueryView>
      </Section>
      <Section title={t('staff.pinTitle')}>
        <PinForm venueId={venueId} />
      </Section>
        </>
      )}
      <Devices venueId={venueId} />
      <StaffMembers venueId={venueId} />
    </>
  );
}

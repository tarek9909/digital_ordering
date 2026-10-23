import { formatDateTime } from '@dop/client-sdk';
import { staffPinBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, EmptyState, Field, LiveRegion, Modal } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmButton, CopyButton, DialogActions, ErrorNote, TabPanel, QueryView, Section, SectionTabs, StatusPill, Table, Td } from '../components/common';
import { StaffMembers } from '../components/StaffMembers';
import { api } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import type { Device, StaffAccess } from '../lib/types';
import { useRole } from '../lib/me';
import { useCurrentVenueId } from '../lib/venue';

function PinForm({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(staffPinBody),
    defaultValues: { pin: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const save = useMutation({
    mutationFn: (pin: string) => api.put(`/venues/${venueId}/staff-access/pin`, { pin }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-access', venueId] });
      void qc.invalidateQueries({ queryKey: ['devices', venueId] });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  const submit = form.handleSubmit(async ({ pin }) => {
    setError(null);
    try {
      await save.mutateAsync(pin);
      onDone();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['pin'])) setError(errorText(t, e));
    }
  });
  const pinError = errors.pin ? (errors.pin.type === 'server' && errors.pin.message === 'weak' ? t('staff.pinWeak') : t('staff.pinFormat')) : undefined;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label={t('staff.newPin')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        dir="ltr"
        className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
        hint={t('staff.pinHint')}
        error={pinError}
        {...form.register('pin')}
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <DialogActions onCancel={onDone} submitLabel={t('staff.changePin')} busy={isSubmitting} variant="ink" />
    </form>
  );
}

/** The PIN is changed from a pop-up beside the link, so the page has one block fewer. */
function PinDialog({ venueId }: { venueId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('staff.changePin')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('staff.pinTitle')} description={t('staff.pinSignsOut')}>
        <PinForm venueId={venueId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function Devices({ venueId }: { venueId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['devices', venueId],
    queryFn: async () => (await api.get<{ items: Device[] }>(`/venues/${venueId}/devices`)).items,
    refetchInterval: 60_000,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices', venueId] }),
  });
  return (
    <Section title={t('staff.devices')} description={t('staff.devicesHint')}>
      <ErrorNote error={remove.error} />
      <QueryView q={q} skeleton="table">
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('staff.noDevices')}>{t('staff.noDevicesBody')}</EmptyState>
          ) : (
            <Table caption={t('staff.devices')} head={[t('staff.deviceName'), t('staff.mode'), t('staff.lastSeen'), t('staff.added'), '']}>
              {items.map((d) => (
                <tr key={d.id}>
                  <Td className="font-semibold">{d.name}</Td>
                  <Td>
                    <StatusPill tone="neutral">{t(`staff.modes.${d.mode}`, { defaultValue: d.mode })}</StatusPill>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(d.lastSeenAt, i18n.language)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(d.createdAt, i18n.language)}</Td>
                  <Td className="text-end">
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
  const q = useQuery({
    queryKey: ['staff-access', venueId],
    queryFn: () => api.get<StaffAccess>(`/venues/${venueId}/staff-access`),
    enabled: Boolean(venueId) && !support,
  });
  const rotate = useMutation({
    mutationFn: () => api.post<StaffAccess>(`/venues/${venueId}/staff-access/rotate-link`),
    onSuccess: (s) => {
      qc.setQueryData(['staff-access', venueId], s);
      void qc.invalidateQueries({ queryKey: ['devices', venueId] });
    },
  });
  if (!venueId) return null;
  return (
    <TabPanel description={t('staff.description')}>
      {support ? (
        <div className="mb-5">
          <Banner tone="info">{t('staff.supportNoCredentials')}</Banner>
        </div>
      ) : null}
      <SectionTabs
        label={t('staff.description')}
        idPrefix="staff"
        sections={[
          !support && {
            key: 'link',
            label: t('staff.linkTitle'),
            node: (
          <Section title={t('staff.linkTitle')} description={t('staff.linkHint')}>
            <QueryView q={q}>
              {(s) => (
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                  {/* The QR is what a tablet scans, so it leads. */}
                  <div className="w-fit shrink-0 rounded-[var(--radius-card)] bg-surface p-4 shadow-card ring-1 ring-line">
                    <QRCodeSVG value={s.link} size={176} role="img" aria-label={t('staff.qrLabel')} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <code dir="ltr" className="block rounded-input bg-canvas p-3.5 font-mono text-sm break-all text-ink-2 ring-1 ring-line">
                      {s.link}
                    </code>
                    <div className="flex flex-wrap gap-2">
                      <CopyButton text={s.link} label={t('staff.copy')} variant="primary" />
                      <PinDialog venueId={venueId} />
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
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <div className="flex flex-col gap-0.5">
                        <dt className="eyebrow">{t('staff.rotatedLabel')}</dt>
                        <dd className="text-ink-2">{formatDateTime(s.keyRotatedAt, i18n.language)}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="eyebrow">{t('staff.pinChangedLabel')}</dt>
                        <dd className="text-ink-2">{formatDateTime(s.pinChangedAt, i18n.language)}</dd>
                      </div>
                    </dl>
                    {rotate.error && <Banner tone="danger">{errorText(t, rotate.error)}</Banner>}
                    <LiveRegion text={rotate.isSuccess ? t('staff.rotated') : ''} />
                  </div>
                </div>
              )}
            </QueryView>
          </Section>
            ),
          },
          { key: 'devices', label: t('staff.devices'), node: <Devices venueId={venueId} /> },
          { key: 'members', label: t('staffMembers.title'), node: <StaffMembers venueId={venueId} /> },
        ]}
      />
    </TabPanel>
  );
}

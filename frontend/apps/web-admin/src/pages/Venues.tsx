import { useTranslation } from '@dop/i18n';
import { Button, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmButton, ErrorNote, QueryView, Section, StatusPill, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors, isCode } from '../lib/errors';
import { useRole } from '../lib/me';
import { useCurrentVenueId, useVenues, useVenueStore, venuesKey } from '../lib/venue';
import { staffBoardUrl } from './Home';

// Venues (multi-site, FR-TEN-07/10, TR-FE-26): add (plan limit / feature checked by the API), archive (owner;
// open tickets must be closed first), open the staff board per venue.

const venueCreate = z.object({ name: z.string().trim().min(1).max(120) });

function AddVenue() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setVenue = useVenueStore((s) => s.setVenueId);
  const [error, setError] = useState<unknown>(null);
  const form = useForm({ resolver: zodResolver(venueCreate), defaultValues: { name: '' } });
  const submit = form.handleSubmit(async ({ name }) => {
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/venues', { name });
      form.reset({ name: '' });
      await qc.invalidateQueries({ queryKey: venuesKey });
      setVenue(r.id);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) setError(e);
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
      <Field className="min-w-60 flex-1" label={t('venues.name')} error={form.formState.errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Button type="submit" busy={form.formState.isSubmitting}>
        {t('venues.add')}
      </Button>
      <div className="w-full">
        <ErrorNote error={error} />
      </div>
      <LiveRegion text={form.formState.isSubmitSuccessful && !error ? t('venues.added') : ''} />
    </form>
  );
}

export function VenuesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = useRole();
  const isOwner = role === 'owner';
  const q = useVenues();
  const current = useCurrentVenueId();
  const setVenue = useVenueStore((s) => s.setVenueId);
  const archive = useMutation({ mutationFn: (id: string) => api.post(`/venues/${id}/archive`), onSuccess: () => qc.invalidateQueries({ queryKey: venuesKey }) });
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">{t('nav.venues')}</h1>
      {/* A venue changes what the tenant pays, so only the owner adds one (M-9). */}
      {isOwner && (
        <Section title={t('venues.addTitle')} description={t('venues.addHint')}>
          <AddVenue />
        </Section>
      )}
      {isCode(archive.error, 'INVALID_TRANSITION') ? <p className="mb-2 font-semibold text-danger">{t('venues.archiveOpenTickets')}</p> : <ErrorNote error={archive.error} />}
      <QueryView q={q}>
        {(items) => (
          <Table caption={t('nav.venues')} head={[t('venues.name'), t('venues.code'), '', '']}>
            {items.map((v) => (
              <tr key={v.id}>
                <Td className="font-medium">
                  {v.name} {v.id === current && <StatusPill tone="info">{t('venues.selected')}</StatusPill>}
                </Td>
                <Td>
                  <span dir="ltr" className="font-mono">
                    {v.venue_code}
                  </span>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {v.id !== current && (
                      <Button variant="secondary" onClick={() => setVenue(v.id)}>
                        {t('venues.manage')}
                      </Button>
                    )}
                    <a className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 font-semibold text-on-primary" href={staffBoardUrl(v.id)}>
                      {t('onboarding.openBoard')}
                    </a>
                  </div>
                </Td>
                <Td>
                  {isOwner && items.length > 1 && (
                    <ConfirmButton
                      label={t('venues.archive')}
                      title={t('venues.archiveTitle', { name: v.name })}
                      description={t('venues.archiveBody')}
                      confirmLabel={t('venues.archive')}
                      variant="danger"
                      busy={archive.isPending && archive.variables === v.id}
                      onConfirm={() => archive.mutateAsync(v.id).catch(() => undefined)}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryView>
      <p className="mt-3 text-sm text-muted">{t('venues.billingNote')}</p>
      <LiveRegion text={archive.isSuccess ? t('venues.archived') : ''} />
    </>
  );
}

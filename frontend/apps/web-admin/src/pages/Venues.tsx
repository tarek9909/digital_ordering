import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion } from '@dop/ui';
import { Link } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AddDialog, ConfirmButton, DialogActions, ErrorNote, Page, QueryView, StatusPill, Table, Td, linkClass } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors, isCode } from '../lib/errors';
import { useRole } from '../lib/me';
import { useCurrentVenueId, useVenues, useVenueStore, venuesKey } from '../lib/venue';
import { staffBoardUrl } from './Home';

// Venues (multi-site, FR-TEN-07/10, TR-FE-26): add (plan limit / feature checked by the API), archive (owner;
// open tickets must be closed first), open the staff board per venue.

const venueCreate = z.object({ name: z.string().trim().min(1).max(120) });

function AddVenue({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setVenue = useVenueStore((s) => s.setVenueId);
  const [error, setError] = useState<unknown>(null);
  const form = useForm({
    resolver: zodResolver(venueCreate),
    defaultValues: { name: '' },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/venues', { name });
      await qc.invalidateQueries({ queryKey: venuesKey });
      setVenue(r.id);
      onDone();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) setError(e);
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t('venues.name')} error={form.formState.errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <ErrorNote error={error} />
      <DialogActions onCancel={onDone} submitLabel={t('venues.add')} busy={form.formState.isSubmitting} />
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
  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/venues/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: venuesKey }),
  });
  return (
    <Page
      title={t('nav.venues')}
      description={t('venues.description')}
      actions={
        <>
          <Link to="/venue" className={linkClass('secondary')}>
            {t('venues.settings')}
          </Link>
          {/* A venue changes what the tenant pays, so only the owner adds one (M-9). */}
          {isOwner && (
            <AddDialog label={t('venues.add')} title={t('venues.addTitle')} description={t('venues.addHint')}>
              {(close) => <AddVenue onDone={close} />}
            </AddDialog>
          )}
        </>
      }
    >
      {isCode(archive.error, 'INVALID_TRANSITION') ? (
        <p role="alert" className="mb-3 font-semibold text-danger">
          {t('venues.archiveOpenTickets')}
        </p>
      ) : (
        <div className="mb-3 empty:hidden">
          <ErrorNote error={archive.error} />
        </div>
      )}
      <QueryView q={q} skeleton="table">
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('venues.none')}>{t('venues.addHint')}</EmptyState>
          ) : (
            <Table raised caption={t('nav.venues')} head={[t('venues.name'), t('venues.code'), '', '']}>
              {items.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {v.name} {v.id === current && <StatusPill tone="ok">{t('venues.selected')}</StatusPill>}
                    </span>
                  </Td>
                  <Td>
                    <span dir="ltr" className="font-mono text-xs whitespace-nowrap text-muted">
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
                      <a className={linkClass('ghost')} href={staffBoardUrl(v.id)}>
                        {t('onboarding.openBoard')}
                      </a>
                    </div>
                  </Td>
                  <Td className="text-end">
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
          )
        }
      </QueryView>
      <p className="mt-4 flex items-start gap-2 text-sm text-muted">
        <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted/60" />
        {t('venues.billingNote')}
      </p>
      <LiveRegion text={archive.isSuccess ? t('venues.archived') : ''} />
    </Page>
  );
}

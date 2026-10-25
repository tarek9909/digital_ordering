import { venuePatch } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../lib/api';
import { applyFieldErrors, errorText } from '../../lib/errors';
import type { VenueAdmin } from '../../lib/types';
import { venueKey } from '../../lib/venue';
import { CustomerPreview } from './CustomerPreview';

const colourSchema = venuePatch.pick({ brandColor: true }).required();
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Client-side check before upload; the server checks again (UPLOAD_INVALID). */
export function logoProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!LOGO_TYPES.includes(file.type)) return 'type';
  if (file.size > LOGO_MAX_BYTES) return 'size';
  return null;
}

function LogoUpload({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<unknown>(`/venues/${venue.id}/logo`, file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: venueKey(venue.id) });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="logo" className="text-sm font-semibold text-ink-2">
        {t('venue.branding.logo')}
      </label>
      <input
        id="logo"
        type="file"
        accept={LOGO_TYPES.join(',')}
        aria-describedby="logo-hint"
        className="min-h-12 rounded-input border border-dashed border-line bg-canvas p-2 text-sm file:me-3 file:min-h-10 file:cursor-pointer file:rounded-control file:border-0 file:bg-panel file:px-4 file:font-semibold file:text-white hover:border-ink-2/30"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const p = logoProblem(file);
          setProblem(p ? t(`venue.branding.logoProblem.${p}`) : null);
          if (!p) upload.mutate(file);
        }}
      />
      <p id="logo-hint" className="text-sm text-muted">
        {t('venue.branding.logoHint')}
      </p>
      {upload.isPending && <p role="status">{t('venue.branding.uploading')}</p>}
      {problem && <Banner tone="danger">{problem}</Banner>}
      {upload.error && <Banner tone="danger">{errorText(t, upload.error)}</Banner>}
      <LiveRegion toast text={upload.isSuccess ? t('venue.branding.uploaded') : ''} />
    </div>
  );
}

export function BrandingForm({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(colourSchema),
    defaultValues: { brandColor: venue.brandColor },
  });
  const colour = form.watch('brandColor');
  const { errors, isSubmitting, isDirty } = form.formState;
  const save = useMutation({
    mutationFn: (brandColor: string) => api.patch<VenueAdmin>(`/venues/${venue.id}`, { brandColor }),
    onSuccess: (v) => {
      qc.setQueryData(venueKey(venue.id), v);
      form.reset({ brandColor: v.brandColor });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  const submit = form.handleSubmit(async ({ brandColor }) => {
    setError(null);
    try {
      await save.mutateAsync(brandColor);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['brandColor'])) setError(errorText(t, e));
    }
  });
  const primary = venue.locales[0] ?? 'ar';

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* min-w-0: the file and text inputs shrink to a 320px phone instead of widening the column. */}
      <div className="flex min-w-0 flex-col gap-6">
        <LogoUpload venue={venue} />
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="colour-pick" className="text-sm font-semibold text-ink-2">
                {t('venue.branding.pick')}
              </label>
              <input
                id="colour-pick"
                type="color"
                className="h-12 w-16 cursor-pointer rounded-input border border-line bg-surface p-1"
                value={/^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : '#1F6FEB'}
                onChange={(e) =>
                  form.setValue('brandColor', e.target.value.toUpperCase(), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </div>
            <Field className="min-w-0 flex-1" label={t('venue.branding.colour')} dir="ltr" error={errors.brandColor ? t('venue.branding.colourInvalid') : undefined} {...form.register('brandColor')} />
          </div>
          <p className="text-sm text-muted">{t('venue.branding.contrastNote')}</p>
          {error && <Banner tone="danger">{error}</Banner>}
          <div>
            <Button type="submit" busy={isSubmitting} disabled={!isDirty}>
              {t('common:save')}
            </Button>
          </div>
          <LiveRegion toast text={save.isSuccess && !isDirty ? t('common:saved') : ''} />
        </form>
      </div>
      <CustomerPreview name={venue.name} brandColor={colour} logoUrl={venue.logoUrl} welcome={venue.messages[primary]?.welcome} locale={primary} />
    </div>
  );
}

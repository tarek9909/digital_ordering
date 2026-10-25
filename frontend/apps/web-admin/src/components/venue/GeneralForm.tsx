import { venuePatch } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Select } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api } from '../../lib/api';
import { applyFieldErrors, errorText } from '../../lib/errors';
import { z } from 'zod';
import type { VenueAdmin } from '../../lib/types';
import { venueKey, venuesKey } from '../../lib/venue';

const generalSchema = venuePatch
  .pick({
    name: true,
    locales: true,
    resetTime: true,
    autoCloseTime: true,
  })
  .required();
type GeneralValues = z.infer<typeof generalSchema>;

/** Form values from the venue; pending zone and times show what applies from the next business day. */
export function generalValues(v: VenueAdmin): GeneralValues {
  return {
    name: v.name,
    locales: v.locales,
    resetTime: v.pendingResetTime ?? v.resetTime,
    autoCloseTime: v.pendingAutoCloseTime ?? v.autoCloseTime,
  };
}

const LANGUAGE_SETS: Record<string, string[]> = {
  ar: ['ar'],
  en: ['en'],
  'ar,en': ['ar', 'en'],
  'en,ar': ['en', 'ar'],
};

/** The venue follows the time zone of the device the owner saves from. */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function GeneralForm({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<GeneralValues>({
    resolver: zodResolver(generalSchema),
    defaultValues: generalValues(venue),
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<VenueAdmin>(`/venues/${venue.id}`, body),
    onSuccess: (v) => {
      qc.setQueryData(venueKey(venue.id), v);
      void qc.invalidateQueries({ queryKey: venuesKey });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    // Send only what changed: time changes are scheduled for the next business day.
    const dirty = form.formState.dirtyFields;
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(values) as Array<keyof typeof values>) if (dirty[k]) body[k] = values[k];
    const zone = deviceZone();
    if (zone && zone !== (venue.pendingTimeZone ?? venue.timeZone)) body.timeZone = zone;
    try {
      const v = await save.mutateAsync(body);
      form.reset(generalValues(v));
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'locales', 'resetTime', 'autoCloseTime'])) setError(errorText(t, e));
    }
  });

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field label={t('venue.general.name')} error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Controller
        control={form.control}
        name="locales"
        render={({ field }) => (
          <Select
            label={t('venue.general.languages')}
            value={field.value.join(',')}
            onChange={(e) => field.onChange(LANGUAGE_SETS[e.target.value] ?? ['ar'])}
            options={Object.keys(LANGUAGE_SETS).map((k) => ({
              value: k,
              label: t(`venue.general.languageSets.${k}`),
            }))}
          />
        )}
      />
      {errors.locales && <Banner tone="danger">{errors.locales.message ? t('venue.general.languageUnavailable') : t('form.required')}</Banner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('venue.general.resetTime')} type="time" error={errors.resetTime ? t('form.time') : undefined} {...form.register('resetTime')} />
        <Field label={t('venue.general.autoCloseTime')} type="time" error={errors.autoCloseTime ? t('form.time') : undefined} {...form.register('autoCloseTime')} />
      </div>
      <p className="text-sm text-muted">{t('venue.general.nextDayNote')}</p>
      {venue.pendingFromDate && (
        <Banner tone="info">
          {t('venue.general.pending', {
            date: venue.pendingFromDate,
            reset: venue.pendingResetTime ?? venue.resetTime,
            close: venue.pendingAutoCloseTime ?? venue.autoCloseTime,
          })}
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}
      <div>
        <Button type="submit" busy={isSubmitting} disabled={!isDirty}>
          {t('common:save')}
        </Button>
      </div>
      <LiveRegion toast text={save.isSuccess && !isDirty ? t('common:saved') : ''} />
    </form>
  );
}

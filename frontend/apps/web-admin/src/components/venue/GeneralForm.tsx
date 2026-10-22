import { venuePatch } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Select } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api } from '../../lib/api';
import { applyFieldErrors, errorText } from '../../lib/errors';
import { z } from 'zod';
import { ADDRESS_FIELDS, type VenueAddress, type VenueAdmin } from '../../lib/types';
import { venueKey, venuesKey } from '../../lib/venue';

const addressSchema = z.object(Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, z.string().trim().max(200)])) as Record<(typeof ADDRESS_FIELDS)[number], z.ZodString>);
const generalSchema = venuePatch.pick({ name: true, timeZone: true, locales: true, resetTime: true, autoCloseTime: true }).required().extend({ address: addressSchema });
type GeneralValues = z.infer<typeof generalSchema>;

/** Form values from the venue; pending zone and times show what applies from the next business day. */
export function generalValues(v: VenueAdmin): GeneralValues {
  return {
    name: v.name,
    timeZone: v.pendingTimeZone ?? v.timeZone,
    locales: v.locales,
    resetTime: v.pendingResetTime ?? v.resetTime,
    autoCloseTime: v.pendingAutoCloseTime ?? v.autoCloseTime,
    address: Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, v.address?.[k] ?? ''])) as GeneralValues['address'],
  };
}

/** The address as the API stores it: empty fields left out, null when nothing is set (W10, FR-ADM-03). */
export function addressBody(a: GeneralValues['address']): VenueAddress | null {
  const out = Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
  return Object.keys(out).length ? out : null;
}

const LANGUAGE_SETS: Record<string, string[]> = { ar: ['ar'], en: ['en'], 'ar,en': ['ar', 'en'], 'en,ar': ['en', 'ar'] };

function timeZones(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.('timeZone') ?? ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Muscat', 'Africa/Cairo', 'Europe/London'];
  return list.includes(current) ? list : [current, ...list];
}

export function GeneralForm({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(venue.timeZone), [venue.timeZone]);
  const form = useForm<GeneralValues>({ resolver: zodResolver(generalSchema), defaultValues: generalValues(venue) });
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
    for (const k of Object.keys(values) as Array<keyof typeof values>) if (dirty[k]) body[k] = k === 'address' ? addressBody(values.address) : values[k];
    try {
      const v = await save.mutateAsync(body);
      form.reset(generalValues(v));
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'timeZone', 'locales', 'resetTime', 'autoCloseTime', 'address'])) setError(errorText(t, e));
    }
  });

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field label={t('venue.general.name')} error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <div className="flex flex-col gap-1">
        <label htmlFor="tz" className="font-medium">
          {t('venue.general.timeZone')}
        </label>
        <input id="tz" list="tz-list" className="min-h-12 rounded-lg border border-line bg-surface px-3" aria-invalid={errors.timeZone ? true : undefined} {...form.register('timeZone')} />
        <datalist id="tz-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {errors.timeZone && (
          <p role="alert" className="text-sm text-danger">
            {errors.timeZone.type === 'server' ? t('venue.general.timeZoneUnknown') : t('form.required')}
          </p>
        )}
      </div>
      <Controller
        control={form.control}
        name="locales"
        render={({ field }) => (
          <Select
            label={t('venue.general.languages')}
            value={field.value.join(',')}
            onChange={(e) => field.onChange(LANGUAGE_SETS[e.target.value] ?? ['ar'])}
            options={Object.keys(LANGUAGE_SETS).map((k) => ({ value: k, label: t(`venue.general.languageSets.${k}`) }))}
          />
        )}
      />
      {errors.locales && <Banner tone="danger">{errors.locales.message ? t('venue.general.languageUnavailable') : t('form.required')}</Banner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('venue.general.resetTime')} type="time" error={errors.resetTime ? t('form.time') : undefined} {...form.register('resetTime')} />
        <Field label={t('venue.general.autoCloseTime')} type="time" error={errors.autoCloseTime ? t('form.time') : undefined} {...form.register('autoCloseTime')} />
      </div>
      <p className="text-sm text-muted">{t('venue.general.nextDayNote')}</p>
      {venue.pendingFromDate && <Banner tone="info">{t('venue.general.pending', { date: venue.pendingFromDate, reset: venue.pendingResetTime ?? venue.resetTime, close: venue.pendingAutoCloseTime ?? venue.autoCloseTime })}</Banner>}
      {venue.pendingFromDate && venue.pendingTimeZone && <Banner tone="info">{t('venue.general.pendingZone', { date: venue.pendingFromDate, zone: venue.pendingTimeZone, current: venue.timeZone })}</Banner>}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">{t('venue.general.address')}</legend>
        <Field label={t('venue.general.addressLine1')} autoComplete="address-line1" {...form.register('address.line1')} />
        <Field label={t('venue.general.addressLine2')} autoComplete="address-line2" {...form.register('address.line2')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('venue.general.city')} autoComplete="address-level2" {...form.register('address.city')} />
          <Field label={t('venue.general.region')} autoComplete="address-level1" {...form.register('address.region')} />
          <Field label={t('venue.general.postcode')} autoComplete="postal-code" dir="ltr" {...form.register('address.postcode')} />
          <Field label={t('venue.general.country')} autoComplete="country-name" {...form.register('address.country')} />
        </div>
        {errors.address && <p role="alert" className="text-sm text-danger">{t('venue.general.addressTooLong')}</p>}
      </fieldset>
      {error && <Banner tone="danger">{error}</Banner>}
      <div>
        <Button type="submit" busy={isSubmitting} disabled={!isDirty}>
          {t('common:save')}
        </Button>
      </div>
      <LiveRegion text={save.isSuccess && !isDirty ? t('common:saved') : ''} />
    </form>
  );
}

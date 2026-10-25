import type { VenueSettings } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Select } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { api } from '../../lib/api';
import {
  ENGLISH_SKIP_SUGGESTION,
  formatNumberList,
  parseNumberList,
  settingsToForm,
  validateSettingsForm,
  type SettingsField,
  type SettingsForm,
} from '../../lib/settingsForm';
import type { Chime, VenueAdmin } from '../../lib/types';
import { venueKey } from '../../lib/venue';
import { Checkbox, ErrorNote, RadioGroup, Section } from '../common';

/** Resolver that validates the mapped JSON with `venueSettingsSchema` (TR-FE-21). */
function settingsResolver(base: VenueSettings): Resolver<SettingsForm> {
  return async (values) => {
    const r = validateSettingsForm(values, base);
    if (r.ok) return { values, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const [k, message] of Object.entries(r.errors)) errors[k] = { type: 'schema', message: message ?? '' };
    return { values: {}, errors: errors as FieldErrors<SettingsForm> };
  };
}

/** Chime from the platform library (FR-ADM-08, W11); uploaded chimes can be heard before saving. */
function ChimePicker({ value, onChange, error }: { value: string; onChange: (code: string) => void; error?: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['chimes'], queryFn: async () => (await api.get<{ items: Chime[] }>('/chimes')).items });
  const list = q.data ?? [];
  // A chime the platform withdrew stays selectable for the venue that uses it.
  const options = list.some((c) => c.code === value) ? list : [...list, { id: value, code: value, name: value, builtin: false, url: null, active: false, durationMs: 0 }];
  const current = options.find((c) => c.code === value);
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Select label={t('venue.flow.chime')} value={value} onChange={(e) => onChange(e.target.value)} options={options.map((c) => ({ value: c.code, label: c.builtin ? `${c.name} (${t('venue.flow.chimeBuiltin')})` : c.name }))} />
      <p className="text-sm text-muted">{t('venue.flow.chimeHint')}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ErrorNote error={q.error} />
      {current?.url && (
        <div>
          <Button type="button" variant="secondary" onClick={() => void new Audio(current.url!).play().catch(() => undefined)}>
            {t('venue.flow.chimePreview')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function FlowForm({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const resolver = useMemo(() => settingsResolver(venue.settings), [venue.settings]);
  const form = useForm<SettingsForm>({ resolver, defaultValues: settingsToForm(venue.settings) });
  const { errors, isSubmitting, isDirty } = form.formState;
  const waitMode = form.watch('waitMode');
  const err = (f: SettingsField) => (errors[f] ? t(`venue.flow.errors.${f}`) : undefined);

  const save = useMutation({
    mutationFn: (s: VenueSettings) => api.put<VenueAdmin>(`/venues/${venue.id}/settings`, s),
    onSuccess: (v) => {
      qc.setQueryData(venueKey(venue.id), v);
      form.reset(settingsToForm(v.settings));
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const r = validateSettingsForm(values, venue.settings);
    if (!r.ok) return;
    try {
      await save.mutateAsync(r.settings);
    } catch (e) {
      setError(e);
    }
  });

  const addEnglishSkip = () => {
    const current = parseNumberList(form.getValues('skipNumbers')).filter((n) => !Number.isNaN(n));
    form.setValue('skipNumbers', formatNumberList([...current, ...ENGLISH_SKIP_SUGGESTION]), { shouldDirty: true });
  };

  return (
    <form onSubmit={submit} className="flex flex-col" noValidate>
      <Section title={t('venue.flow.ticketFlow')}>
        <Controller
          control={form.control}
          name="startStatus"
          render={({ field }) => (
            <RadioGroup
              legend={t('venue.flow.startStatus')}
              name="startStatus"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'preparing', label: t('venue.flow.startPreparing') },
                { value: 'received', label: t('venue.flow.startReceived') },
              ]}
            />
          )}
        />
        <Checkbox label={t('venue.flow.showReceived')} {...form.register('showReceivedColumn')} />
      </Section>

      <Section title={t('venue.flow.wait')} description={t('venue.flow.waitHint')}>
        <Controller
          control={form.control}
          name="waitMode"
          render={({ field }) => (
            <RadioGroup
              legend={t('venue.flow.waitMode')}
              name="waitMode"
              value={field.value}
              onChange={field.onChange}
              options={(['manual', 'auto', 'off'] as const).map((v) => ({ value: v, label: t(`venue.flow.waitModes.${v}`) }))}
            />
          )}
        />
        {waitMode === 'auto' && <p className="mb-2 text-sm text-muted">{t('venue.flow.waitAutoNote')}</p>}
        {waitMode !== 'off' && <Field className="max-w-xs" label={t('venue.flow.defaultMinutes')} inputMode="numeric" error={err('defaultMinutes')} {...form.register('defaultMinutes')} />}
      </Section>

      <Section title={t('venue.flow.numbering')}>
        <div className="grid max-w-md gap-4 sm:grid-cols-2">
          <Field label={t('venue.flow.rangeStart')} inputMode="numeric" error={err('rangeStart')} {...form.register('rangeStart')} />
          <Field label={t('venue.flow.rangeEnd')} inputMode="numeric" error={err('rangeEnd')} {...form.register('rangeEnd')} />
        </div>
        <div className="mt-4">
          <Checkbox label={t('venue.flow.prefixesEnabled')} hint={t('venue.flow.prefixesHint')} {...form.register('prefixesEnabled')} />
        </div>
        <Field className="mt-4" label={t('venue.flow.skipNumbers')} hint={t('venue.flow.skipHint')} dir="ltr" error={err('skipNumbers')} {...form.register('skipNumbers')} />
        <div className="mt-2">
          <Button type="button" variant="secondary" onClick={addEnglishSkip}>
            {t('venue.flow.addEnglishSkip')}
          </Button>
        </div>
      </Section>

      <Section title={t('venue.flow.alerts')} description={t('venue.flow.alertsHint')}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('venue.flow.repeatOffsets')} hint={t('venue.flow.repeatHint')} dir="ltr" error={err('repeatOffsets')} {...form.register('repeatOffsets')} />
          <Field label={t('venue.flow.maxAutoAlerts')} inputMode="numeric" hint={t('venue.flow.maxHint')} error={err('maxAutoAlerts')} {...form.register('maxAutoAlerts')} />
          <Field label={t('venue.flow.liveLoop')} inputMode="numeric" hint={t('venue.flow.liveLoopHint')} error={err('liveLoopSeconds')} {...form.register('liveLoopSeconds')} />
        </div>
        <ChimePicker value={form.watch('chime')} onChange={(c) => form.setValue('chime', c, { shouldDirty: true })} error={err('chime')} />
      </Section>

      <Section title={t('venue.flow.checkCode')}>
        <Controller
          control={form.control}
          name="checkCode"
          render={({ field }) => (
            <RadioGroup
              legend={t('venue.flow.checkCodeLegend')}
              name="checkCode"
              value={field.value}
              onChange={field.onChange}
              hint={t('venue.flow.checkCodeHint')}
              options={(['off', 'optional', 'mandatory'] as const).map((v) => ({ value: v, label: t(`venue.flow.checkCodeOptions.${v}`) }))}
            />
          )}
        />
      </Section>

      <Section title={t('venue.flow.claims')} description={t('venue.flow.claimsHint')}>
        <Controller
          control={form.control}
          name="claimsMode"
          render={({ field }) => (
            <RadioGroup
              legend={t('venue.flow.claimsLegend')}
              name="claimsMode"
              value={field.value}
              onChange={field.onChange}
              options={(['off', 'code', 'staff_approval'] as const).map((v) => ({ value: v, label: t(`venue.flow.claimsModes.${v}`) }))}
            />
          )}
        />
      </Section>

      {Object.keys(errors).length > 0 && <Banner tone="danger">{t('common:errors.VALIDATION_FAILED')}</Banner>}
      <ErrorNote error={error} />
      <div className="mt-2">
        <Button type="submit" busy={isSubmitting} disabled={!isDirty}>
          {t('common:save')}
        </Button>
      </div>
      <LiveRegion toast text={save.isSuccess && !isDirty ? t('common:saved') : ''} />
    </form>
  );
}

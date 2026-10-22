import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion } from '@dop/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { api } from '../../lib/api';
import { errorText, isCode } from '../../lib/errors';
import { ApiError } from '@dop/client-sdk';
import { formToMessages, MESSAGE_KEYS, messagesToForm, validateMessagesForm, type MessageKey, type MessagesForm as Form } from '../../lib/settingsForm';
import type { VenueAdmin } from '../../lib/types';
import { venueKey } from '../../lib/venue';
import { TextArea } from '../common';

const MAX = 280;

/** Validates with `venueMessagesSchema` (via validateMessagesForm) and nests errors per language. */
const resolver: Resolver<Form> = async (values) => {
  const r = validateMessagesForm(values);
  if (r.ok) return { values, errors: {} };
  const errors: Record<string, Record<string, { type: string; message: string }>> = {};
  for (const [path, message] of Object.entries(r.errors)) {
    const [locale, key] = path.split('.') as [string, string];
    (errors[locale] ??= {})[key] = { type: 'schema', message };
  }
  return { values: {}, errors: errors as FieldErrors<Form> };
};

export function MessagesForm({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({ resolver, defaultValues: messagesToForm(venue.messages, venue.locales) });
  const { errors, isSubmitting, isDirty } = form.formState;
  const values = form.watch();
  const save = useMutation({
    mutationFn: (f: Form) => api.put<VenueAdmin>(`/venues/${venue.id}/messages`, formToMessages(f)),
    onSuccess: (v) => {
      qc.setQueryData(venueKey(venue.id), v);
      form.reset(messagesToForm(v.messages, v.locales));
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });
  const submit = form.handleSubmit(async (f) => {
    setError(null);
    try {
      await save.mutateAsync(f);
    } catch (e) {
      let mapped = false;
      if (e instanceof ApiError) {
        for (const [path, message] of Object.entries(e.fieldErrors())) {
          const [locale, key] = path.split('.');
          if (locale && key && venue.locales.includes(locale) && (MESSAGE_KEYS as readonly string[]).includes(key)) {
            form.setError(`${locale}.${key as MessageKey}`, { type: 'server', message });
            mapped = true;
          }
        }
      }
      if (!mapped || !isCode(e, 'VALIDATION_FAILED')) setError(errorText(t, e));
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <p className="text-muted">{t('venue.messages.intro')}</p>
      {venue.locales.map((locale) => (
        <fieldset key={locale} className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line p-4" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <legend className="px-2 text-lg font-bold">{t(`languages.${locale}`, { defaultValue: locale })}</legend>
          {MESSAGE_KEYS.filter((k) => k !== 'websiteUrl').map((k) => {
            const len = values[locale]?.[k]?.length ?? 0;
            const err = errors[locale]?.[k];
            return (
              <TextArea
                key={k}
                label={t(`venue.messages.fields.${k}`)}
                maxLength={MAX}
                hint={t('venue.messages.counter', { count: len, max: MAX })}
                error={err ? t('venue.messages.tooLong', { max: MAX }) : undefined}
                {...form.register(`${locale}.${k}`)}
              />
            );
          })}
          <Field
            label={t('venue.messages.fields.websiteUrl')}
            type="url"
            dir="ltr"
            placeholder="https://"
            hint={t('venue.messages.websiteHint')}
            error={errors[locale]?.websiteUrl ? t('venue.messages.urlInvalid') : undefined}
            {...form.register(`${locale}.websiteUrl`)}
          />
        </fieldset>
      ))}
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

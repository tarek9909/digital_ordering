import { zodResolver } from '@hookform/resolvers/zod';
import { consoleCreateTenantBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, PageShell, Select } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Checkbox, ErrorNote } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import type { Plan, SettingRow } from '../lib/types';

// Create tenant and invite its owner, with its plan and trial length (FR-SA-05, W04).

const FIELDS = ['name', 'slug', 'country', 'locale', 'ownerEmail', 'complimentary', 'planCode', 'trialDays'] as const;

/** Default plan: Trial, or Standard for a complimentary tenant (mirrors the server default). */
export const defaultPlanCode = (complimentary: boolean) => (complimentary ? 'standard' : 'trial');

/** Plans a new tenant may start on: not archived; a complimentary tenant needs a paid plan. */
export function planChoices(plans: Pick<Plan, 'code' | 'name' | 'archived'>[] | undefined, complimentary: boolean) {
  const list = plans ? plans.filter((p) => !p.archived) : [{ code: 'trial', name: '' }, { code: 'standard', name: '' }];
  return list.filter((p) => !(complimentary && p.code === 'trial'));
}

export function CreateTenantPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  // Same query as the Settings page; only used to show the platform's default trial length.
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: SettingRow[] }>('/settings') });
  const platformTrialDays = settings.data?.items.find((s) => s.key === 'trial.days')?.value;
  const form = useForm({
    resolver: zodResolver(consoleCreateTenantBody),
    defaultValues: {
      name: '',
      slug: '',
      country: 'SA',
      locale: 'ar',
      ownerEmail: '',
      complimentary: false,
      planCode: defaultPlanCode(false),
      trialDays: undefined as number | undefined,
    },
  });
  const complimentary = Boolean(form.watch('complimentary'));
  const planCode = form.watch('planCode') ?? '';
  const choices = planChoices(plans.data?.items, complimentary);
  const firstChoice = choices[0]?.code;
  const known = choices.some((p) => p.code === planCode);
  useEffect(() => {
    // Keep the form value in step with what the select shows (e.g. no 'trial' plan in the catalogue).
    if (!known && firstChoice) form.setValue('planCode', firstChoice);
  }, [known, firstChoice, form]);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { ...v, trialDays: v.complimentary ? undefined : v.trialDays };
      const r = await api.post<{ tenantId: string }>('/tenants', body);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      void nav(`/tenants/${r.tenantId}`);
    } catch (e) {
      // Field errors go to the fields; the coded message (e.g. "Address already taken") is shown above too.
      applyFieldErrors(e, form.setError, FIELDS);
      setError(e);
    }
  });
  const errs = form.formState.errors;
  const msg = (k: (typeof FIELDS)[number]) => {
    const e = errs[k];
    if (!e) return undefined;
    return e.type === 'server' ? t(`create.server.${e.message ?? ''}`, { defaultValue: e.message ?? '' }) : t(`create.invalid.${k}`);
  };
  const compReg = form.register('complimentary');
  const planError = msg('planCode');
  return (
    <PageShell title={t('create.title')}>
      <Card className="max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <ErrorNote error={error} />
          <Field label={t('create.name')} maxLength={120} error={msg('name')} {...form.register('name')} />
          <Field label={t('create.slug')} dir="ltr" hint={t('create.slugHint')} maxLength={40} autoComplete="off" error={msg('slug')} {...form.register('slug')} />
          <Field label={t('create.country')} dir="ltr" maxLength={2} hint={t('create.countryHint')} error={msg('country')} {...form.register('country')} />
          <Select
            label={t('create.locale')}
            options={[
              { value: 'ar', label: t('lang.ar') },
              { value: 'en', label: t('lang.en') },
            ]}
            {...form.register('locale')}
          />
          <Field label={t('create.ownerEmail')} type="email" dir="ltr" error={msg('ownerEmail')} {...form.register('ownerEmail')} />
          <Checkbox
            label={t('create.complimentary')}
            hint={t('create.complimentaryHint')}
            {...compReg}
            onChange={(e) => {
              void compReg.onChange(e);
              const on = e.target.checked;
              // Switching mode resets the plan to that mode's default; a complimentary tenant has no trial.
              form.setValue('planCode', defaultPlanCode(on));
              if (on) form.setValue('trialDays', undefined);
              form.clearErrors(['planCode', 'trialDays']);
            }}
          />
          <div className="flex flex-col gap-1">
            <Select
              label={t('create.plan')}
              value={planCode}
              aria-invalid={planError ? true : undefined}
              aria-describedby={planError ? 'plan-err' : undefined}
              onChange={(e) => form.setValue('planCode', e.target.value, { shouldValidate: form.formState.isSubmitted })}
              options={choices.map((p) => ({ value: p.code, label: t(`plan.${p.code}`, { defaultValue: p.name || p.code }) }))}
            />
            {plans.isError && <p className="text-sm text-muted">{t('create.plansUnavailable')}</p>}
            {planError && (
              <p id="plan-err" role="alert" className="text-sm text-danger">
                {planError}
              </p>
            )}
          </div>
          {!complimentary && (
            <Field
              label={t('create.trialDays')}
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              dir="ltr"
              hint={typeof platformTrialDays === 'number' ? t('create.trialDaysHint', { days: platformTrialDays }) : t('create.trialDaysHintDefault')}
              error={msg('trialDays')}
              {...form.register('trialDays', { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v)) })}
            />
          )}
          <Button type="submit" busy={form.formState.isSubmitting}>
            {t('create.submit')}
          </Button>
        </form>
      </Card>
    </PageShell>
  );
}

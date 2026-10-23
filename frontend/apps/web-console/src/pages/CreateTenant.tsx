import { zodResolver } from '@hookform/resolvers/zod';
import { consoleCreateTenantBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell, Select } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { ErrorNote, Toggle } from '../components/common';
import { jsonValue } from '../lib/announcement';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { fmtDay } from '../lib/format';
import type { Plan, SettingRow } from '../lib/types';

// Create tenant and invite its owner, with its plan and trial length (FR-SA-05, W04).

const FIELDS = ['name', 'slug', 'country', 'locale', 'ownerEmail', 'complimentary', 'planCode', 'trialDays'] as const;
const COUNTRIES = ['LB', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'EG', 'IQ', 'SY', 'TR', 'CY', 'FR', 'GB', 'US'];

/** Default plan: Trial, or Standard for a complimentary tenant (mirrors the server default). */
export const defaultPlanCode = (complimentary: boolean) => (complimentary ? 'standard' : 'trial');

/** Plans a new tenant may start on: not archived; a complimentary tenant needs a paid plan. */
export function planChoices(plans: Pick<Plan, 'code' | 'name' | 'archived'>[] | undefined, complimentary: boolean) {
  const list = plans ? plans.filter((p) => !p.archived) : [{ code: 'trial', name: '' }, { code: 'standard', name: '' }];
  return list.filter((p) => !(complimentary && p.code === 'trial'));
}

/** Suggested address from a Latin restaurant name ("Burger House" → "burger-house"); other scripts give ''. */
export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function CreateTenantPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const slugEdited = useRef(false);
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
  const [name, slug, ownerEmail, trialDays] = form.watch(['name', 'slug', 'ownerEmail', 'trialDays']);
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
  const nameReg = form.register('name');
  const slugReg = form.register('slug');
  const planError = msg('planCode');
  const regions = (() => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: 'region' });
    } catch {
      return null;
    }
  })();
  const host = typeof window === 'undefined' ? 'dop.localhost' : window.location.hostname.replace(/^admin\./, '');
  const chosenPlan = plans.data?.items.find((p) => p.code === planCode);
  const limits = jsonValue<Record<string, number>>(chosenPlan?.limits, {});
  const days = typeof trialDays === 'number' && Number.isFinite(trialDays) ? trialDays : typeof platformTrialDays === 'number' ? platformTrialDays : null;
  const trialEnd = days ? fmtDay(new Date(Date.now() + days * 86_400_000).toISOString(), i18n.language) : null;
  const planName = t(`plan.${planCode}`, { defaultValue: chosenPlan?.name ?? planCode });

  return (
    <PageShell wide eyebrow={t('layout.groups.tenants')} title={t('create.title')} description={t('create.description')}>
      <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <ErrorNote error={error} />
          <Step n={1} title={t('createUx.restaurant')} hint={t('createUx.restaurantHint')}>
            <Field
              label={t('create.name')}
              maxLength={120}
              placeholder={t('createUx.namePlaceholder')}
              error={msg('name')}
              {...nameReg}
              onChange={(e) => {
                void nameReg.onChange(e);
                if (!slugEdited.current) form.setValue('slug', slugify(e.target.value));
              }}
            />
            <Field
              label={t('create.slug')}
              dir="ltr"
              hint={slug ? t('createUx.slugPreview', { url: `${slug}.${host}` }) : t('create.slugHint')}
              maxLength={40}
              autoComplete="off"
              placeholder="burger-house"
              error={msg('slug')}
              {...slugReg}
              onChange={(e) => {
                slugEdited.current = e.target.value !== '';
                void slugReg.onChange(e);
              }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t('createUx.country')} options={COUNTRIES.map((c) => ({ value: c, label: `${regions?.of(c) ?? c} (${c})` }))} {...form.register('country')} />
              <Select
                label={t('create.locale')}
                options={[
                  { value: 'ar', label: t('lang.ar') },
                  { value: 'en', label: t('lang.en') },
                ]}
                {...form.register('locale')}
              />
            </div>
            {msg('country') && <p className="text-sm text-danger">{msg('country')}</p>}
          </Step>

          <Step n={2} title={t('createUx.owner')} hint={t('createUx.ownerHint')}>
            <Field label={t('create.ownerEmail')} type="email" dir="ltr" placeholder="owner@restaurant.com" error={msg('ownerEmail')} {...form.register('ownerEmail')} />
          </Step>

          <Step n={3} title={t('createUx.plan')} hint={t('createUx.planHint')}>
            <Toggle
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                  placeholder={typeof platformTrialDays === 'number' ? String(platformTrialDays) : undefined}
                  hint={typeof platformTrialDays === 'number' ? t('create.trialDaysHint', { days: platformTrialDays }) : t('create.trialDaysHintDefault')}
                  error={msg('trialDays')}
                  {...form.register('trialDays', { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v)) })}
                />
              )}
            </div>
            {chosenPlan && (
              <ul className="flex flex-wrap gap-1.5 text-xs text-ink-2">
                {(['maxVenues', 'maxDisplaysPerVenue', 'maxStaffDevicesPerVenue', 'maxLanguages'] as const).map((k) =>
                  limits[k] !== undefined ? (
                    <li key={k} className="rounded-full bg-canvas px-2.5 py-1 ring-1 ring-line">
                      {t(`limits.${k}`)}: <span className="num font-semibold">{limits[k]}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </Step>
        </div>

        <aside aria-labelledby="summary-h" className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-card lg:sticky lg:top-6">
          <h2 id="summary-h" className="eyebrow">
            {t('createUx.summary')}
          </h2>
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-xl font-extrabold tracking-tight break-words">{name || t('createUx.unnamed')}</p>
            <p dir="ltr" className="self-start font-mono text-xs break-all text-muted">
              {slug ? `${slug}.${host}` : '—'}
            </p>
          </div>
          <ol className="flex flex-col gap-3 text-sm">
            <SummaryStep>{t('createUx.next.create')}</SummaryStep>
            <SummaryStep>{ownerEmail ? t('createUx.next.inviteTo', { email: ownerEmail }) : t('createUx.next.invite')}</SummaryStep>
            <SummaryStep>
              {complimentary ? t('createUx.next.complimentary', { plan: planName }) : planCode === 'trial' && trialEnd ? t('createUx.next.trial', { date: trialEnd, days }) : t('createUx.next.plan', { plan: planName })}
            </SummaryStep>
          </ol>
          <Button type="submit" size="lg" busy={form.formState.isSubmitting}>
            {t('create.submit')}
          </Button>
        </aside>
      </form>
    </PageShell>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-start gap-3" aria-hidden="true">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white">{n}</span>
        <span className="flex flex-col">
          <span className="font-display text-lg font-bold">{title}</span>
          <span className="text-sm text-muted">{hint}</span>
        </span>
      </div>
      {children}
    </fieldset>
  );
}

const SummaryStep = ({ children }: { children: ReactNode }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink" />
    <span className="text-ink-2">{children}</span>
  </li>
);

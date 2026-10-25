import { zodResolver } from '@hookform/resolvers/zod';
import { consoleCreateTenantBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell, Select } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { ErrorNote, Toggle } from '../components/common';
import { jsonValue } from '../lib/format';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { fmtDay } from '../lib/format';
import type { Plan, SettingRow } from '../lib/types';

// Create tenant and invite its owner, with its plan and trial length (FR-SA-05, W04).

const FIELDS = ['name', 'slug', 'country', 'locale', 'ownerEmail', 'complimentary', 'planCode'] as const;
const COUNTRIES = ['LB', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'EG', 'IQ', 'SY', 'TR', 'CY', 'FR', 'GB', 'US'];

/** Default plan: Standard (a console tenant is active at once, with no trial). */
export const defaultPlanCode = (_complimentary?: boolean) => 'standard';

/** Plans a new tenant may start on: not archived, and not Trial. */
export function planChoices(plans: Pick<Plan, 'code' | 'name' | 'archived'>[] | undefined, _complimentary?: boolean) {
  const list = plans ? plans.filter((p) => !p.archived && p.code !== 'trial') : [{ code: 'standard', name: '' }];
  return list;
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
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <PageShell wide eyebrow={t('layout.groups.tenants')} title={t('create.title')} description={t('create.description')}>
      <CreateTenantForm onCreated={(id) => void nav(`/tenants/${id}`)} />
    </PageShell>
  );
}

/** The create form on its own, so the tenants page can show it inline. */
export function CreateTenantForm({ onCreated }: { onCreated: (tenantId: string) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const slugEdited = useRef(false);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
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
    },
  });
  const complimentary = Boolean(form.watch('complimentary'));
  const planCode = form.watch('planCode') ?? '';
  const [name, slug, ownerEmail] = form.watch(['name', 'slug', 'ownerEmail']);
  const choices = planChoices(plans.data?.items, complimentary);
  const firstChoice = choices[0]?.code;
  const known = choices.some((p) => p.code === planCode);
  useEffect(() => {
    if (!known && firstChoice) form.setValue('planCode', firstChoice);
  }, [known, firstChoice, form]);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.post<{ tenantId: string }>('/tenants', v);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      onCreated(r.tenantId);
    } catch (e) {
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
  const planName = t(`plan.${planCode}`, { defaultValue: chosenPlan?.name ?? planCode });

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        <ErrorNote error={error} />
        
        {/* Step 1: Restaurant Identity */}
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
            <Select
              label={t('createUx.country')}
              options={COUNTRIES.map((c) => ({ value: c, label: `${regions?.of(c) ?? c} (${c})` }))}
              {...form.register('country')}
            />
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

        {/* Step 2: Owner Account */}
        <Step n={2} title={t('createUx.owner')} hint={t('createUx.ownerHint')}>
          <Field
            label={t('create.ownerEmail')}
            type="email"
            dir="ltr"
            placeholder="owner@restaurant.com"
            error={msg('ownerEmail')}
            {...form.register('ownerEmail')}
          />
        </Step>

        {/* Step 3: Plan & Subscription Terms */}
        <Step n={3} title={t('createUx.plan')} hint={t('createUx.planHint')}>
          <div className="rounded-xl bg-canvas p-3 border border-line">
            <Toggle
              label={t('create.complimentary')}
              hint={t('create.complimentaryHint')}
              {...compReg}
              onChange={(e) => {
                void compReg.onChange(e);
                const on = e.target.checked;
                form.setValue('planCode', defaultPlanCode(on));
                form.clearErrors(['planCode']);
              }}
            />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <Select
              label={t('create.plan')}
              value={planCode}
              aria-invalid={planError ? true : undefined}
              aria-describedby={planError ? 'plan-err' : undefined}
              onChange={(e) => form.setValue('planCode', e.target.value, { shouldValidate: form.formState.isSubmitted })}
              options={choices.map((p) => ({ value: p.code, label: t(`plan.${p.code}`, { defaultValue: p.name || p.code }) }))}
            />
            {plans.isError && <p className="text-xs text-muted">{t('create.plansUnavailable')}</p>}
            {planError && (
              <p id="plan-err" role="alert" className="text-xs font-medium text-danger">
                {planError}
              </p>
            )}
          </div>
          {chosenPlan && (
            <div className="flex flex-col gap-2 pt-2 border-t border-line/60">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">Plan Inclusions</span>
              <ul className="flex flex-wrap gap-2 text-xs text-ink-2">
                {(['maxVenues', 'maxDisplaysPerVenue', 'maxStaffDevicesPerVenue', 'maxLanguages'] as const).map((k) =>
                  limits[k] !== undefined ? (
                    <li key={k} className="rounded-lg bg-canvas px-3 py-1 ring-1 ring-line font-medium flex items-center gap-1.5">
                      <span>{t(`limits.${k}`)}:</span>
                      <span className="num font-bold text-ink">{limits[k]}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
        </Step>
      </div>

      {/* Floating Summary Card */}
      <aside aria-labelledby="summary-h" className="flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-card border border-line xl:sticky xl:top-6">
        <h2 id="summary-h" className="eyebrow text-xs font-bold text-muted uppercase tracking-wider">
          {t('createUx.summary')}
        </h2>
        <div className="flex flex-col gap-1 pb-2 border-b border-line/60">
          <p className="font-display text-xl font-extrabold tracking-tight text-ink break-words">
            {name || t('createUx.unnamed')}
          </p>
          <span dir="ltr" className="console-mono-chip self-start">
            {slug ? `${slug}.${host}` : '—'}
          </span>
        </div>
        <ol className="flex flex-col gap-3.5 text-xs sm:text-sm">
          <SummaryStep active={Boolean(name && slug)}>
            {t('createUx.next.create')}
          </SummaryStep>
          <SummaryStep active={Boolean(ownerEmail)}>
            {ownerEmail ? t('createUx.next.inviteTo', { email: ownerEmail }) : t('createUx.next.invite')}
          </SummaryStep>
          <SummaryStep active={Boolean(planCode)}>
            {complimentary
              ? t('createUx.next.complimentary', { plan: planName })
              : t('createUx.next.plan', { plan: planName })}
          </SummaryStep>
        </ol>
        <Button type="submit" size="lg" className="w-full mt-3 font-bold shadow-button" busy={form.formState.isSubmitting}>
          {t('create.submit')}
        </Button>
      </aside>
    </form>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4.5 rounded-2xl bg-surface p-5 sm:p-6 shadow-card border border-line">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-start gap-3.5 border-b border-line/60 pb-3" aria-hidden="true">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ink to-panel-2 font-display text-xs font-bold text-white shadow-sm">
          {n}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-display text-lg font-bold text-ink">{title}</span>
          <span className="text-xs sm:text-sm text-muted">{hint}</span>
        </span>
      </div>
      {children}
    </fieldset>
  );
}

const SummaryStep = ({ children, active }: { children: ReactNode; active?: boolean }) => (
  <li className="flex gap-2.5 items-start">
    <span
      aria-hidden="true"
      className={`mt-1 size-2 shrink-0 rounded-full transition-colors ${
        active ? 'bg-primary ring-2 ring-primary/20' : 'bg-muted/40'
      }`}
    />
    <span className={`min-w-0 break-words font-medium ${active ? 'text-ink' : 'text-muted'}`}>
      {children}
    </span>
  </li>
);

import { planCreateBody, planLimitsSchema, priceCreateBody, type PlanLimits } from '@dop/contracts';
import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion, Modal, PageShell, Pill, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNote, FormButtons, ListField, Segmented, Toggle } from '../components/common';
import { api } from '../lib/api';
import { jsonValue } from '../lib/announcement';
import { majorToMinor, minorToMajor } from '../lib/money';
import { DEFAULT_LIMITS, LIMIT_KEYS } from '../lib/planLimits';
import { CURRENCIES } from '../lib/settingsForm';
import type { Plan, PlanPrice } from '../lib/types';

// Plans and prices (FR-SA-10). A new price replaces the active one for the same plan, period and currency.

type Dialog = { kind: 'create' } | { kind: 'edit'; plan: Plan } | { kind: 'price'; plan: Plan } | { kind: 'deactivate'; plan: Plan; price: PlanPrice } | null;
const PERIODS = ['month', 'quarter', 'year'] as const;

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announce, setAnnounce] = useState('');
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  const done = (msg: string) => {
    setDialog(null);
    setAnnounce(msg);
    void qc.invalidateQueries({ queryKey: ['plans'] });
  };
  const close = () => setDialog(null);
  const plans = q.data?.items ?? [];
  // Feature keys already used by any plan, offered as one-click suggestions in the plan form.
  const knownFeatures = [...new Set(plans.flatMap((p) => jsonValue<string[]>(p.features, [])))].sort();
  const active = plans.filter((p) => !p.archived);
  const archived = plans.filter((p) => p.archived);

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.platform')}
      title={t('plans.title')}
      description={t('plans.description')}
      actions={
        <Button onClick={() => setDialog({ kind: 'create' })}>
          <span aria-hidden="true">+</span>
          {t('plans.create')}
        </Button>
      }
    >
      <LiveRegion text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : plans.length === 0 ? (
        <EmptyState title={t('plansUx.emptyTitle')}>{t('plansUx.emptyHint')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid gap-5 xl:grid-cols-2">
            {active.map((p) => (
              <PlanCard key={p.id} plan={p} onDialog={setDialog} />
            ))}
          </div>
          {archived.length > 0 && (
            <section aria-labelledby="archived-h" className="flex flex-col gap-3">
              <h2 id="archived-h" className="eyebrow">
                {t('plansUx.archivedPlans', { count: archived.length })}
              </h2>
              <div className="grid gap-5 opacity-80 xl:grid-cols-2">
                {archived.map((p) => (
                  <PlanCard key={p.id} plan={p} onDialog={setDialog} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {dialog?.kind === 'create' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.create')} description={t('plansUx.createIntro')}>
          <PlanForm knownFeatures={knownFeatures} onCancel={close} onDone={() => done(t('plans.created'))} />
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.editTitle', { code: dialog.plan.name })}>
          <PlanForm plan={dialog.plan} knownFeatures={knownFeatures} onCancel={close} onDone={() => done(t('plans.updated'))} />
        </Modal>
      )}
      {dialog?.kind === 'price' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.addPriceTitle', { code: dialog.plan.name })} description={t('plans.addPriceBody')}>
          <PriceForm plan={dialog.plan} onCancel={close} onDone={() => done(t('plans.priceAdded'))} />
        </Modal>
      )}
      {dialog?.kind === 'deactivate' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.deactivateTitle')} description={t('plans.deactivateBody', { price: formatMoney(dialog.price.amountMinor, dialog.price.currency, i18n.language) })}>
          <DeactivateForm price={dialog.price} onCancel={close} onDone={() => done(t('plans.deactivated'))} />
        </Modal>
      )}
    </PageShell>
  );
}

function PlanCard({ plan, onDialog }: { plan: Plan; onDialog: (d: Dialog) => void }) {
  const { t, i18n } = useTranslation();
  const limits = jsonValue<Record<string, number>>(plan.limits, {});
  const features = jsonValue<string[]>(plan.features, []);
  const prices = [...plan.prices].sort((a, b) => Number(b.active) - Number(a.active) || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period));
  return (
    <article aria-labelledby={`plan-${plan.id}`} className="flex flex-col rounded-[var(--radius-card)] bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={`plan-${plan.id}`} className="font-display text-xl font-extrabold tracking-tight">
            {plan.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="font-mono text-xs text-muted">
              {plan.code}
            </span>
            {plan.isPublic ? <Pill tone="ok">{t('plans.public')}</Pill> : <Pill>{t('plans.hidden')}</Pill>}
            {plan.archived && <Pill tone="warn">{t('plans.archived')}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onDialog({ kind: 'edit', plan })}>
            {t('plans.edit')}
          </Button>
          <Button variant="secondary" onClick={() => onDialog({ kind: 'price', plan })}>
            {t('plans.addPrice')}
          </Button>
        </div>
      </header>
      <div className="grid flex-1 gap-6 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="eyebrow mb-2">{t('plans.limits')}</h3>
            <dl className="grid grid-cols-2 gap-2">
              {LIMIT_KEYS.map((k) => (
                <div key={k} className="flex flex-col gap-0.5 rounded-input bg-canvas px-3 py-2">
                  <dt className="text-xs text-muted">{t(`limits.${k}`)}</dt>
                  <dd className="num font-display text-lg font-bold">{limits[k] ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-2">{t('plans.features')}</h3>
            {features.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {features.map((f) => (
                  <li key={f} dir="ltr" className="rounded-full bg-canvas px-2.5 py-1 font-mono text-xs ring-1 ring-line">
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('plansUx.noFeatures')}</p>
            )}
          </div>
        </div>
        <div>
          <h3 className="eyebrow mb-2">{t('plans.prices')}</h3>
          {prices.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-input border border-dashed border-line p-4">
              <p className="text-sm text-muted">{t('plans.noPrices')}</p>
              <Button variant="ghost" onClick={() => onDialog({ kind: 'price', plan })}>
                {t('plans.addPrice')}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {prices.map((x) => (
                <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 ${x.active ? '' : 'opacity-60'}`}>
                  <span className="flex flex-col">
                    <span className="num font-display text-lg font-bold">{formatMoney(x.amountMinor, x.currency, i18n.language)}</span>
                    <span className="text-xs text-muted">{t(`period.${x.period}`)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    {x.active ? <Pill tone="ok">{t('plans.active')}</Pill> : <Pill>{t('plans.inactive')}</Pill>}
                    {x.active && (
                      <Button variant="ghost" className="text-sm" onClick={() => onDialog({ kind: 'deactivate', plan, price: x })}>
                        {t('plans.deactivate')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

const LIMIT_MIN: Partial<Record<keyof PlanLimits, number>> = { maxLanguages: 1, trialTicketsPerDay: 1 };

function PlanForm({ plan, knownFeatures, onCancel, onDone }: { plan?: Plan; knownFeatures: string[]; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const start = plan ? { ...DEFAULT_LIMITS, ...jsonValue<Partial<PlanLimits>>(plan.limits, {}) } : DEFAULT_LIMITS;
  const [v, setV] = useState(() => ({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    isPublic: plan?.isPublic ?? true,
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(start[k])])) as Record<keyof PlanLimits, string>,
    features: plan ? jsonValue<string[]>(plan.features, []) : [],
  }));
  const [errs, setErrs] = useState<{ code?: string; name?: string; features?: string; limits?: Set<string> }>({});
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => (plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body)),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, v.limits[k].trim() === '' ? NaN : Number(v.limits[k])]));
    const lr = planLimitsSchema.safeParse(limits);
    if (!lr.success) next.limits = new Set(lr.error.issues.map((i) => String(i.path[0])));
    const body = { code: v.code.trim(), name: v.name.trim(), isPublic: v.isPublic, limits: lr.success ? lr.data : DEFAULT_LIMITS, features: v.features };
    const r = planCreateBody.safeParse(body);
    if (!r.success) {
      for (const i of r.error.issues) {
        const k = i.path[0];
        if (k === 'code' && !plan) next.code = t('plans.codeInvalid');
        if (k === 'name') next.name = t('plans.nameInvalid');
        if (k === 'features') next.features = t('plans.featuresInvalid');
      }
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const { code: _code, ...patch } = body;
    m.mutate(plan ? patch : body);
  };
  const suggestions = knownFeatures.filter((f) => !v.features.includes(f));
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <ErrorNote error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('plans.name')} maxLength={80} value={v.name} error={errs.name} placeholder={t('plansUx.namePlaceholder')} onChange={(e) => setV({ ...v, name: e.target.value })} />
        {!plan && (
          <Field
            label={t('plans.code')}
            dir="ltr"
            autoComplete="off"
            hint={t('plans.codeHint')}
            value={v.code}
            error={errs.code}
            placeholder="pro_plus"
            onChange={(e) => setV({ ...v, code: e.target.value.toLowerCase().replace(/[\s-]+/g, '_') })}
          />
        )}
      </div>
      <Toggle label={t('plans.isPublic')} hint={t('plansUx.publicHint')} checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex flex-col gap-0.5">
          <span className="font-semibold">{t('plans.limits')}</span>
          <span className="text-sm text-muted">{t('plansUx.limitsHint')}</span>
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {LIMIT_KEYS.map((k) => (
            <Field
              key={k}
              label={t(`limits.${k}`)}
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={LIMIT_MIN[k] ?? 0}
              value={v.limits[k]}
              error={errs.limits?.has(k) ? t('plansUx.limitInvalid', { min: LIMIT_MIN[k] ?? 0 }) : undefined}
              onChange={(e) => setV({ ...v, limits: { ...v.limits, [k]: e.target.value } })}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <ListField<string>
          label={t('plans.features')}
          hint={errs.features ?? t('plansUx.featuresHint')}
          values={v.features}
          max={50}
          placeholder="webhooks"
          parse={(s) => (s.length <= 60 ? { ok: true, value: s } : { ok: false, error: t('plans.featuresInvalid') })}
          onChange={(features) => setV({ ...v, features })}
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">{t('plansUx.suggestions')}</span>
            {suggestions.map((f) => (
              <button key={f} type="button" dir="ltr" className="min-h-9 rounded-full px-2.5 font-mono text-xs text-ink-2 ring-1 ring-line hover:bg-canvas hover:text-ink" onClick={() => setV({ ...v, features: [...v.features, f] })}>
                + {f}
              </button>
            ))}
          </div>
        )}
      </div>
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('common:save')} />
    </form>
  );
}

function PriceForm({ plan, onCancel, onDone }: { plan: Plan; onCancel: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState<{ period: (typeof PERIODS)[number]; currency: string; amount: string }>({ period: 'month', currency: 'USD', amount: '' });
  const [errs, setErrs] = useState<{ currency?: boolean; amount?: boolean }>({});
  const m = useMutation({ mutationFn: (body: unknown) => api.post(`/plans/${plan.id}/prices`, body), onSuccess: onDone });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amountMinor = majorToMinor(v.amount);
    const r = priceCreateBody.safeParse({ period: v.period, currency: v.currency.trim(), amountMinor: amountMinor ?? -1 });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    setErrs({ currency: paths.has('currency'), amount: amountMinor === null || paths.has('amountMinor') });
    if (r.success) m.mutate(r.data);
  };
  const preview = majorToMinor(v.amount);
  const current = plan.prices.find((p) => p.active && p.period === v.period && p.currency === v.currency);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={m.error} />
      <Segmented label={t('plans.period')} value={v.period} onChange={(period) => setV({ ...v, period })} options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))} />
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Select label={t('plans.currency')} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Field
          label={t('plans.amountMajor')}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={v.amount}
          hint={preview !== null ? t('plansUx.pricePreview', { price: formatMoney(preview, v.currency, i18n.language), major: minorToMajor(preview) }) : undefined}
          error={errs.amount ? t('plans.amountInvalid') : errs.currency ? t('plans.currencyInvalid') : undefined}
          onChange={(e) => setV({ ...v, amount: e.target.value })}
        />
      </div>
      {current && <p className="rounded-input bg-warn-bg px-3 py-2 text-sm font-medium text-warn">{t('plansUx.replaces', { price: formatMoney(current.amountMinor, current.currency, i18n.language) })}</p>}
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('plans.addPrice')} />
    </form>
  );
}

function DeactivateForm({ price, onCancel, onDone }: { price: PlanPrice; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = useMutation({ mutationFn: () => api.post(`/prices/${price.id}/deactivate`), onSuccess: onDone });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <ErrorNote error={m.error} />
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('plans.deactivate')} danger />
    </form>
  );
}

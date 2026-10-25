import { planCreateBody, priceCreateBody } from '@dop/contracts';
import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion, Modal, PageShell, Pill, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNote, FormButtons, Segmented, Toggle } from '../components/common';
import { api } from '../lib/api';
import { majorToMinor, minorToMajor } from '../lib/money';
import { DEFAULT_LIMITS } from '../lib/planLimits';
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
  const active = plans.filter((p) => !p.archived);
  const archived = plans.filter((p) => p.archived);

  return (
    <PageShell
      wide
      eyebrow={t('layout.groups.platform')}
      title={t('plans.title')}
      description={t('plans.description')}
      actions={
        <Button onClick={() => setDialog({ kind: 'create' })} className="shadow-button font-bold">
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          {t('plans.create')}
        </Button>
      }
    >
      <LiveRegion toast text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <div className="p-8 text-center">
          <Spinner label={t('common:loading')} />
        </div>
      ) : plans.length === 0 ? (
        <EmptyState title={t('plansUx.emptyTitle')}>{t('plansUx.emptyHint')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="grid gap-6 xl:grid-cols-2">
            {active.map((p) => (
              <PlanCard key={p.id} plan={p} onDialog={setDialog} />
            ))}
          </div>
          {archived.length > 0 && (
            <section aria-labelledby="archived-h" className="flex flex-col gap-4 pt-4 border-t border-line/60">
              <h2 id="archived-h" className="eyebrow text-xs font-bold text-muted uppercase tracking-wider">
                {t('plansUx.archivedPlans', { count: archived.length })}
              </h2>
              <div className="grid gap-6 opacity-75 xl:grid-cols-2">
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
          <div className="pt-2">
            <PlanForm onCancel={close} onDone={() => done(t('plans.created'))} />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.editTitle', { code: dialog.plan.name })}>
          <div className="pt-2">
            <PlanForm plan={dialog.plan} onCancel={close} onDone={() => done(t('plans.updated'))} />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'price' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.addPriceTitle', { code: dialog.plan.name })} description={t('plans.addPriceBody')}>
          <div className="pt-2">
            <PriceForm plan={dialog.plan} onCancel={close} onDone={() => done(t('plans.priceAdded'))} />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'deactivate' && (
        <Modal
          open
          onOpenChange={(o) => !o && close()}
          title={t('plans.deactivateTitle')}
          description={t('plans.deactivateBody', { price: formatMoney(dialog.price.amountMinor, dialog.price.currency, i18n.language) })}
        >
          <div className="pt-2">
            <DeactivateForm price={dialog.price} onCancel={close} onDone={() => done(t('plans.deactivated'))} />
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

function PlanCard({ plan, onDialog }: { plan: Plan; onDialog: (d: Dialog) => void }) {
  const { t, i18n } = useTranslation();
  const prices = [...plan.prices].sort((a, b) => Number(b.active) - Number(a.active) || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period));

  return (
    <article aria-labelledby={`plan-${plan.id}`} className="console-card flex flex-col overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/80 bg-canvas/40 px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={`plan-${plan.id}`} className="font-display text-xl font-extrabold tracking-tight text-ink">
            {plan.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="console-mono-chip font-bold">
              {plan.code}
            </span>
            {plan.isPublic ? <Pill tone="ok">{t('plans.public')}</Pill> : <Pill tone="neutral">{t('plans.hidden')}</Pill>}
            {plan.archived && <Pill tone="warn">{t('plans.archived')}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="md" className="font-bold text-xs" onClick={() => onDialog({ kind: 'edit', plan })}>
            {t('plans.edit')}
          </Button>
          <Button variant="secondary" size="md" className="font-bold text-xs" onClick={() => onDialog({ kind: 'price', plan })}>
            + {t('plans.addPrice')}
          </Button>
        </div>
      </header>
      <div className="grid flex-1 gap-6 p-5 md:grid-cols-2">
        <p className="text-sm text-ink-2">{plan.description || <span className="text-muted">{t('plansUx.noDescription')}</span>}</p>
        <div>
          <h3 className="eyebrow text-xs font-bold text-muted uppercase tracking-wider mb-2.5">{t('plans.prices')}</h3>
          {prices.length === 0 ? (
            <div className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed border-line p-4 text-center">
              <p className="text-xs sm:text-sm text-muted">{t('plans.noPrices')}</p>
              <Button variant="ghost" size="md" className="font-bold text-primary" onClick={() => onDialog({ kind: 'price', plan })}>
                + {t('plans.addPrice')}
              </Button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {prices.map((x) => (
                <li
                  key={x.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 px-3.5 py-2.5 transition-all ${
                    x.active ? 'border-primary/20 bg-surface' : 'opacity-60'
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="num font-display text-lg font-extrabold text-ink">
                      {formatMoney(x.amountMinor, x.currency, i18n.language)}
                    </span>
                    <span className="text-xs text-muted font-medium">{t(`period.${x.period}`)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {x.active ? (
                      <Pill tone="ok" className="text-xs">{t('plans.active')}</Pill>
                    ) : (
                      <Pill tone="neutral" className="text-xs">{t('plans.inactive')}</Pill>
                    )}
                    {x.active && (
                      <Button variant="ghost" size="md" className="text-xs font-bold text-danger hover:bg-danger-bg/40" onClick={() => onDialog({ kind: 'deactivate', plan, price: x })}>
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

function PlanForm({ plan, onCancel, onDone }: { plan?: Plan; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(() => ({ code: plan?.code ?? '', name: plan?.name ?? '', description: plan?.description ?? '', isPublic: plan?.isPublic ?? true }));
  const [errs, setErrs] = useState<{ code?: string; name?: string }>({});
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => (plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body)),
    onSuccess: onDone,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    // Limits and features are not edited here: a new plan starts from the defaults, an existing one keeps its own.
    const body = { code: v.code.trim(), name: v.name.trim(), description: v.description.trim(), isPublic: v.isPublic, limits: DEFAULT_LIMITS, features: [] as string[] };
    const r = planCreateBody.safeParse(body);
    if (!r.success) {
      for (const i of r.error.issues) {
        const k = i.path[0];
        if (k === 'code' && !plan) next.code = t('plans.codeInvalid');
        if (k === 'name') next.name = t('plans.nameInvalid');
      }
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const { code: _code, limits: _l, features: _f, ...patch } = body;
    m.mutate(plan ? patch : body);
  };

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
      <Field label={t('plansUx.descriptionLabel')} maxLength={500} hint={t('plansUx.descriptionHint')} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <div className="rounded-xl bg-canvas p-3 border border-line">
        <Toggle label={t('plans.isPublic')} hint={t('plansUx.publicHint')} checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />
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
    <form onSubmit={submit} className="flex flex-col gap-4.5" noValidate>
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
      {current && (
        <div className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-xs sm:text-sm font-medium text-warn border border-warn/30">
          {t('plansUx.replaces', { price: formatMoney(current.amountMinor, current.currency, i18n.language) })}
        </div>
      )}
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
      className="flex flex-col gap-4.5"
    >
      <ErrorNote error={m.error} />
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('plans.deactivate')} danger />
    </form>
  );
}

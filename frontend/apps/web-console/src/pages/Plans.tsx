import { planCreateBody, priceCreateBody } from '@dop/contracts';
import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, LiveRegion, Modal, PageShell, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Checkbox, ErrorNote, FormButtons, Table, Td, TextArea } from '../components/common';
import { api } from '../lib/api';
import { jsonValue } from '../lib/announcement';
import { majorToMinor, minorToMajor } from '../lib/money';
import { DEFAULT_LIMITS, LIMIT_KEYS, parseFeatures, parsePlanLimits } from '../lib/planLimits';
import { prettyJson } from '../lib/settingJson';
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

  return (
    <PageShell eyebrow={t('layout.groups.platform')} title={t('plans.title')} description={t('plans.description')} actions={<Button onClick={() => setDialog({ kind: 'create' })}>{t('plans.create')}</Button>}>
      <LiveRegion text={announce} />
      <ErrorNote error={q.error} />
      {q.isPending ? <Spinner label={t('common:loading')} /> : <div className="flex flex-col gap-6">{q.data?.items.map((p) => <PlanCard key={p.id} plan={p} onDialog={setDialog} />)}</div>}
      {dialog?.kind === 'create' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.create')}>
          <PlanForm onCancel={close} onDone={() => done(t('plans.created'))} />
        </Modal>
      )}
      {dialog?.kind === 'edit' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.editTitle', { code: dialog.plan.code })}>
          <PlanForm plan={dialog.plan} onCancel={close} onDone={() => done(t('plans.updated'))} />
        </Modal>
      )}
      {dialog?.kind === 'price' && (
        <Modal open onOpenChange={(o) => !o && close()} title={t('plans.addPriceTitle', { code: dialog.plan.code })} description={t('plans.addPriceBody')}>
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
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            {plan.name} <code className="text-sm font-normal text-muted" dir="ltr">({plan.code})</code>
          </h2>
          <p className="text-sm text-muted">
            {plan.isPublic ? t('plans.public') : t('plans.hidden')}
            {plan.archived && ` · ${t('plans.archived')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onDialog({ kind: 'edit', plan })}>
            {t('plans.edit')}
          </Button>
          <Button variant="secondary" onClick={() => onDialog({ kind: 'price', plan })}>
            {t('plans.addPrice')}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 font-semibold">{t('plans.limits')}</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
            {LIMIT_KEYS.map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted">{t(`limits.${k}`)}</dt>
                <dd className="num">{limits[k] ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <h3 className="mt-3 mb-1 font-semibold">{t('plans.features')}</h3>
          <p className="text-sm" dir="ltr">
            {features.length ? features.join(', ') : '—'}
          </p>
        </div>
        <Table caption={t('plans.prices')} head={[t('plans.period'), t('plans.amount'), t('plans.state'), '']}>
          {plan.prices.length === 0 && (
            <tr>
              <Td className="text-muted">{t('plans.noPrices')}</Td>
            </tr>
          )}
          {plan.prices.map((x) => (
            <tr key={x.id}>
              <Td>{t(`period.${x.period}`)}</Td>
              <Td className="num">{formatMoney(x.amountMinor, x.currency, i18n.language)}</Td>
              <Td>{x.active ? t('plans.active') : t('plans.inactive')}</Td>
              <Td>
                {x.active && (
                  <Button variant="ghost" onClick={() => onDialog({ kind: 'deactivate', plan, price: x })}>
                    {t('plans.deactivate')}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
  );
}

function PlanForm({ plan, onCancel, onDone }: { plan?: Plan; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(() => ({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    isPublic: plan?.isPublic ?? true,
    limits: prettyJson(plan ? jsonValue<unknown>(plan.limits, DEFAULT_LIMITS) : DEFAULT_LIMITS),
    features: (plan ? jsonValue<string[]>(plan.features, []) : []).join('\n'),
  }));
  const [errs, setErrs] = useState<{ code?: string; name?: string; limits?: string; features?: string }>({});
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => (plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body)),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    const limits = parsePlanLimits(v.limits);
    if (!limits.ok) next.limits = limits.error === 'syntax' ? t('settings.invalidJson', { detail: limits.detail ?? '' }) : t('plans.limitsInvalid', { keys: limits.keys.join(', ') });
    const body = { code: v.code.trim(), name: v.name.trim(), isPublic: v.isPublic, limits: limits.ok ? limits.value : {}, features: parseFeatures(v.features) };
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
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={m.error} />
      {!plan && <Field label={t('plans.code')} dir="ltr" autoComplete="off" hint={t('plans.codeHint')} value={v.code} error={errs.code} onChange={(e) => setV({ ...v, code: e.target.value })} />}
      <Field label={t('plans.name')} maxLength={80} value={v.name} error={errs.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <Checkbox label={t('plans.isPublic')} checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />
      <TextArea label={t('plans.limitsJson')} dir="ltr" spellCheck={false} rows={10} hint={t('plans.limitsHint')} value={v.limits} error={errs.limits} onChange={(e) => setV({ ...v, limits: e.target.value })} />
      <TextArea label={t('plans.features')} dir="ltr" spellCheck={false} rows={4} hint={t('plans.featuresHint')} value={v.features} error={errs.features} onChange={(e) => setV({ ...v, features: e.target.value })} />
      <FormButtons onCancel={onCancel} busy={m.isPending} label={t('common:save')} />
    </form>
  );
}

function PriceForm({ plan, onCancel, onDone }: { plan: Plan; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ period: 'month', currency: 'USD', amount: '' });
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
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={m.error} />
      <Select label={t('plans.period')} value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))} />
      <Field label={t('plans.currency')} dir="ltr" maxLength={3} autoComplete="off" value={v.currency} error={errs.currency ? t('plans.currencyInvalid') : undefined} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
      <Field
        label={t('plans.amountMajor')}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={v.amount}
        hint={preview !== null ? t('plans.amountMinorHint', { minor: preview, major: minorToMajor(preview) }) : undefined}
        error={errs.amount ? t('plans.amountInvalid') : undefined}
        onChange={(e) => setV({ ...v, amount: e.target.value })}
      />
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

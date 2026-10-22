import { ApiError } from '@dop/client-sdk';
import { changePlanBody, freeMonthsBody, recordPaymentBody, transferOwnershipPlatformBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, Modal, Select } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { isCode } from '../../lib/errors';
import { can } from '../../lib/roles';
import { useMe } from '../../lib/me';
import { fmtDate } from '../../lib/format';
import type { DowngradeExcess, Plan, TenantDetail } from '../../lib/types';
import { ErrorNote, FormButtons, TextArea } from '../common';
import { MfaCancelled, useFreshMfa } from '../FreshMfa';

// Commercial actions (FR-SA-07) and ownership transfer (FR-SA-08, TR-FE-23), super admin only.

type Tenant = TenantDetail['tenant'];
type Kind = 'payment' | 'plan' | 'freeMonths' | 'transfer';
/** Used until the catalogue loads, or when it cannot be read; plan codes are free-form since W02. */
const FALLBACK_PLANS = ['standard', 'pro', 'multisite'].map((code) => ({ code, name: code }));
/** Currencies venues pay in; amounts are entered in major units and stored in minor units (× 100). */
const CURRENCIES = ['USD', 'LBP'] as const;
const METHODS = ['cash', 'bank_transfer', 'wallet', 'other'] as const;

export function CommercialActions({ tenant }: { tenant: Tenant }) {
  const { t, i18n } = useTranslation();
  const role = useMe().data?.platformUser.role;
  const qc = useQueryClient();
  const [open, setOpen] = useState<Kind | null>(null);
  const [announce, setAnnounce] = useState('');
  const kinds: Kind[] = [...(can(role, 'commercial') ? (['payment', 'plan', 'freeMonths'] as const) : []), ...(can(role, 'ownership') ? (['transfer'] as const) : [])];
  if (kinds.length === 0) return null;

  const done = (msg: string) => {
    setOpen(null);
    setAnnounce(msg);
    void qc.invalidateQueries({ queryKey: ['tenant', tenant.id] });
    void qc.invalidateQueries({ queryKey: ['tenant-billing', tenant.id] });
    void qc.invalidateQueries({ queryKey: ['tenants'] });
  };
  const close = () => setOpen(null);

  return (
    <section aria-labelledby="commercial-h" className="mt-6">
      <h2 id="commercial-h" className="mb-2 text-lg font-bold">
        {t('commercial.title')}
      </h2>
      <LiveRegion text={announce} />
      <div className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <Button key={k} variant={k === 'transfer' ? 'danger' : 'secondary'} onClick={() => setOpen(k)}>
            {t(`commercial.${k}.button`)}
          </Button>
        ))}
      </div>
      {open && (
        <Modal open onOpenChange={(o) => !o && close()} title={t(`commercial.${open}.title`)} description={t(`commercial.${open}.body`, { slug: tenant.slug })}>
          {open === 'plan' && <PlanForm tenant={tenant} onCancel={close} onDone={(effective) => done(t(`commercial.plan.done.${effective}`, { defaultValue: t('commercial.plan.done.now') }))} />}
          {open === 'payment' && <PaymentForm tenant={tenant} onCancel={close} onDone={(paidUntil) => done(t('commercial.payment.done', { date: fmtDate(paidUntil, i18n.language) }))} />}
          {open === 'freeMonths' && <FreeMonthsForm tenant={tenant} onCancel={close} onDone={() => done(t('commercial.freeMonths.done'))} />}
          {open === 'transfer' && <TransferForm tenant={tenant} onCancel={close} onDone={() => done(t('commercial.transfer.done'))} />}
        </Modal>
      )}
    </section>
  );
}

interface FormProps {
  tenant: Tenant;
  onCancel: () => void;
}

/** Excess list from PLAN_DOWNGRADE_BLOCKED (`problem.data.excess`). */
export function downgradeExcess(e: unknown): DowngradeExcess[] {
  if (!(e instanceof ApiError) || e.code !== 'PLAN_DOWNGRADE_BLOCKED') return [];
  const data = e.problem?.data as { excess?: unknown } | undefined;
  return Array.isArray(data?.excess) ? (data.excess as DowngradeExcess[]) : [];
}

export function PlanForm({ tenant, onCancel, onDone }: FormProps & { onDone: (effective: string) => void }) {
  const { t } = useTranslation();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  const choices = plans.data ? plans.data.items.filter((p) => !p.archived) : FALLBACK_PLANS;
  const codes = choices.map((p) => p.code);
  const [chosen, setPlan] = useState<string | null>(null);
  const plan = chosen ?? (codes.includes(tenant.plan) ? tenant.plan : (codes[0] ?? ''));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = changePlanBody.safeParse({ planCode: plan });
    if (!r.success) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ effective: string }>(`/tenants/${tenant.id}/plan`, r.data);
      onDone(res.effective);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  const excess = downgradeExcess(error);
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      {isCode(error, 'PLAN_DOWNGRADE_BLOCKED') ? (
        <Banner tone="danger">
          <p>{t('commercial.plan.blocked')}</p>
          <ul className="mt-1 list-disc ps-6">
            {excess.map((x) => (
              <li key={x.limit}>{t('commercial.plan.excess', { limit: t(`limits.${x.limit}`, { defaultValue: x.limit }), current: x.current, allowed: x.allowed })}</li>
            ))}
          </ul>
        </Banner>
      ) : (
        <ErrorNote error={error} />
      )}
      <Select label={t('commercial.plan.plan')} value={plan} onChange={(e) => setPlan(e.target.value)} options={choices.map((p) => ({ value: p.code, label: t(`plan.${p.code}`, { defaultValue: p.name }) }))} />
      <p className="text-sm text-muted">{t('commercial.plan.note')}</p>
      <FormButtons onCancel={onCancel} busy={busy} label={t('commercial.plan.button')} />
    </form>
  );
}

function PaymentForm({ tenant, onCancel, onDone }: FormProps & { onDone: (paidUntil: string) => void }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState({ amount: '', currency: 'USD', months: '1', method: 'cash', reference: '', note: '' });
  const [errs, setErrs] = useState<{ amountMinor?: boolean; months?: boolean }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(v.amount.replace(',', '.'));
    const r = recordPaymentBody.safeParse({
      amountMinor: v.amount.trim() === '' || !Number.isFinite(amount) ? NaN : Math.round(amount * 100),
      currency: v.currency,
      months: Number(v.months),
      method: v.method,
      ...(v.reference.trim() && { reference: v.reference.trim() }),
      ...(v.note.trim() && { note: v.note.trim() }),
    });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    setErrs({ amountMinor: paths.has('amountMinor'), months: paths.has('months') });
    if (!r.success) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ id: string; paidUntil: string }>(`/tenants/${tenant.id}/payments`, r.data);
      onDone(res.paidUntil);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('commercial.payment.amount')} inputMode="decimal" dir="ltr" autoComplete="off" value={v.amount} error={errs.amountMinor ? t('commercial.payment.amountInvalid') : undefined} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Select label={t('commercial.payment.currency')} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Field label={t('commercial.payment.months')} type="number" inputMode="numeric" min={1} max={24} value={v.months} error={errs.months ? t('commercial.payment.monthsInvalid') : undefined} onChange={(e) => setV({ ...v, months: e.target.value })} />
        <Select label={t('billing.methodLabel')} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })} options={METHODS.map((m) => ({ value: m, label: t(`billing.method.${m}`) }))} />
      </div>
      <Field label={t('billing.reference')} hint={t('commercial.payment.referenceHint')} autoComplete="off" maxLength={120} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
      <TextArea label={t('commercial.payment.note')} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      <p className="text-sm text-muted">{t('commercial.payment.extends', { date: fmtDate(tenant.paidUntil, i18n.language) })}</p>
      <FormButtons onCancel={onCancel} busy={busy} label={t('commercial.payment.button')} />
    </form>
  );
}

function FreeMonthsForm({ tenant, onCancel, onDone }: FormProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const [months, setMonths] = useState('1');
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = freeMonthsBody.safeParse({ months: Number(months) });
    setInvalid(!r.success);
    if (!r.success) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tenants/${tenant.id}/free-months`, r.data);
      onDone();
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <Field label={t('commercial.freeMonths.months')} type="number" inputMode="numeric" min={1} max={12} value={months} error={invalid ? t('commercial.freeMonths.invalid') : undefined} onChange={(e) => setMonths(e.target.value)} />
      <FormButtons onCancel={onCancel} busy={busy} label={t('commercial.freeMonths.button')} />
    </form>
  );
}

function TransferForm({ tenant, onCancel, onDone }: FormProps & { onDone: () => void }) {
  const { t } = useTranslation();
  const run = useFreshMfa();
  const [v, setV] = useState({ email: '', verificationNote: '', confirm: '' });
  const [errs, setErrs] = useState<{ email?: boolean; verificationNote?: boolean; confirm?: boolean }>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = transferOwnershipPlatformBody.safeParse({ email: v.email.trim(), verificationNote: v.verificationNote });
    const paths = new Set(r.success ? [] : r.error.issues.map((i) => i.path[0]));
    const bad = { email: paths.has('email'), verificationNote: paths.has('verificationNote'), confirm: v.confirm.trim() !== tenant.slug };
    setErrs(bad);
    if (!r.success || bad.confirm) return;
    setBusy(true);
    setError(null);
    try {
      await run(() => api.post(`/tenants/${tenant.id}/transfer-ownership`, r.data));
      onDone();
    } catch (x) {
      if (!(x instanceof MfaCancelled)) setError(x);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <Banner tone="warn">{t('commercial.transfer.warning')}</Banner>
      {isCode(error, 'NOT_FOUND') ? <Banner tone="danger">{t('commercial.transfer.noAccount')}</Banner> : <ErrorNote error={error} />}
      <Field label={t('commercial.transfer.email')} type="email" dir="ltr" autoComplete="off" value={v.email} error={errs.email ? t('commercial.transfer.emailInvalid') : undefined} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <TextArea
        label={t('commercial.transfer.note')}
        hint={t('commercial.transfer.noteHint')}
        maxLength={1000}
        value={v.verificationNote}
        error={errs.verificationNote ? t('commercial.transfer.noteInvalid') : undefined}
        onChange={(e) => setV({ ...v, verificationNote: e.target.value })}
      />
      <Field label={t('actions.typeSlug', { slug: tenant.slug })} dir="ltr" autoComplete="off" value={v.confirm} error={errs.confirm ? t('actions.slugMismatch') : undefined} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
      <FormButtons onCancel={onCancel} busy={busy} label={t('commercial.transfer.button')} danger />
    </form>
  );
}

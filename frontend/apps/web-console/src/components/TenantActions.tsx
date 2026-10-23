import { zodResolver } from '@hookform/resolvers/zod';
import { extendTrialBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, LiveRegion, Modal } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import type { TenantDetail } from '../lib/types';
import { ActionRow, ErrorNote, Section, TextArea } from './common';
import { MfaCancelled, useFreshMfa } from './FreshMfa';

// Lifecycle actions (FR-SA-06 – FR-SA-08, TR-FE-23). Suspend and delete need the tenant slug typed and a fresh
// MFA check; the server decides when MFA is stale (MFA_REQUIRED) and FreshMfa retries.

type Kind = 'suspend' | 'reactivate' | 'extend' | 'complimentary' | 'cancel' | 'delete';
type Tenant = TenantDetail['tenant'];

export function TenantActions({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Kind | null>(null);
  const [announce, setAnnounce] = useState('');
  const qc = useQueryClient();
  const nav = useNavigate();

  const done = (kind: Kind) => {
    setOpen(null);
    setAnnounce(t(`actions.${kind}.done`));
    if (kind === 'delete') void nav('/tenants');
    else void qc.invalidateQueries({ queryKey: ['tenant', tenant.id] });
    void qc.invalidateQueries({ queryKey: ['tenants'] });
  };

  const s = tenant.status;
  const safe: Kind[] = [...(s === 'suspended' ? (['reactivate'] as const) : []), ...(s === 'trial' ? (['extend'] as const) : []), 'complimentary'];
  const danger: Kind[] = [...(['trial', 'active', 'past_due'].includes(s) ? (['suspend'] as const) : []), ...(s !== 'cancelled' ? (['cancel'] as const) : []), 'delete'];
  const label = (k: Kind) => (k === 'complimentary' ? t(tenant.complimentary ? 'actions.complimentary.off' : 'actions.complimentary.on') : t(`actions.${k}.button`));
  const hint = (k: Kind) => (k === 'complimentary' ? t(tenant.complimentary ? 'actionsUx.hint.complimentaryOff' : 'actionsUx.hint.complimentaryOn') : t(`actionsUx.hint.${k}`));

  return (
    <Section title={t('actions.title')} description={t('actionsUx.intro')}>
      <LiveRegion text={announce} />
      <ul className="flex flex-col divide-y divide-line">
        {safe.map((k) => (
          <ActionRow key={k} hint={hint(k)}>
            <Button variant="secondary" onClick={() => setOpen(k)}>
              {label(k)}
            </Button>
          </ActionRow>
        ))}
      </ul>
      <div className="mt-5 rounded-input border border-danger/25 bg-danger-bg/40 p-4">
        <h3 className="mb-3 text-sm font-bold text-danger">{t('actionsUx.danger')}</h3>
        <ul className="flex flex-col divide-y divide-danger/15">
          {danger.map((k) => (
            <ActionRow key={k} hint={hint(k)}>
              <Button variant={k === 'delete' ? 'danger' : 'secondary'} className={k === 'delete' ? undefined : 'text-danger'} onClick={() => setOpen(k)}>
                {label(k)}
              </Button>
            </ActionRow>
          ))}
        </ul>
      </div>
      {open && (
        <Modal open onOpenChange={(o) => !o && setOpen(null)} title={t(`actions.${open}.title`)} description={t(`actions.${open}.body`, { slug: tenant.slug })}>
          <ActionForm kind={open} tenant={tenant} onDone={() => done(open)} onCancel={() => setOpen(null)} />
        </Modal>
      )}
    </Section>
  );
}

const reasonForm = z.object({ reason: z.string().trim().min(3).max(500), confirm: z.string().max(60) });
const extendForm = z.object({ days: z.coerce.number().pipe(extendTrialBody.shape.days) });
const confirmForm = z.object({ confirm: z.string().max(60) });

function ActionForm({ kind, tenant, onDone, onCancel }: { kind: Kind; tenant: Tenant; onDone: () => void; onCancel: () => void }) {
  const run = useFreshMfa();
  const [error, setError] = useState<unknown>(null);
  const exec = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await run(fn);
      onDone();
    } catch (e) {
      if (!(e instanceof MfaCancelled)) setError(e);
    }
  };
  const base = `/tenants/${tenant.id}`;
  const props = { tenant, onCancel, error, exec, base };
  if (kind === 'suspend' || kind === 'cancel') return <ReasonForm kind={kind} {...props} />;
  if (kind === 'extend') return <ExtendForm {...props} />;
  if (kind === 'delete') return <DeleteForm {...props} />;
  return <SimpleConfirm kind={kind} {...props} />;
}

interface FormProps {
  tenant: Tenant;
  onCancel: () => void;
  error: unknown;
  exec: (fn: () => Promise<unknown>) => Promise<void>;
  base: string;
}

function Actions({ onCancel, busy, label, danger }: { onCancel: () => void; busy: boolean; label: string; danger?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t('common:cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy}>
        {label}
      </Button>
    </div>
  );
}

function ReasonForm({ kind, tenant, onCancel, error, exec, base }: FormProps & { kind: 'suspend' | 'cancel' }) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(reasonForm), defaultValues: { reason: '', confirm: '' } });
  const submit = form.handleSubmit(async (v) => {
    if (kind === 'suspend' && v.confirm.trim() !== tenant.slug) {
      form.setError('confirm', { type: 'mismatch' });
      return;
    }
    await exec(async () => {
      try {
        await api.post(`${base}/${kind}`, kind === 'suspend' ? { reason: v.reason, confirm: v.confirm.trim() } : { reason: v.reason });
      } catch (e) {
        if (applyFieldErrors(e, form.setError, ['reason', 'confirm'])) return;
        throw e;
      }
    });
  });
  const errs = form.formState.errors;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <TextArea label={t('actions.reason')} maxLength={500} error={errs.reason && t('actions.reasonInvalid')} {...form.register('reason')} />
      {kind === 'suspend' && (
        <Field label={t('actions.typeSlug', { slug: tenant.slug })} dir="ltr" autoComplete="off" error={errs.confirm && t('actions.slugMismatch')} {...form.register('confirm')} />
      )}
      <Actions onCancel={onCancel} busy={form.formState.isSubmitting} label={t(`actions.${kind}.button`)} danger />
    </form>
  );
}

function ExtendForm({ onCancel, error, exec, base }: FormProps) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(extendForm), defaultValues: { days: 7 } });
  const submit = form.handleSubmit((v) => exec(() => api.post(`${base}/extend-trial`, { days: v.days })));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <Field label={t('actions.extend.days')} type="number" min={1} max={90} inputMode="numeric" error={form.formState.errors.days && t('actions.extend.daysInvalid')} {...form.register('days')} />
      <Actions onCancel={onCancel} busy={form.formState.isSubmitting} label={t('actions.extend.button')} />
    </form>
  );
}

function DeleteForm({ tenant, onCancel, error, exec, base }: FormProps) {
  const { t } = useTranslation();
  const form = useForm({ resolver: zodResolver(confirmForm), defaultValues: { confirm: '' } });
  const submit = form.handleSubmit(async (v) => {
    if (v.confirm.trim() !== tenant.slug) {
      form.setError('confirm', { type: 'mismatch' });
      return;
    }
    await exec(() => api.delete(base, { confirmSlug: v.confirm.trim() }));
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorNote error={error} />
      <Field label={t('actions.typeSlug', { slug: tenant.slug })} dir="ltr" autoComplete="off" error={form.formState.errors.confirm && t('actions.slugMismatch')} {...form.register('confirm')} />
      <Actions onCancel={onCancel} busy={form.formState.isSubmitting} label={t('actions.delete.button')} danger />
    </form>
  );
}

function SimpleConfirm({ kind, tenant, onCancel, error, exec, base }: FormProps & { kind: 'reactivate' | 'complimentary' }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await exec(() => (kind === 'reactivate' ? api.post(`${base}/reactivate`) : api.post(`${base}/complimentary`, { enabled: !tenant.complimentary })));
    setBusy(false);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
      className="flex flex-col gap-4"
    >
      <ErrorNote error={error} />
      <Actions
        onCancel={onCancel}
        busy={busy}
        label={kind === 'complimentary' ? t(tenant.complimentary ? 'actions.complimentary.off' : 'actions.complimentary.on') : t('actions.reactivate.button')}
      />
    </form>
  );
}

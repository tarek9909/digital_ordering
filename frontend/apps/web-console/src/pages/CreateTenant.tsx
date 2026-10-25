import { zodResolver } from '@hookform/resolvers/zod';
import { consoleCreateTenantBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Field, PageShell } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { ErrorNote } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { LogoPicker, uploadTenantLogo } from '../components/TenantLogo';

// Create a tenant with its owner's credentials: restaurant name, address, email and password (FR-SA-05, W04).
// One plan, active at once, no invitation; country and language take the platform defaults.

const FIELDS = ['name', 'slug', 'ownerEmail', 'ownerPassword', 'planStartsAt', 'planEndsAt'] as const;

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
export function CreateTenantForm({ onCreated, onCancel }: { onCreated: (tenantId: string) => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const slugEdited = useRef(false);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoProblemText, setLogoProblemText] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(consoleCreateTenantBody),
    defaultValues: { name: '', slug: '', ownerEmail: '', ownerPassword: '', planStartsAt: '', planEndsAt: '' },
  });
  const slug = form.watch('slug');

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.post<{ tenantId: string }>('/tenants', { ...v, planStartsAt: v.planStartsAt || undefined, planEndsAt: v.planEndsAt || undefined });
      void qc.invalidateQueries({ queryKey: ['tenants'] });
      // The restaurant exists now; a failed logo upload can be retried from its page.
      if (logo) await uploadTenantLogo(r.tenantId, logo).catch(() => undefined);
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
  const nameReg = form.register('name');
  const slugReg = form.register('slug');
  const host = typeof window === 'undefined' ? 'dop.localhost' : window.location.hostname.replace(/^admin\./, '');

  return (
    <form
      onSubmit={submit}
      noValidate
      className={onCancel ? 'flex flex-col gap-4' : 'flex max-w-xl flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6'}
    >
      <ErrorNote error={error} />
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
      <Field label={t('create.ownerEmail')} type="email" dir="ltr" autoComplete="off" placeholder="owner@restaurant.com" error={msg('ownerEmail')} {...form.register('ownerEmail')} />
      <Field
        label={t('create.ownerPassword')}
        type="password"
        dir="ltr"
        autoComplete="new-password"
        hint={t('create.ownerPasswordHint')}
        error={msg('ownerPassword')}
        {...form.register('ownerPassword')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('createUx.planStarts')} type="date" dir="ltr" error={msg('planStartsAt')} {...form.register('planStartsAt')} />
        <Field label={t('createUx.planEnds')} type="date" dir="ltr" hint={t('createUx.planDatesHint')} error={msg('planEndsAt')} {...form.register('planEndsAt')} />
      </div>
      <LogoPicker id="create-logo" label={t('logo.label')} onPick={setLogo} onProblem={setLogoProblemText} />
      {logoProblemText && <p className="text-sm text-danger">{logoProblemText}</p>}
      <div className="flex flex-wrap justify-end gap-2.5 border-t border-line/60 pt-4">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('common:cancel')}
          </Button>
        )}
        <Button type="submit" busy={form.formState.isSubmitting}>
          {t('create.submit')}
        </Button>
      </div>
    </form>
  );
}

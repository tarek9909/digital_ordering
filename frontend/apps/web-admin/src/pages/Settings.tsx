import { formatDateTime } from '@dop/client-sdk';
import { deletionRequestBody, slugChangeBody, tenantPatch } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ErrorNote, Page, QueryView, Section, StatusPill, Table, Td, linkClass } from '../components/common';
import { isLimited } from '../lib/access';
import { api } from '../lib/api';
import { applyFieldErrors, errorText, isCode } from '../lib/errors';
import { tenantKey, useMe, useRole, useTenant } from '../lib/me';
import type { ActivityItem, ExportStatus, TenantInfo } from '../lib/types';

const tenantSchema = tenantPatch.pick({ name: true, billingEmail: true });
const DELETION_WINDOW_MS = 7 * 86_400_000;

function TenantForm({ tenant }: { tenant: TenantInfo }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // The billing email is the owner's (L-10); managers rename the restaurant only.
  const isOwner = useRole() === 'owner';
  const form = useForm({
    resolver: zodResolver(tenantSchema),
    defaultValues: { name: tenant.name, billingEmail: tenant.billing_email },
  });
  const { errors, isSubmitting, isDirty, isSubmitSuccessful } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      await api.patch('/tenant', isOwner ? body : { name: body.name });
      form.reset({ name: body.name, billingEmail: body.billingEmail ?? null });
      await qc.invalidateQueries({ queryKey: tenantKey });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name', 'billingEmail'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field label={t('settings.tenantName')} error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      {isOwner && (
        <Field
          label={t('settings.billingEmail')}
          type="email"
          dir="ltr"
          hint={t('settings.billingEmailHint')}
          error={errors.billingEmail ? t('form.email') : undefined}
          {...form.register('billingEmail', {
            setValueAs: (v: string | null) => (v === '' || v === null ? null : v),
          })}
        />
      )}
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      <div>
        <Button type="submit" variant="ink" busy={isSubmitting} disabled={!isDirty}>
          {t('common:save')}
        </Button>
      </div>
      <LiveRegion text={isSubmitSuccessful && !isDirty ? t('common:saved') : ''} />
    </form>
  );
}

/** Address (slug) change, owner only with password (TR-URL-03): the old address redirects for 180 days. */
function SlugForm({ tenant }: { tenant: TenantInfo }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [changed, setChanged] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(slugChangeBody),
    defaultValues: { slug: tenant.slug, password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      const r = await api.post<{ slug: string }>('/tenant/slug', {
        slug: body.slug.toLowerCase(),
        password: body.password,
      });
      setChanged(r.slug);
      form.reset({ slug: r.slug, password: '' });
      await qc.invalidateQueries({ queryKey: tenantKey });
    } catch (e) {
      // A wrong password answers 401 UNAUTHENTICATED; it belongs on the password field.
      if (isCode(e, 'UNAUTHENTICATED')) form.setError('password', { type: 'server', message: 'wrong' });
      else if (isCode(e, 'SLUG_TAKEN') || isCode(e, 'SLUG_RESERVED')) form.setError('root', { message: errorText(t, e) });
      else if (!applyFieldErrors(e, form.setError, ['slug', 'password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  const loc = window.location;
  const parts = loc.hostname.split('.');
  const domain = parts.length > 2 ? parts.slice(1).join('.') : loc.hostname;
  const address = (slug: string) => `${slug}.${domain}`;
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <p className="flex flex-wrap items-center gap-2">
        {t('settings.currentAddress')}{' '}
        <code dir="ltr" className="rounded-input bg-canvas px-2.5 py-1 font-mono text-sm ring-1 ring-line">
          {address(tenant.slug)}
        </code>
      </p>
      <p className="text-sm text-muted">{t('settings.slugExplain')}</p>
      <Field label={t('settings.newSlug')} dir="ltr" autoCapitalize="none" hint={t('settings.slugHint')} error={errors.slug ? t('settings.slugInvalid') : undefined} {...form.register('slug')} />
      <Field
        type="password"
        autoComplete="current-password"
        label={t('settings.deletionPassword')}
        error={errors.password ? (errors.password.type === 'server' ? t('settings.passwordWrong') : t('form.required')) : undefined}
        {...form.register('password')}
      />
      {errors.root && <Banner tone="danger">{errors.root.message}</Banner>}
      {changed && (
        <Banner tone="ok">
          {t('settings.slugChanged')}{' '}
          <a className="underline" dir="ltr" href={`${loc.protocol}//${address(changed)}${loc.port ? `:${loc.port}` : ''}/admin/`}>
            {address(changed)}
          </a>
        </Banner>
      )}
      <div>
        <Button type="submit" variant="ink" busy={isSubmitting} disabled={!form.formState.isDirty}>
          {t('settings.changeSlug')}
        </Button>
      </div>
      <LiveRegion text={changed ? t('settings.slugChanged') : ''} />
    </form>
  );
}

function DataExport() {
  const { t, i18n } = useTranslation();
  const [exportId, setExportId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>('/exports'),
    onSuccess: (r) => setExportId(r.id),
  });
  const status = useQuery({
    queryKey: ['export', exportId],
    queryFn: () => api.get<ExportStatus>(`/exports/${exportId}`),
    enabled: Boolean(exportId),
    // Poll until the ZIP is ready or failed (TR-PRV-07).
    refetchInterval: (q) => (q.state.data && ['ready', 'failed'].includes(q.state.data.status) ? false : 3000),
  });
  const s = status.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-2xl text-ink-2">{t('settings.exportHint')}</p>
      <ErrorNote error={start.error ?? status.error} />
      {s?.status === 'ready' && s.downloadUrl ? (
        <div className="flex flex-col gap-2">
          <a className={linkClass('ink', 'w-fit')} href={s.downloadUrl}>
            {t('settings.exportDownload')}
          </a>
          {s.expiresAt && (
            <p className="text-sm text-muted">
              {t('settings.exportExpires', {
                date: formatDateTime(s.expiresAt, i18n.language),
              })}
            </p>
          )}
        </div>
      ) : s?.status === 'failed' ? (
        <Banner tone="danger">{t('settings.exportFailed')}</Banner>
      ) : exportId ? (
        <p role="status">
          <StatusPill tone="info">{t('settings.exportWorking')}</StatusPill>
        </p>
      ) : null}
      {(!exportId || s?.status === 'failed' || s?.status === 'ready') && (
        <div>
          <Button variant="secondary" busy={start.isPending} onClick={() => start.mutate()}>
            {t('settings.exportStart')}
          </Button>
        </div>
      )}
      <LiveRegion text={s?.status === 'ready' ? t('settings.exportReady') : ''} />
    </div>
  );
}

function Deletion({ tenant }: { tenant: TenantInfo }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(deletionRequestBody),
    defaultValues: { password: '' },
  });
  const cancel = useMutation({
    mutationFn: () => api.delete('/tenant/deletion'),
    onSuccess: () => qc.invalidateQueries({ queryKey: tenantKey }),
  });
  const submit = form.handleSubmit(async (body) => {
    try {
      await api.post('/tenant/deletion', body);
      form.reset();
      await qc.invalidateQueries({ queryKey: tenantKey });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['password'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  if (tenant.deletion_requested_at) {
    const after = new Date(new Date(tenant.deletion_requested_at).getTime() + DELETION_WINDOW_MS).toISOString();
    return (
      <div className="flex flex-col gap-3">
        <Banner tone="warn">
          {t('settings.deletionPending', {
            date: formatDateTime(after, i18n.language),
          })}
        </Banner>
        <ErrorNote error={cancel.error} />
        <div>
          <Button variant="ink" busy={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('settings.deletionCancel')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3" noValidate>
      <p className="max-w-2xl text-ink-2">{t('settings.deletionHint')}</p>
      <Field
        type="password"
        autoComplete="current-password"
        label={t('settings.deletionPassword')}
        error={form.formState.errors.password ? t('form.required') : undefined}
        {...form.register('password')}
      />
      {form.formState.errors.root && <Banner tone="danger">{form.formState.errors.root.message}</Banner>}
      <div>
        <Button type="submit" variant="danger" busy={form.formState.isSubmitting}>
          {t('settings.deletionRequest')}
        </Button>
      </div>
      <LiveRegion text={cancel.isSuccess ? t('settings.deletionCancelled') : ''} />
    </form>
  );
}

function Activity() {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: ['activity'],
    queryFn: async () => (await api.get<{ items: ActivityItem[] }>('/activity')).items,
  });
  return (
    <QueryView q={q} skeleton="table">
      {(items) =>
        items.length === 0 ? (
          <p className="text-muted">{t('settings.activityEmpty')}</p>
        ) : (
          <Table caption={t('settings.activity')} head={[t('settings.when'), t('settings.who'), t('settings.what')]}>
            {items.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-ink-2">{formatDateTime(a.occurred_at, i18n.language)}</Td>
                <Td>
                  <StatusPill tone="neutral">
                    {t(`actors.${a.actor_type}`, {
                      defaultValue: a.actor_type,
                    })}
                  </StatusPill>
                </Td>
                <Td>
                  {t(`actions.${a.action.replace('.', '_')}`, {
                    defaultValue: a.action,
                  })}
                </Td>
              </tr>
            ))}
          </Table>
        )
      }
    </QueryView>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const isOwner = useMe().data?.currentRole === 'owner';
  const limited = isLimited(tenant.data?.status);
  return (
    <Page title={t('nav.settings')} description={t('settings.description')}>
      <QueryView q={tenant} skeleton="form">
        {(ten) => (
          <>
            {!limited && (
              <Section title={t('settings.tenantTitle')}>
                <TenantForm tenant={ten} />
              </Section>
            )}
            {isOwner && !limited && (
              <Section title={t('settings.slugTitle')}>
                <SlugForm tenant={ten} />
              </Section>
            )}
            {isOwner && (
              <Section title={t('settings.exportTitle')}>
                <DataExport />
              </Section>
            )}
            {isOwner && (
              <div id="deletion">
                <Section tone="danger" title={t('settings.deletionTitle')}>
                  <Deletion tenant={ten} />
                </Section>
              </div>
            )}
            {!limited && (
              <Section title={t('settings.activity')}>
                <Activity />
              </Section>
            )}
          </>
        )}
      </QueryView>
    </Page>
  );
}

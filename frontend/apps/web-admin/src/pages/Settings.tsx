import { formatDateTime } from '@dop/client-sdk';
import { deletionRequestBody, tenantPatch } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DataExport } from '../components/DataExport';
import { ErrorNote, TabPanel, QueryView, Section, SectionTabs, StatusPill, Table, Td } from '../components/common';
import { isLimited } from '../lib/access';
import { api } from '../lib/api';
import { applyFieldErrors, errorText } from '../lib/errors';
import { tenantKey, useMe, useTenant } from '../lib/me';
import type { ActivityItem, TenantInfo } from '../lib/types';

const tenantSchema = tenantPatch.pick({ name: true });
const DELETION_WINDOW_MS = 7 * 86_400_000;

function TenantForm({ tenant }: { tenant: TenantInfo }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(tenantSchema),
    defaultValues: { name: tenant.name },
  });
  const { errors, isSubmitting, isDirty, isSubmitSuccessful } = form.formState;
  const submit = form.handleSubmit(async (body) => {
    try {
      await api.patch('/tenant', { name: body.name });
      form.reset({ name: body.name });
      await qc.invalidateQueries({ queryKey: tenantKey });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <Field label={t('settings.tenantName')} error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
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
    <TabPanel description={t('settings.description')}>
      <QueryView q={tenant} skeleton="form">
        {(ten) => (
          <SectionTabs
            label={t('settings.description')}
            idPrefix="set"
            sections={[
              !limited && {
                key: 'tenant',
                label: t('settings.tenantTitle'),
                node: (
                  <Section title={t('settings.tenantTitle')}>
                    <TenantForm tenant={ten} />
                  </Section>
                ),
              },
              // The export lives in Reports; a suspended account cannot open Reports, so it stays reachable here.
              isOwner &&
                limited && {
                  key: 'export',
                  label: t('settings.exportTitle'),
                  node: (
                    <Section title={t('settings.exportTitle')}>
                      <DataExport />
                    </Section>
                  ),
                },
              !limited && {
                key: 'activity',
                label: t('settings.activity'),
                node: (
                  <Section title={t('settings.activity')}>
                    <Activity />
                  </Section>
                ),
              },
              isOwner && {
                key: 'deletion',
                label: t('settings.deletionTitle'),
                node: (
                  <div id="deletion">
                    <Section tone="danger" title={t('settings.deletionTitle')}>
                      <Deletion tenant={ten} />
                    </Section>
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryView>
    </TabPanel>
  );
}

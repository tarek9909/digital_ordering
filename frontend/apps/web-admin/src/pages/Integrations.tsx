import { formatDateTime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, EmptyState, Field, LiveRegion, Modal, PageShell, Select } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { Checkbox, ConfirmButton, CopyButton, ErrorNote, QueryView, Section, StatusPill, Table, Td, usePageEyebrow } from '../components/common';
import { canManage } from '../lib/access';
import { api } from '../lib/api';
import { applyFieldErrors } from '../lib/errors';
import { useRole } from '../lib/me';
import type { ApiKey, PosConnection, Webhook, WebhookDelivery } from '../lib/types';
import { useCurrentVenueId, useVenues } from '../lib/venue';

// Integrations (owner; support sessions view only; FR-INT-*): API keys per venue, webhooks with deliveries log, POS
// connections. Secrets and full keys are shown exactly once (TR-INT-03, NFR-SEC-05).

export const WEBHOOK_EVENTS = ['ticket.created', 'ticket.ready', 'ticket.acknowledged', 'ticket.collected', 'ticket.cancelled', 'ticket.expired'] as const;

/** A secret shown once, with a copy button and a warning. */
function ShowOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-warn-bg/40 p-4 ring-1 ring-warn/30">
      <Banner tone="warn">{t('integrations.showOnce')}</Banner>
      <p className="font-medium">{label}</p>
      <code dir="ltr" className="block rounded-input bg-surface p-3.5 font-mono text-sm break-all ring-1 ring-line">
        {value}
      </code>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={value} label={t('integrations.copy')} variant="ink" />
        <Button variant="secondary" onClick={onDone}>
          {t('integrations.savedIt')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- API keys

const keySchema = z.object({ name: z.string().trim().min(1).max(60) });

function ApiKeys({ venueId, manage }: { venueId: string; manage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const key = ['api-keys', venueId] as const;
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: ApiKey[] }>(`/venues/${venueId}/api-keys`)).items,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const form = useForm({
    resolver: zodResolver(keySchema),
    defaultValues: { name: '' },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    setError(null);
    try {
      const r = await api.post<{ id: string; key: string }>(`/venues/${venueId}/api-keys`, { name });
      setCreated(r.key);
      form.reset({ name: '' });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) setError(e);
    }
  });
  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '—');
  return (
    <Section title={t('integrations.keysTitle')} description={t('integrations.keysHint')}>
      {manage &&
        (created ? (
          <ShowOnce label={t('integrations.newKey')} value={created} onDone={() => setCreated(null)} />
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-start gap-3" noValidate>
            <Field
              className="min-w-60 flex-1"
              label={t('integrations.keyName')}
              placeholder={t('integrations.keyNamePlaceholder')}
              error={form.formState.errors.name ? t('form.required') : undefined}
              {...form.register('name')}
            />
            <div className="sm:pt-7">
              <Button type="submit" variant="ink" busy={form.formState.isSubmitting}>
                {t('integrations.createKey')}
              </Button>
            </div>
          </form>
        ))}
      <div className="my-3 empty:hidden">
        <ErrorNote error={error ?? revoke.error} />
      </div>
      <QueryView q={q} skeleton="table">
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('integrations.noKeys')}>{t('integrations.noKeysBody')}</EmptyState>
          ) : (
            <Table caption={t('integrations.keysTitle')} head={[t('integrations.keyName'), t('integrations.prefix'), t('integrations.created'), t('integrations.lastUsed'), '']}>
              {items.map((k) => (
                <tr key={k.id}>
                  <Td className="font-semibold">{k.name}</Td>
                  <Td>
                    <code dir="ltr" className="font-mono text-xs text-muted">
                      {k.prefix}…
                    </code>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{date(k.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{date(k.lastUsedAt)}</Td>
                  <Td className="text-end">
                    {k.revoked ? (
                      <StatusPill tone="neutral">{t('integrations.revoked')}</StatusPill>
                    ) : (
                      manage && (
                        <ConfirmButton
                          label={t('integrations.revoke')}
                          title={t('integrations.revokeTitle', {
                            name: k.name,
                          })}
                          description={t('integrations.revokeBody')}
                          confirmLabel={t('integrations.revoke')}
                          variant="danger"
                          busy={revoke.isPending && revoke.variables === k.id}
                          onConfirm={() => revoke.mutateAsync(k.id).catch(() => undefined)}
                        />
                      )
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }
      </QueryView>
    </Section>
  );
}

// ---------------------------------------------------------------- webhooks

function EventChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-1 font-medium">{t('integrations.events')}</legend>
      {WEBHOOK_EVENTS.map((e) => (
        <Checkbox
          key={e}
          label={t(`integrations.eventNames.${e.replace('.', '_')}`)}
          hint={e}
          checked={value.includes(e)}
          onChange={(ev) => onChange(ev.target.checked ? [...value, e] : value.filter((x) => x !== e))}
        />
      ))}
    </fieldset>
  );
}

const webhookUrl = z.string().url().startsWith('https://').max(2048);

function CreateWebhook({ onSecret }: { onSecret: (s: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const venues = useVenues().data ?? [];
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['ticket.ready']);
  const [venueId, setVenueId] = useState('');
  const [invalid, setInvalid] = useState<'url' | 'events' | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; secret: string }>('/webhooks', {
        url: url.trim(),
        events,
        venueId: venueId || null,
      }),
    onSuccess: async (r) => {
      onSecret(r.secret);
      setUrl('');
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!webhookUrl.safeParse(url.trim()).success) return setInvalid('url');
    if (events.length === 0) return setInvalid('events');
    setInvalid(null);
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label={t('integrations.url')}
        type="url"
        dir="ltr"
        placeholder="https://"
        hint={t('integrations.urlHint')}
        value={url}
        error={invalid === 'url' ? t('integrations.urlInvalid') : undefined}
        onChange={(e) => setUrl(e.target.value)}
      />
      <EventChecks value={events} onChange={setEvents} />
      {invalid === 'events' && (
        <p role="alert" className="text-sm text-danger">
          {t('integrations.eventsRequired')}
        </p>
      )}
      <Select
        label={t('integrations.venue')}
        value={venueId}
        onChange={(e) => setVenueId(e.target.value)}
        options={[{ value: '', label: t('integrations.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
      />
      <ErrorNote error={create.error} />
      <div>
        <Button type="submit" busy={create.isPending}>
          {t('integrations.createWebhook')}
        </Button>
      </div>
    </form>
  );
}

function Deliveries({ webhook, manage }: { webhook: Webhook; manage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ['deliveries', webhook.id] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ items: WebhookDelivery[] }>(`/webhooks/${webhook.id}/deliveries`)).items,
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });
  const redeliver = useMutation({
    mutationFn: (id: number) => api.post(`/webhook-deliveries/${id}/redeliver`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const tone = (s: string) => (s === 'succeeded' ? 'ok' : s === 'abandoned' ? 'danger' : s === 'failed' ? 'warn' : 'info');
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('integrations.deliveries')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('integrations.deliveriesTitle')} description={webhook.url}>
        <div className="max-h-[65dvh] overflow-y-auto">
          <ErrorNote error={redeliver.error} />
          <QueryView q={q}>
            {(items) =>
              items.length === 0 ? (
                <p className="text-muted">{t('integrations.noDeliveries')}</p>
              ) : (
                <Table
                  caption={t('integrations.deliveriesTitle')}
                  head={[t('integrations.event'), t('integrations.status'), t('integrations.attempt'), t('integrations.code'), t('integrations.time'), '']}
                >
                  {items.map((d) => (
                    <tr key={d.id}>
                      <Td>
                        <code dir="ltr">{d.event_type}</code>
                      </Td>
                      <Td>
                        <StatusPill tone={tone(d.status)}>
                          {t(`integrations.deliveryStatus.${d.status}`, {
                            defaultValue: d.status,
                          })}
                        </StatusPill>
                      </Td>
                      <Td className="num">{d.attempt}</Td>
                      <Td className="num">{d.response_code ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{formatDateTime(d.created_at, i18n.language)}</Td>
                      <Td>
                        {manage && d.status !== 'pending' && (
                          <Button variant="secondary" busy={redeliver.isPending && redeliver.variables === d.id} onClick={() => redeliver.mutate(d.id)}>
                            {t('integrations.redeliver')}
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )
            }
          </QueryView>
        </div>
        <LiveRegion text={redeliver.isSuccess ? t('integrations.redelivered') : ''} />
      </Modal>
    </>
  );
}

function Webhooks({ manage }: { manage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const venues = useVenues().data ?? [];
  const [secret, setSecret] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['webhooks'],
    queryFn: async () => (await api.get<{ items: Webhook[] }>('/webhooks')).items,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { enabled?: boolean; rotateSecret?: boolean } }) => api.patch<{ secret?: string }>(`/webhooks/${id}`, body),
    onSuccess: async (r) => {
      if (r?.secret) setSecret(r.secret);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/webhooks/${id}/test`),
  });
  const venueName = (id: string | null) => (id ? (venues.find((v) => v.id === id)?.name ?? '—') : t('integrations.allVenues'));
  return (
    <Section title={t('integrations.webhooksTitle')} description={t('integrations.webhooksHint')}>
      {manage && (secret ? <ShowOnce label={t('integrations.signingSecret')} value={secret} onDone={() => setSecret(null)} /> : <CreateWebhook onSecret={setSecret} />)}
      <div className="mt-4 empty:hidden">
        <ErrorNote error={update.error ?? remove.error ?? test.error} />
      </div>
      <QueryView q={q} skeleton="cards">
        {(items) =>
          items.length === 0 ? (
            <p className="mt-4 text-muted">{t('integrations.noWebhooks')}</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {items.map((w) => (
                <div key={w.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code dir="ltr" className="min-w-0 font-mono text-sm font-medium break-all">
                      {w.url}
                    </code>
                    {w.status === 'active' ? (
                      <StatusPill tone="ok">{t('integrations.enabled')}</StatusPill>
                    ) : (
                      <StatusPill tone="warn">{w.disabledReason === 'manual' || !w.disabledReason ? t('integrations.disabled') : t('integrations.disabledFailures')}</StatusPill>
                    )}
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="eyebrow self-center">{t('integrations.venue')}</dt>
                    <dd className="text-ink-2">{venueName(w.venueId)}</dd>
                    <dt className="eyebrow self-center">{t('integrations.events')}</dt>
                    <dd dir="ltr" className="flex flex-wrap gap-1 justify-self-start">
                      {w.events.map((e) => (
                        <span key={e} className="rounded-input bg-canvas px-2 py-0.5 font-mono text-xs text-ink-2 ring-1 ring-line">
                          {e}
                        </span>
                      ))}
                    </dd>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {manage && (
                      <>
                        <Button
                          variant="secondary"
                          busy={update.isPending && update.variables?.id === w.id && update.variables.body.enabled !== undefined}
                          onClick={() =>
                            update.mutate({
                              id: w.id,
                              body: { enabled: w.status !== 'active' },
                            })
                          }
                        >
                          {w.status === 'active' ? t('integrations.disable') : t('integrations.enable')}
                        </Button>
                        <Button variant="secondary" busy={test.isPending && test.variables === w.id} onClick={() => test.mutate(w.id)}>
                          {t('integrations.sendTest')}
                        </Button>
                        <ConfirmButton
                          label={t('integrations.rotate')}
                          title={t('integrations.rotateTitle')}
                          description={t('integrations.rotateBody')}
                          confirmLabel={t('integrations.rotate')}
                          busy={update.isPending && update.variables?.id === w.id && update.variables.body.rotateSecret === true}
                          onConfirm={() =>
                            update
                              .mutateAsync({
                                id: w.id,
                                body: { rotateSecret: true },
                              })
                              .catch(() => undefined)
                          }
                        />
                      </>
                    )}
                    <Deliveries webhook={w} manage={manage} />
                    {manage && (
                      <ConfirmButton
                        label={t('integrations.delete')}
                        title={t('integrations.deleteTitle')}
                        description={t('integrations.deleteBody')}
                        confirmLabel={t('integrations.delete')}
                        variant="danger"
                        busy={remove.isPending && remove.variables === w.id}
                        onConfirm={() => remove.mutateAsync(w.id).catch(() => undefined)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </QueryView>
      <LiveRegion text={test.isSuccess ? t('integrations.testSent') : ''} />
    </Section>
  );
}

// ---------------------------------------------------------------- POS (W01, FR-INT-09)

/** Result of the provider's OAuth return (`?pos=…` on this page), as set by the API callback. */
export const POS_RESULTS = ['connected', 'cancelled', 'failed', 'taken', 'forbidden', 'unavailable'] as const;

function PosConnections({ manage }: { manage: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const venues = useVenues().data ?? [];
  const currentVenue = useCurrentVenueId();
  const [params, setParams] = useSearchParams();
  const result = params.get('pos');
  const [venueId, setVenueId] = useState<string>('');
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ['pos'],
    queryFn: async () => (await api.get<{ items: PosConnection[] }>('/pos/connections')).items,
  });
  const providers = useQuery({
    queryKey: ['pos-providers'],
    queryFn: async () => (await api.get<{ items: string[] }>('/pos/providers')).items,
  });
  const target = venueId || currentVenue || venues[0]?.id || '';
  const connect = useMutation({
    mutationFn: (provider: string) => api.post<{ url: string }>(`/venues/${target}/pos/${provider}/connect`),
    // The provider's consent page; it returns to this page with ?pos=<result>.
    onSuccess: (r) => window.location.assign(r.url),
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos'] }),
    onError: setError,
  });
  const known = result && (POS_RESULTS as readonly string[]).includes(result) ? result : null;
  return (
    <Section title={t('integrations.posTitle')} description={t('integrations.posHint')}>
      {known && (
        <div className="mb-3">
          <Banner
            tone={known === 'connected' ? 'ok' : 'warn'}
            action={
              <Button variant="secondary" onClick={() => setParams((p) => (p.delete('pos'), p), { replace: true })}>
                {t('integrations.dismiss')}
              </Button>
            }
          >
            {t(`integrations.posResult.${known}`)}
          </Banner>
        </div>
      )}
      <ErrorNote error={error} />
      <QueryView q={q} skeleton="table">
        {(items) =>
          items.length === 0 ? (
            <p className="text-muted">{t('integrations.noPos')}</p>
          ) : (
            <Table caption={t('integrations.posTitle')} head={[t('integrations.provider'), t('integrations.venue'), t('integrations.status'), t('integrations.lastSync'), '']}>
              {items.map((c) => (
                <tr key={c.id}>
                  <Td className="font-semibold capitalize">{c.provider}</Td>
                  <Td>{venues.find((v) => v.id === c.venueId)?.name ?? '—'}</Td>
                  <Td>
                    <StatusPill tone={c.status === 'active' || c.status === 'connected' ? 'ok' : c.status === 'error' ? 'danger' : 'neutral'}>
                      {t(`integrations.posStatus.${c.status}`, {
                        defaultValue: c.status,
                      })}
                    </StatusPill>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{c.lastSyncAt ? formatDateTime(c.lastSyncAt, i18n.language) : '—'}</Td>
                  <Td className="text-end">
                    {manage && (
                      <ConfirmButton
                        label={t('integrations.posDisconnect')}
                        title={t('integrations.posDisconnectTitle', {
                          provider: c.provider,
                        })}
                        description={t('integrations.posDisconnectBody')}
                        confirmLabel={t('integrations.posDisconnect')}
                        variant="danger"
                        busy={remove.isPending && remove.variables === c.id}
                        onConfirm={() => remove.mutateAsync(c.id).catch(() => undefined)}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }
      </QueryView>
      <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-canvas/60 p-4">
        <p className="font-display font-bold">{t('integrations.posConnectTitle')}</p>
        <QueryView q={providers}>
          {(list) =>
            list.length === 0 ? (
              // No provider credentials on this platform yet: say so instead of a dead button.
              <p className="text-sm text-muted">{t('integrations.posNoProviders')}</p>
            ) : !manage ? (
              <p className="text-sm text-muted">{t('integrations.viewOnly')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {venues.length > 1 && (
                  <Select
                    label={t('integrations.venue')}
                    value={target}
                    onChange={(e) => setVenueId(e.target.value)}
                    options={venues.map((v) => ({
                      value: v.id,
                      label: v.name,
                    }))}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {list.map((p) => (
                    <Button key={p} variant="ink" busy={connect.isPending && connect.variables === p} disabled={!target} onClick={() => connect.mutate(p)}>
                      {t('integrations.posConnect', {
                        provider: t(`integrations.posProvider.${p}`, {
                          defaultValue: p,
                        }),
                      })}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-muted">{t('integrations.posConnectHint')}</p>
              </div>
            )
          }
        </QueryView>
      </div>
    </Section>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const role = useRole();
  const manage = canManage('integrations', role);
  const venueId = useCurrentVenueId();
  const eyebrow = usePageEyebrow('venue');
  return (
    <PageShell eyebrow={eyebrow} title={t('nav.integrations')} description={t('integrations.intro')}>
      {!manage && (
        <div className="mb-5">
          <Banner tone="info">{t('integrations.viewOnly')}</Banner>
        </div>
      )}
      {venueId && <ApiKeys venueId={venueId} manage={manage} />}
      <Webhooks manage={manage} />
      <PosConnections manage={manage} />
    </PageShell>
  );
}

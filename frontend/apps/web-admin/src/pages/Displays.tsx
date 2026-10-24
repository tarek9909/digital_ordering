import { formatDateTime } from '@dop/client-sdk';
import { displayCreateBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Card, EmptyState, Field, LiveRegion, Modal } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { AddDialog, Checkbox, ConfirmButton, CopyButton, DialogActions, ErrorNote, TabPanel, QueryView, StatusPill } from '../components/common';
import { api } from '../lib/api';
import { MAX_ANNOUNCE_LANGUAGES, MAX_QUIET_HOURS, displayToForm, validateDisplayForm, type DisplayForm, type DisplayFormField } from '../lib/displayForm';
import { applyFieldErrors, errorText } from '../lib/errors';
import { formatDuration, secondsLeft } from '../lib/format';
import type { Counter, DisplayItem, PairingCode } from '../lib/types';
import { useRole } from '../lib/me';
import { useCurrentVenueId, useVenue } from '../lib/venue';
import { countersKey } from './Counters';

const nameSchema = displayCreateBody.pick({ name: true });
const displaysKey = (venueId: string) => ['displays', venueId] as const;

export function useCountdown(expiresAt: string) {
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  useEffect(() => {
    const id = setInterval(() => setLeft(secondsLeft(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function PairingCodeView({ code, onNew, busy }: { code: PairingCode; onNew: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const left = useCountdown(code.expiresAt);
  return (
    <div className="ember-glow @container flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-panel p-5 text-center text-white">
      <p className="text-white/80">{t('displays.pairingIntro')}</p>
      {left > 0 ? (
        <>
          {/* Sized to the panel: the spaced-out code is about 5.4em wide, so it fits a phone or a half-width card. */}
          <p data-motion="pop" dir="ltr" className="num font-display text-[length:clamp(1.75rem,16cqi,3.75rem)] font-extrabold tracking-[0.3em] text-glow" aria-label={code.code.split('').join(' ')}>
            {code.code}
          </p>
          <p className="text-white/70">
            {t('displays.expiresIn')} <span className="num font-semibold">{formatDuration(left)}</span>
          </p>
        </>
      ) : (
        <p role="status" className="font-semibold text-white">
          {t('displays.codeExpired')}
        </p>
      )}
      <Button variant="secondary" className="border-white/20 bg-white/10 text-white hover:bg-white/20" busy={busy} onClick={onNew}>
        {t('displays.newCode')}
      </Button>
    </div>
  );
}

function RenameDialog({ display, venueId }: { display: DisplayItem; venueId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: display.name },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    try {
      await api.patch(`/displays/${display.id}`, { name });
      await qc.invalidateQueries({ queryKey: displaysKey(venueId) });
      setOpen(false);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <>
      <Button variant="secondary" onClick={() => (form.reset({ name: display.name }), setOpen(true))}>
        {t('displays.rename')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('displays.rename')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t('displays.name')} error={form.formState.errors.name ? t('form.required') : undefined} {...form.register('name')} />
          {form.formState.errors.root && <Banner tone="danger">{form.formState.errors.root.message}</Banner>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" busy={form.formState.isSubmitting}>
              {t('common:save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Counter filter, announcements (languages, quiet hours) and promo slot (R1.1, FR-DSP-07). */
function SettingsDialog({ display, venueId }: { display: DisplayItem; venueId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const locales = useVenue(venueId).data?.locales ?? ['ar'];
  const counters = useQuery({
    queryKey: countersKey(venueId),
    queryFn: async () => (await api.get<{ items: Counter[] }>(`/venues/${venueId}/counters`)).items,
  });
  const active = (counters.data ?? []).filter((c) => !c.archived);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<DisplayForm>(() => displayToForm(display, locales));
  const [errors, setErrors] = useState<Partial<Record<DisplayFormField, string>>>({});
  const save = useMutation({
    mutationFn: (body: unknown) => api.patch(`/displays/${display.id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: displaysKey(venueId) });
      setOpen(false);
    },
  });
  const patch = (p: Partial<DisplayForm>) => setF((x) => ({ ...x, ...p }));
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
  const err = (k: DisplayFormField) => (errors[k] ? t(`displays.errors.${k}`) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validateDisplayForm(f, display.settings);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    save.mutate(r.body);
  };
  const fieldError = (k: DisplayFormField) =>
    err(k) ? (
      <p role="alert" className="text-sm text-danger">
        {err(k)}
      </p>
    ) : null;
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setF(displayToForm(display, locales));
          setErrors({});
          save.reset();
          setOpen(true);
        }}
      >
        {t('displays.settings')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('displays.settingsTitle', { name: display.name })}>
        <form
          onSubmit={submit}
          className="flex max-h-[70dvh] flex-col gap-5 overflow-y-auto pe-1 [&>fieldset+fieldset]:border-t [&>fieldset+fieldset]:border-line [&>fieldset+fieldset]:pt-5"
          noValidate
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-display text-base font-bold">{t('displays.counterFilter')}</legend>
            <Checkbox label={t('displays.allCounters')} checked={f.allCounters} onChange={(e) => patch({ allCounters: e.target.checked })} />
            {!f.allCounters &&
              (active.length === 0 ? (
                <p className="text-sm text-muted">{t('displays.noCounters')}</p>
              ) : (
                active.map((c) => (
                  <Checkbox
                    key={c.id}
                    label={c.prefix ? `${c.name} (${c.prefix})` : c.name}
                    checked={f.counterIds.includes(c.id)}
                    onChange={(e) =>
                      patch({
                        counterIds: toggle(f.counterIds, c.id, e.target.checked),
                      })
                    }
                  />
                ))
              ))}
            {fieldError('counterIds')}
          </fieldset>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-display text-base font-bold">{t('displays.announce')}</legend>
            <Checkbox label={t('displays.announceEnabled')} checked={f.announceEnabled} onChange={(e) => patch({ announceEnabled: e.target.checked })} />
            <p className="text-sm text-muted">{t('displays.languagesHint', { max: MAX_ANNOUNCE_LANGUAGES })}</p>
            {locales.map((l) => (
              <Checkbox
                key={l}
                label={t(`languages.${l}`, { defaultValue: l })}
                checked={f.languages.includes(l)}
                disabled={!f.languages.includes(l) && f.languages.length >= MAX_ANNOUNCE_LANGUAGES}
                onChange={(e) => patch({ languages: toggle(f.languages, l, e.target.checked) })}
              />
            ))}
            {fieldError('languages')}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-display text-base font-bold">{t('displays.quietHours')}</legend>
            <p className="text-sm text-muted">{t('displays.quietHoursHint')}</p>
            {f.quietHours.map((q, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <Field
                  label={t('displays.quietFrom', { n: i + 1 })}
                  type="time"
                  dir="ltr"
                  value={q.from}
                  onChange={(e) =>
                    patch({
                      quietHours: f.quietHours.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)),
                    })
                  }
                />
                <Field
                  label={t('displays.quietTo', { n: i + 1 })}
                  type="time"
                  dir="ltr"
                  value={q.to}
                  onChange={(e) =>
                    patch({
                      quietHours: f.quietHours.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    patch({
                      quietHours: f.quietHours.filter((_, j) => j !== i),
                    })
                  }
                >
                  {t('displays.quietRemove')}
                </Button>
              </div>
            ))}
            {f.quietHours.length < MAX_QUIET_HOURS && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    patch({
                      quietHours: [...f.quietHours, { from: '22:00', to: '06:00' }],
                    })
                  }
                >
                  {t('displays.quietAdd')}
                </Button>
              </div>
            )}
            {fieldError('quietHours')}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-display text-base font-bold">{t('displays.promo')}</legend>
            <p className="text-sm text-muted">{t('displays.promoHint')}</p>
            <Checkbox label={t('displays.promoEnabled')} checked={f.promoEnabled} onChange={(e) => patch({ promoEnabled: e.target.checked })} />
            {f.promoEnabled && (
              <>
                {Object.keys(f.promoText).map((l) => (
                  <Field
                    key={l}
                    label={t('displays.promoText', {
                      language: t(`languages.${l}`, { defaultValue: l }),
                    })}
                    lang={l}
                    dir={l === 'ar' ? 'rtl' : 'ltr'}
                    maxLength={280}
                    value={f.promoText[l] ?? ''}
                    onChange={(e) =>
                      patch({
                        promoText: { ...f.promoText, [l]: e.target.value },
                      })
                    }
                  />
                ))}
                {fieldError('promoText')}
                <Field
                  label={t('displays.promoImage')}
                  hint={t('displays.promoImageHint')}
                  type="url"
                  dir="ltr"
                  placeholder="https://"
                  value={f.promoImageUrl}
                  error={err('promoImageUrl')}
                  onChange={(e) => patch({ promoImageUrl: e.target.value })}
                />
              </>
            )}
          </fieldset>

          <ErrorNote error={save.error} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" busy={save.isPending}>
              {t('common:save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function DisplayCard({ d, venueId }: { d: DisplayItem; venueId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [code, setCode] = useState<PairingCode | null>(null);
  const support = useRole() === 'support';
  const pairing = useMutation({
    mutationFn: () => api.post<PairingCode>(`/displays/${d.id}/pairing-code`),
    onSuccess: setCode,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/displays/${d.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: displaysKey(venueId) }),
  });
  return (
    <Card flat className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-input bg-canvas ring-1 ring-line">
            <span className="h-4 w-6 rounded-[3px] border-2 border-ink-2" />
          </span>
          <h2 className="truncate text-lg font-bold">{d.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.paired ? (
            d.online ? (
              <StatusPill tone="ok">{t('displays.online')}</StatusPill>
            ) : (
              <StatusPill tone="danger">{t('displays.offline')}</StatusPill>
            )
          ) : (
            <StatusPill tone="neutral">{t('displays.notPaired')}</StatusPill>
          )}
          {d.paired && !d.soundEnabled && <StatusPill tone="warn">{t('displays.soundOff')}</StatusPill>}
        </div>
      </div>
      {d.paired && !d.soundEnabled && <Banner tone="warn">{t('displays.soundOffHelp')}</Banner>}
      {d.lastSeenAt && (
        <p className="text-sm text-muted">
          {t('displays.lastSeen', {
            date: formatDateTime(d.lastSeenAt, i18n.language),
          })}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink-2">{t('displays.link')}</p>
        <code dir="ltr" className="block rounded-input bg-canvas p-3 font-mono text-sm break-all text-ink-2 ring-1 ring-line">
          {d.url}
        </code>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={d.url} label={t('displays.copyLink')} />
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line hover:bg-canvas">
            {t('displays.openLink')}
          </a>
        </div>
      </div>
      {code && <PairingCodeView code={code} busy={pairing.isPending} onNew={() => pairing.mutate()} />}
      <ErrorNote error={pairing.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        {/* Pairing creates a long-lived display session: not available to a support session (M-13). */}
        {!code && !support && (
          <Button variant="ink" busy={pairing.isPending} onClick={() => pairing.mutate()}>
            {d.paired ? t('displays.repair') : t('displays.pair')}
          </Button>
        )}
        <RenameDialog display={d} venueId={venueId} />
        <SettingsDialog display={d} venueId={venueId} />
        <ConfirmButton
          label={t('displays.unpair')}
          title={t('displays.unpairTitle', { name: d.name })}
          description={t('displays.unpairBody')}
          confirmLabel={t('displays.unpair')}
          variant="danger"
          busy={remove.isPending}
          onConfirm={() => remove.mutateAsync().catch(() => undefined)}
        />
      </div>
    </Card>
  );
}

function CreateDisplay({ venueId, onDone }: { venueId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  });
  const submit = form.handleSubmit(async ({ name }) => {
    try {
      await api.post(`/venues/${venueId}/displays`, { name });
      await qc.invalidateQueries({ queryKey: displaysKey(venueId) });
      onDone();
    } catch (e) {
      if (!applyFieldErrors(e, form.setError, ['name'])) form.setError('root', { message: errorText(t, e) });
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label={t('displays.name')} placeholder={t('displays.namePlaceholder')} error={form.formState.errors.name ? t('form.required') : undefined} {...form.register('name')} />
      {form.formState.errors.root && <Banner tone="danger">{form.formState.errors.root.message}</Banner>}
      <DialogActions onCancel={onDone} submitLabel={t('displays.add')} busy={form.formState.isSubmitting} />
    </form>
  );
}

export function DisplaysPage() {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId();
  const role = useRole();
  const q = useQuery({
    queryKey: displaysKey(venueId ?? ''),
    queryFn: async () => (await api.get<{ items: DisplayItem[] }>(`/venues/${venueId}/displays`)).items,
    enabled: Boolean(venueId),
    refetchInterval: 30_000,
  });
  if (!venueId) return null;
  return (
    <TabPanel
      description={t('displays.description')}
      actions={
        role !== 'support' && (
          <AddDialog label={t('displays.add')} title={t('displays.addTitle')} description={t('displays.addHint')}>
            {(close) => <CreateDisplay venueId={venueId} onDone={close} />}
          </AddDialog>
        )
      }
    >
      <QueryView q={q} skeleton="cards">
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('displays.none')}>{t('displays.noneBody')}</EmptyState>
          ) : (
            <div data-motion="stagger" className="grid gap-4 md:grid-cols-2">
              {items.map((d) => (
                <DisplayCard key={d.id} d={d} venueId={venueId} />
              ))}
            </div>
          )
        }
      </QueryView>
    </TabPanel>
  );
}

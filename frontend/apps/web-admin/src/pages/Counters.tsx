import { counterCreateBody, type VenueSettings } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Field, LiveRegion, Modal, useFlip } from '@dop/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { AddDialog, Checkbox, ConfirmButton, DialogActions, ErrorNote, TabPanel, QueryView, Table, Td } from '../components/common';
import { api } from '../lib/api';
import { applyFieldErrors, isCode } from '../lib/errors';
import type { Counter, VenueAdmin } from '../lib/types';
import { useCurrentVenueId, useVenue, venueKey } from '../lib/venue';

// Counters and prefixes (FR-ADM-07/10): add, rename, reorder, archive; prefixes like "A" or "D1" need the plan
// feature and the numbering switch.

const counterForm = counterCreateBody.pick({ name: true, prefix: true });
type CounterFormValues = { name: string; prefix?: string | null };
export const countersKey = (venueId: string) => ['counters', venueId] as const;

const prefixValue = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);

function CounterFields({ form }: { form: UseFormReturn<CounterFormValues> }) {
  const { t } = useTranslation();
  const { errors } = form.formState;
  const prefixError = errors.prefix ? (errors.prefix.message === 'taken' ? t('counters.prefixTaken') : t('counters.prefixInvalid')) : undefined;
  return (
    <>
      <Field className="min-w-60 flex-1" label={t('counters.name')} placeholder={t('counters.namePlaceholder')} error={errors.name ? t('form.required') : undefined} {...form.register('name')} />
      <Field
        className="w-40"
        label={t('counters.prefix')}
        hint={t('counters.prefixHint')}
        dir="ltr"
        maxLength={3}
        autoCapitalize="characters"
        error={prefixError}
        {...form.register('prefix', { setValueAs: prefixValue })}
      />
    </>
  );
}

/** Server errors: field errors map onto the form; everything else (plan limits too) shows as a note. */
function useServerError(form: UseFormReturn<CounterFormValues>) {
  const [error, setError] = useState<unknown>(null);
  const handle = (e: unknown) => {
    if (!applyFieldErrors(e, form.setError, ['name', 'prefix'])) setError(e);
  };
  return { error, setError, handle };
}

function AddCounter({ venueId, nextOrder, onDone }: { venueId: string; nextOrder: number; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm<CounterFormValues>({
    resolver: zodResolver(counterForm),
    defaultValues: { name: '', prefix: null },
  });
  const { error, setError, handle } = useServerError(form);
  const submit = form.handleSubmit(async (body) => {
    setError(null);
    try {
      await api.post(`/venues/${venueId}/counters`, {
        ...body,
        sortOrder: nextOrder,
      });
      await qc.invalidateQueries({ queryKey: countersKey(venueId) });
      onDone();
    } catch (e) {
      handle(e);
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <CounterFields form={form} />
      {isCode(error, 'PLAN_LIMIT') && <p className="text-sm">{t('counters.limitExplained')}</p>}
      <ErrorNote error={error} />
      <DialogActions onCancel={onDone} submitLabel={t('counters.add')} busy={form.formState.isSubmitting} />
    </form>
  );
}

function EditCounter({ counter, venueId }: { counter: Counter; venueId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<CounterFormValues>({
    resolver: zodResolver(counterForm),
    defaultValues: { name: counter.name, prefix: counter.prefix },
  });
  const { error, setError, handle } = useServerError(form);
  const submit = form.handleSubmit(async (body) => {
    setError(null);
    try {
      await api.patch(`/counters/${counter.id}`, {
        name: body.name,
        prefix: body.prefix ?? null,
      });
      await qc.invalidateQueries({ queryKey: countersKey(venueId) });
      setOpen(false);
    } catch (e) {
      handle(e);
    }
  });
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          form.reset({ name: counter.name, prefix: counter.prefix });
          setError(null);
          setOpen(true);
        }}
      >
        {t('counters.edit')}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t('counters.editTitle', { name: counter.name })}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <CounterFields form={form} />
          <ErrorNote error={error} />
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

/** numbering.prefixesEnabled (FR-ADM-07); FEATURE_NOT_IN_PLAN shows the upsell note. */
function PrefixSwitch({ venue }: { venue: VenueAdmin }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (on: boolean) => {
      const s: VenueSettings = {
        ...venue.settings,
        numbering: { ...venue.settings.numbering, prefixesEnabled: on },
      };
      return api.put<VenueAdmin>(`/venues/${venue.id}/settings`, s);
    },
    onSuccess: (v) => qc.setQueryData(venueKey(venue.id), v),
  });
  return (
    <div className="flex flex-col gap-2">
      <Checkbox
        label={t('venue.flow.prefixesEnabled')}
        hint={t('venue.flow.prefixesHint')}
        checked={venue.settings.numbering.prefixesEnabled}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.checked)}
      />
      <ErrorNote error={save.error} />
      <LiveRegion text={save.isSuccess ? t('common:saved') : ''} />
    </div>
  );
}

export function CountersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const venueId = useCurrentVenueId();
  const venue = useVenue(venueId);
  const q = useQuery({
    queryKey: countersKey(venueId ?? ''),
    queryFn: async () => (await api.get<{ items: Counter[] }>(`/venues/${venueId}/counters`)).items,
    enabled: Boolean(venueId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: countersKey(venueId ?? '') });
  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/counters/${id}/archive`),
    onSuccess: refresh,
  });
  // Reorder: swap two neighbours and renumber the list in steps of 10.
  const move = useMutation({
    mutationFn: async ({ list, from, to }: { list: Counter[]; from: number; to: number }) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (!item) return;
      next.splice(to, 0, item);
      await Promise.all(next.map((c, i) => (c.sortOrder === i * 10 ? null : api.patch(`/counters/${c.id}`, { sortOrder: i * 10 }))));
    },
    onSettled: refresh,
  });
  const active = (q.data ?? []).filter((c) => !c.archived);
  // Reordered rows glide to their new place (FLIP); reduced motion skips it.
  const list = useRef<HTMLTableSectionElement>(null);
  useFlip(list, [active.map((c) => c.id).join()]);
  if (!venueId) return null;

  return (
    <TabPanel
      description={t('counters.description')}
      actions={
        <AddDialog label={t('counters.add')} title={t('counters.addTitle')} description={t('counters.addHint')}>
          {(close) => <AddCounter venueId={venueId} nextOrder={active.length * 10} onDone={close} />}
        </AddDialog>
      }
    >
      <div className="mb-5">
        <QueryView q={venue}>{(v) => <PrefixSwitch venue={v} />}</QueryView>
      </div>
      <div className="mb-3 empty:hidden">
        <ErrorNote error={archive.error ?? move.error} />
      </div>
      <QueryView q={q} skeleton="table">
        {() =>
          active.length === 0 ? (
            <EmptyState title={t('counters.none')}>{t('counters.noneBody')}</EmptyState>
          ) : (
            <Table raised bodyRef={list} caption={t('nav.counters')} head={[t('counters.order'), t('counters.name'), t('counters.prefix'), '']}>
              <CounterRows active={active} venueId={venueId} move={move} archive={archive} />
            </Table>
          )
        }
      </QueryView>
      <LiveRegion text={archive.isSuccess ? t('counters.archived') : ''} />
    </TabPanel>
  );
}

type MoveMutation = {
  isPending: boolean;
  mutate: (v: { list: Counter[]; from: number; to: number }) => void;
};
type ArchiveMutation = {
  isPending: boolean;
  variables: string | undefined;
  mutateAsync: (id: string) => Promise<unknown>;
};

/** Rows carry data-flip-id so a reorder glides inside the table body. */
function CounterRows({ active, venueId, move, archive }: { active: Counter[]; venueId: string; move: MoveMutation; archive: ArchiveMutation }) {
  const { t } = useTranslation();
  return (
    <>
      {active.map((c, i) => (
        <tr key={c.id} data-flip-id={c.id}>
          <Td className="num w-16 font-display text-base font-bold text-muted">{i + 1}</Td>
          <Td className="font-semibold">{c.name}</Td>
          <Td>
            {c.prefix ? (
              <span dir="ltr" className="inline-grid min-w-9 place-items-center rounded-input bg-canvas px-2 py-1 font-mono text-sm font-semibold ring-1 ring-line">
                {c.prefix}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Td>
          <Td>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" aria-label={t('counters.moveUp', { name: c.name })} disabled={i === 0 || move.isPending} onClick={() => move.mutate({ list: active, from: i, to: i - 1 })}>
                <span aria-hidden="true">↑</span>
              </Button>
              <Button
                variant="ghost"
                aria-label={t('counters.moveDown', { name: c.name })}
                disabled={i === active.length - 1 || move.isPending}
                onClick={() => move.mutate({ list: active, from: i, to: i + 1 })}
              >
                <span aria-hidden="true">↓</span>
              </Button>
              <EditCounter counter={c} venueId={venueId} />
              <ConfirmButton
                label={t('counters.archive')}
                title={t('counters.archiveTitle', { name: c.name })}
                description={t('counters.archiveBody')}
                confirmLabel={t('counters.archive')}
                variant="danger"
                busy={archive.isPending && archive.variables === c.id}
                onConfirm={() => archive.mutateAsync(c.id).catch(() => undefined)}
              />
            </div>
          </Td>
        </tr>
      ))}
    </>
  );
}

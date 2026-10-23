import { announcementBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, EmptyState, Field, LiveRegion, Modal, PageShell, Pill, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNote, FormButtons, Section, Segmented, TextArea } from '../components/common';
import { TenantPicker } from '../components/TenantPicker';
import { api } from '../lib/api';
import { buildTarget, describeTarget, jsonValue, type TargetMode } from '../lib/announcement';
import { fmtDate, localToIso } from '../lib/format';
import { isoToLocal } from '../lib/settingsForm';
import type { Announcement, Plan } from '../lib/types';

// Announcements shown as banners in tenant admin areas (FR-SA-13).

const LANGS = ['ar', 'en'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;
type Severity = (typeof SEVERITIES)[number];
const TONE: Record<Severity, 'info' | 'warn' | 'danger'> = { info: 'info', warning: 'warn', critical: 'danger' };
const DURATIONS = [1, 3, 7, 14] as const;
type When = 'live' | 'scheduled' | 'ended';
const whenOf = (a: Announcement, now: number): When => (Date.parse(a.ends_at) <= now ? 'ended' : Date.parse(a.starts_at) > now ? 'scheduled' : 'live');

export function AnnouncementsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [announce, setAnnounce] = useState('');
  const [remove, setRemove] = useState<Announcement | null>(null);
  const q = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<{ items: Announcement[] }>('/announcements') });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      setRemove(null);
      setAnnounce(t('announcements.deleted'));
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
  const now = Date.now();
  const items = q.data?.items ?? [];
  const groups = (['live', 'scheduled', 'ended'] as const).map((w) => ({ when: w, items: items.filter((a) => whenOf(a, now) === w) })).filter((g) => g.items.length);
  return (
    <PageShell wide eyebrow={t('layout.groups.platform')} title={t('announcements.title')} description={t('announcements.description')}>
      <LiveRegion text={announce} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <CreateForm
          onDone={() => {
            setAnnounce(t('announcements.created'));
            void qc.invalidateQueries({ queryKey: ['announcements'] });
          }}
        />
        <div className="flex flex-col gap-5">
          <ErrorNote error={q.error} />
          {q.isPending ? (
            <Spinner label={t('common:loading')} />
          ) : groups.length === 0 ? (
            <EmptyState title={t('announcements.none')}>{t('announcements.emptyHint')}</EmptyState>
          ) : (
            groups.map((g) => (
              <section key={g.when} aria-labelledby={`ann-${g.when}`} className="flex flex-col gap-3">
                <h2 id={`ann-${g.when}`} className="eyebrow">
                  {t(`announcementsUx.when.${g.when}`)} · <span className="num">{g.items.length}</span>
                </h2>
                {g.items.map((a) => (
                  <AnnouncementCard key={a.id} a={a} when={g.when} onDelete={() => setRemove(a)} />
                ))}
              </section>
            ))
          )}
        </div>
      </div>
      {remove && (
        <Modal open onOpenChange={(o) => !o && setRemove(null)} title={t('announcements.deleteTitle')} description={t('announcements.deleteBody')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              del.mutate(remove.id);
            }}
            className="flex flex-col gap-4"
          >
            <ErrorNote error={del.error} />
            <FormButtons onCancel={() => setRemove(null)} busy={del.isPending} label={t('announcements.delete')} danger />
          </form>
        </Modal>
      )}
    </PageShell>
  );
}

function AnnouncementCard({ a, when, onDelete }: { a: Announcement; when: When; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  const l = i18n.language;
  const msg = jsonValue<Record<string, string>>(a.message, {});
  const target = describeTarget(a.target);
  const sev = (SEVERITIES as readonly string[]).includes(a.severity) ? a.severity : 'info';
  return (
    <article className={`flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface p-4 shadow-card ${when === 'ended' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone={TONE[sev]}>{t(`announcements.sev.${sev}`)}</Pill>
          {when === 'live' ? <Pill tone="ok">{t('announcementsUx.when.live')}</Pill> : <Pill>{t(`announcementsUx.when.${when}`)}</Pill>}
        </span>
        <Button variant="ghost" className="text-sm text-danger" onClick={onDelete}>
          {t('announcements.delete')}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        {LANGS.filter((x) => msg[x]).map((x) => (
          <p key={x} lang={x} dir={x === 'ar' ? 'rtl' : 'ltr'} className="text-[0.9375rem] break-words">
            <span className="me-2 font-mono text-[0.6875rem] text-muted">{x.toUpperCase()}</span>
            {msg[x]}
          </p>
        ))}
      </div>
      <dl className="grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t('announcements.target')}</dt>
          <dd className="font-medium break-words">
            {t(`announcements.mode.${target.kind}`)}
            {target.kind === 'plans' && target.items.length > 0 && <span className="text-ink-2"> · {target.items.map((p) => t(`plan.${p}`, { defaultValue: p })).join(', ')}</span>}
            {target.kind === 'tenants' && <span className="text-ink-2"> · {t('announcementsUx.tenantCount', { count: target.items.length })}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('announcementsUx.shown')}</dt>
          {/* Each date stays on one line; the range breaks at the arrow when the card is narrow. */}
          <dd className="font-medium">
            <span className="whitespace-nowrap">{fmtDate(a.starts_at, l)}</span> → <span className="whitespace-nowrap">{fmtDate(a.ends_at, l)}</span>
          </dd>
        </div>
      </dl>
    </article>
  );
}

interface Errors {
  message?: string;
  target?: string;
  startsAt?: string;
  endsAt?: string;
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  const blank = () => ({
    ar: '',
    en: '',
    severity: 'info' as Severity,
    mode: 'all' as TargetMode,
    tenants: new Map<string, string>(),
    plans: [] as string[],
    startsAt: isoToLocal(new Date().toISOString()),
    endsAt: isoToLocal(new Date(Date.now() + 86_400_000).toISOString()),
  });
  const [v, setV] = useState(blank);
  const [errs, setErrs] = useState<Errors>({});
  const m = useMutation({
    mutationFn: (body: unknown) => api.post('/announcements', body),
    onSuccess: () => {
      setV(blank());
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    const message = Object.fromEntries(LANGS.map((x) => [x, v[x].trim()] as const).filter(([, s]) => s));
    if (Object.keys(message).length === 0 || Object.values(message).some((s) => s.length > 500)) next.message = t('announcements.messageInvalid');
    const target = buildTarget(v.mode, [...v.tenants.keys()].join(' '), v.plans);
    if (!target.ok) next.target = target.error === 'empty' ? t('announcements.targetEmpty') : t('announcements.targetBadId', { id: target.detail ?? '' });
    const startsAt = localToIso(v.startsAt);
    const endsAt = localToIso(v.endsAt);
    if (!startsAt) next.startsAt = t('announcements.dateInvalid');
    if (!endsAt) next.endsAt = t('announcements.dateInvalid');
    else if (startsAt && endsAt <= startsAt) next.endsAt = t('announcements.endBeforeStart');
    setErrs(next);
    if (Object.keys(next).length || !target.ok) return;
    const r = announcementBody.safeParse({ message, severity: v.severity, target: target.target, startsAt, endsAt });
    if (!r.success) {
      setErrs({ message: t('announcements.messageInvalid') });
      return;
    }
    m.mutate(r.data);
  };
  const lasting = (daysCount: number) => {
    const start = localToIso(v.startsAt) ?? new Date().toISOString();
    setV({ ...v, endsAt: isoToLocal(new Date(Date.parse(start) + daysCount * 86_400_000).toISOString()) });
  };
  const preview = v.en.trim() || v.ar.trim();
  const previewLang = v.en.trim() ? 'en' : 'ar';
  return (
    <Section title={t('announcements.create')} description={t('announcementsUx.createIntro')}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <ErrorNote error={m.error} />
        <div className="grid gap-3 lg:grid-cols-2">
          {LANGS.map((x) => (
            <TextArea
              key={x}
              label={t('announcements.messageIn', { lang: t(`lang.${x}`) })}
              lang={x}
              dir={x === 'ar' ? 'rtl' : 'ltr'}
              maxLength={500}
              hint={t('announcementsUx.chars', { count: v[x].length })}
              className="min-h-28 rounded-input border border-line bg-surface p-3 text-base"
              value={v[x]}
              onChange={(e) => setV({ ...v, [x]: e.target.value })}
            />
          ))}
        </div>
        {errs.message && (
          <p role="alert" className="-mt-3 text-sm text-danger">
            {errs.message}
          </p>
        )}
        <Segmented label={t('announcements.severity')} value={v.severity} onChange={(severity) => setV({ ...v, severity })} options={SEVERITIES.map((s) => ({ value: s, label: t(`announcements.sev.${s}`) }))} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink-2">{t('announcementsUx.preview')}</span>
          <div lang={previewLang} dir={previewLang === 'ar' ? 'rtl' : 'ltr'}>
            <Banner tone={TONE[v.severity]}>{preview || <span className="opacity-70">{t('announcementsUx.previewEmpty')}</span>}</Banner>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Segmented label={t('announcements.target')} value={v.mode} onChange={(mode) => setV({ ...v, mode })} options={(['all', 'tenants', 'plans'] as const).map((mode) => ({ value: mode, label: t(`announcements.mode.${mode}`) }))} />
          {v.mode === 'tenants' && <TenantPicker label={t('announcementsUx.chooseTenants')} selected={v.tenants} onChange={(tenants) => setV({ ...v, tenants })} />}
          {v.mode === 'plans' && (
            <div className="flex flex-col gap-2">
              <ErrorNote error={plans.error} />
              <div className="flex flex-wrap gap-2">
                {plans.data?.items.map((p) => {
                  const on = v.plans.includes(p.code);
                  return (
                    <label
                      key={p.id}
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${on ? 'bg-ink text-white ring-ink' : 'bg-surface text-ink-2 ring-line hover:text-ink'}`}
                    >
                      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setV({ ...v, plans: e.target.checked ? [...v.plans, p.code] : v.plans.filter((x) => x !== p.code) })} />
                      <span aria-hidden="true">{on ? '✓' : '+'}</span>
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {errs.target && (
            <p role="alert" className="text-sm text-danger">
              {errs.target}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('announcements.starts')} type="datetime-local" value={v.startsAt} error={errs.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
            <Field label={t('announcements.ends')} type="datetime-local" value={v.endsAt} error={errs.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-muted">{t('announcementsUx.lasts')}</span>
            {DURATIONS.map((n) => (
              <button key={n} type="button" className="min-h-12 rounded-full lg:min-h-10 px-3 text-sm font-semibold text-ink-2 ring-1 ring-line hover:bg-canvas hover:text-ink" onClick={() => lasting(n)}>
                {t('announcementsUx.days', { count: n })}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{t('announcements.timeZoneNote')}</p>
        </div>
        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" busy={m.isPending}>
            {t('announcements.publish')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

import { announcementBody } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, EmptyState, Field, LiveRegion, Modal, PageShell, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Checkbox, ErrorNote, FormButtons, Table, Td, TextArea } from '../components/common';
import { api } from '../lib/api';
import { buildTarget, describeTarget, jsonValue, type TargetMode } from '../lib/announcement';
import { fmtDate, localToIso } from '../lib/format';
import type { Announcement, Plan } from '../lib/types';

// Announcements shown as banners in tenant admin areas (FR-SA-13).

const LANGS = ['ar', 'en'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
/** Date → `datetime-local` value in the browser's zone. */
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function AnnouncementsPage() {
  const { t, i18n } = useTranslation();
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
  const l = i18n.language;
  return (
    <PageShell eyebrow={t('layout.groups.platform')} title={t('announcements.title')} description={t('announcements.description')}>
      <LiveRegion text={announce} />
      <div className="flex flex-col gap-6">
        <CreateForm
          onDone={() => {
            setAnnounce(t('announcements.created'));
            void qc.invalidateQueries({ queryKey: ['announcements'] });
          }}
        />
        <ErrorNote error={q.error} />
        {q.isPending ? (
          <Spinner label={t('common:loading')} />
        ) : q.data?.items.length === 0 ? (
          <EmptyState title={t('announcements.none')}>{t('announcements.emptyHint')}</EmptyState>
        ) : (
          <Table caption={t('announcements.list')} head={[t('announcements.message'), t('announcements.severity'), t('announcements.target'), t('announcements.starts'), t('announcements.ends'), '']}>
            {q.data?.items.map((a) => {
              const msg = jsonValue<Record<string, string>>(a.message, {});
              const target = describeTarget(a.target);
              return (
                <tr key={a.id}>
                  <Td>
                    {LANGS.filter((x) => msg[x]).map((x) => (
                      <p key={x} lang={x} dir={x === 'ar' ? 'rtl' : 'ltr'}>
                        <span className="text-xs text-muted">{x.toUpperCase()}</span> {msg[x]}
                      </p>
                    ))}
                  </Td>
                  <Td>{t(`announcements.sev.${a.severity}`, { defaultValue: a.severity })}</Td>
                  <Td>
                    {t(`announcements.mode.${target.kind}`)}
                    {target.items.length > 0 && (
                      <span dir="ltr" className="block text-xs text-muted">
                        {target.items.join(', ')}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(a.starts_at, l)}</Td>
                  <Td className="whitespace-nowrap text-ink-2">{fmtDate(a.ends_at, l)}</Td>
                  <Td>
                    <Button variant="ghost" onClick={() => setRemove(a)}>
                      {t('announcements.delete')}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
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

interface Errors {
  message?: string;
  target?: string;
  startsAt?: string;
  endsAt?: string;
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  const blank = () => ({ ar: '', en: '', severity: 'info', mode: 'all' as TargetMode, ids: '', plans: [] as string[], startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 86_400_000)) });
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
    const target = buildTarget(v.mode, v.ids, v.plans);
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
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">{t('announcements.create')}</h2>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <ErrorNote error={m.error} />
        <div className="grid gap-3 lg:grid-cols-2">
          {LANGS.map((x) => (
            <TextArea
              key={x}
              label={t('announcements.messageIn', { lang: t(`lang.${x}`) })}
              lang={x}
              dir={x === 'ar' ? 'rtl' : 'ltr'}
              maxLength={500}
              className="min-h-24 rounded-input border border-line bg-surface p-3 text-base"
              value={v[x]}
              onChange={(e) => setV({ ...v, [x]: e.target.value })}
            />
          ))}
        </div>
        {errs.message && (
          <p role="alert" className="text-sm text-danger">
            {errs.message}
          </p>
        )}
        <Select label={t('announcements.severity')} value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} options={SEVERITIES.map((s) => ({ value: s, label: t(`announcements.sev.${s}`) }))} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('announcements.target')}</legend>
          <div className="flex flex-wrap gap-4">
            {(['all', 'tenants', 'plans'] as const).map((mode) => (
              <label key={mode} className="inline-flex min-h-12 items-center gap-2">
                <input type="radio" className="size-5" name="ann-target" checked={v.mode === mode} onChange={() => setV({ ...v, mode })} />
                {t(`announcements.mode.${mode}`)}
              </label>
            ))}
          </div>
          {v.mode === 'tenants' && <TextArea label={t('announcements.tenantIds')} dir="ltr" spellCheck={false} hint={t('announcements.tenantIdsHint')} value={v.ids} onChange={(e) => setV({ ...v, ids: e.target.value })} />}
          {v.mode === 'plans' && (
            <div className="flex flex-wrap gap-x-6">
              <ErrorNote error={plans.error} />
              {plans.data?.items.map((p) => (
                <Checkbox
                  key={p.id}
                  label={`${p.name} (${p.code})`}
                  checked={v.plans.includes(p.code)}
                  onChange={(e) => setV({ ...v, plans: e.target.checked ? [...v.plans, p.code] : v.plans.filter((x) => x !== p.code) })}
                />
              ))}
            </div>
          )}
          {errs.target && (
            <p role="alert" className="text-sm text-danger">
              {errs.target}
            </p>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('announcements.starts')} type="datetime-local" value={v.startsAt} error={errs.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} />
          <Field label={t('announcements.ends')} type="datetime-local" value={v.endsAt} error={errs.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
        </div>
        <p className="text-sm text-muted">{t('announcements.timeZoneNote')}</p>
        <div className="flex justify-end">
          <Button type="submit" busy={m.isPending}>
            {t('announcements.publish')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

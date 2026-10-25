import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Banner, Button, Field, LiveRegion, PageShell, Select, Spinner } from '@dop/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ChimeLibrary } from '../components/ChimeLibrary';
import { ErrorNote, ListField, Section, Segmented, tabPanelProps, Tabs, TextArea, Toggle } from '../components/common';
import { MfaCancelled, useFreshMfa } from '../components/FreshMfa';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { fmtDate, localToIso } from '../lib/format';
import { checkSetting, CURRENCIES, FIELD_KINDS, groupSettings, humanize, isoToLocal, isPlainObject, pathKey, sameValue, setPath, timeZones, type FieldKind, type Problem } from '../lib/settingsForm';
import type { Chime, Language, SettingRow } from '../lib/types';

// Platform settings as forms (appendix 30.4), languages and the chime library (FR-SA-09 – FR-SA-12). Each section
// saves its changed settings; platform settings need a recent second factor (L-6).

type Tab = 'general' | 'languages' | 'chimes';

const GROUP_ICONS: Record<string, React.ReactNode> = {
  newTenants: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  billing: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  maintenance: (
    <svg aria-hidden="true" className="size-5 text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  delivery: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  data: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
  security: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  other: (
    <svg aria-hidden="true" className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  ),
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');
  const [announce, setAnnounce] = useState('');
  return (
    <PageShell eyebrow={t('layout.groups.platform')} title={t('settings.title')} description={t('settings.description')}>
      <LiveRegion toast text={announce} />
      <Tabs
        id="settings"
        label={t('settings.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'general',
            label: t('settingsForm.tabs.general'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ),
          },
          {
            value: 'languages',
            label: t('settings.languages'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
              </svg>
            ),
          },
          {
            value: 'chimes',
            label: t('settings.chimes'),
            icon: (
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            ),
          },
        ]}
      />
      {/* The general settings stay mounted so unsaved changes survive a look at another tab. */}
      <div {...tabPanelProps('settings', 'general')} hidden={tab !== 'general'}>
        <PlatformSettings onSaved={(n) => setAnnounce(t('settingsForm.savedCount', { count: n }))} />
      </div>
      {tab !== 'general' && <div {...tabPanelProps('settings', tab)}>{tab === 'languages' ? <Languages onSaved={() => setAnnounce(t('common:saved'))} /> : <ChimeLibrary />}</div>}
    </PageShell>
  );
}

/** Lookups the special inputs need (languages for per-language text, chimes for the default chime). */
function useLookups() {
  const languages = useQuery({ queryKey: ['languages'], queryFn: () => api.get<{ items: Language[] }>('/languages') });
  const chimes = useQuery({ queryKey: ['chimes'], queryFn: () => api.get<{ items: Chime[] }>('/chimes') });
  return { languages: languages.data?.items ?? [], chimes: chimes.data?.items ?? [] };
}
type Lookups = ReturnType<typeof useLookups>;

function PlatformSettings({ onSaved }: { onSaved: (count: number) => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ items: SettingRow[] }>('/settings') });
  const lookups = useLookups();
  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.error) return <ErrorNote error={q.error} />;
  const groups = groupSettings(q.data.items);
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <SettingsGroup key={g.id} id={g.id} rows={g.rows} lookups={lookups} onSaved={onSaved} />
      ))}
    </div>
  );
}

/** One section: its settings as fields, saved together. Only changed settings are sent. */
function SettingsGroup({ id, rows, lookups, onSaved }: { id: string; rows: SettingRow[]; lookups: Lookups; onSaved: (count: number) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa();
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [problems, setProblems] = useState<Problem[]>([]);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Bumped on discard so inputs holding their own text (numbers) start again from the saved value.
  const [version, setVersion] = useState(0);
  const valueOf = (r: SettingRow) => (r.key in drafts ? drafts[r.key] : r.value);
  const dirty = rows.filter((r) => r.key in drafts && !sameValue(drafts[r.key], r.value));

  const change = (key: string, v: unknown) => {
    setDrafts((d) => ({ ...d, [key]: v }));
    setProblems((p) => p.filter((x) => !x.path.startsWith(key)));
  };
  const discard = () => {
    setDrafts({});
    setProblems([]);
    setServerErrors({});
    setVersion((n) => n + 1);
  };
  const save = async () => {
    const found = dirty.flatMap((r) => checkSetting(r.key, drafts[r.key]));
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    const failed: Record<string, string> = {};
    let saved = 0;
    for (const r of dirty) {
      try {
        await run(() => api.put(`/settings/${encodeURIComponent(r.key)}`, { value: drafts[r.key] }));
        saved++;
        setDrafts(({ [r.key]: _done, ...rest }) => rest);
      } catch (e) {
        if (e instanceof MfaCancelled) break;
        failed[r.key] = e instanceof ApiError && e.problem?.detail ? `${errorText(t, e)} ${e.problem.detail}` : errorText(t, e);
      }
    }
    setServerErrors(failed);
    setBusy(false);
    if (saved) {
      onSaved(saved);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    }
  };
  const problemAt = (path: string) => {
    const p = problems.find((x) => x.path === path);
    return p ? t(p.message, p.values) : undefined;
  };
  const latest = rows.map((r) => r.updatedAt).filter((d): d is string => Boolean(d)).sort().pop();
  const icon = GROUP_ICONS[id];

  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          {icon && <span className="grid size-8 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">{icon}</span>}
          <span>{t(`settingsForm.groups.${id}.title`, { defaultValue: humanize(id) })}</span>
        </span>
      }
      description={t(`settingsForm.groups.${id}.hint`, { defaultValue: '' }) || undefined}
      actions={
        latest ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1 text-xs font-medium text-muted ring-1 ring-line">
            <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('settings.updatedAt', { date: fmtDate(latest, i18n.language) })}
          </span>
        ) : undefined
      }
    >
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col divide-y divide-line">
          {rows.map((r) => (
            <div key={`${r.key}:${version}`} className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
              <SettingValue path={r.key} value={valueOf(r)} onChange={(v) => change(r.key, v)} lookups={lookups} problemAt={problemAt} top />
              {serverErrors[r.key] && <Banner tone="danger">{serverErrors[r.key]}</Banner>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          {dirty.length > 0 && (
            <span className="me-auto inline-flex items-center gap-2 rounded-full bg-warn/10 px-3 py-1 text-xs font-semibold text-warn ring-1 ring-warn/30">
              <span className="size-2 rounded-full bg-warn animate-pulse" />
              {t('settingsForm.unsaved', { count: dirty.length })}
            </span>
          )}
          <Button type="button" variant="ghost" disabled={!dirty.length || busy} onClick={discard}>
            {t('settingsForm.discard')}
          </Button>
          <Button type="submit" disabled={!dirty.length} busy={busy}>
            {t('settingsForm.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

interface ValueProps {
  path: string;
  value: unknown;
  onChange: (v: unknown) => void;
  lookups: Lookups;
  problemAt: (path: string) => string | undefined;
  /** The setting itself (not a field inside it): its title and hint describe the whole setting. */
  top?: boolean;
}

type T = ReturnType<typeof useTranslation>['t'];
const labelFor = (t: T, path: string) => t(`settingsForm.f.${pathKey(path)}.label`, { defaultValue: humanize(path.split('.').pop() ?? path) });
const hintFor = (t: T, path: string) => t(`settingsForm.f.${pathKey(path)}.hint`, { defaultValue: '' }) || undefined;

/** One setting or one field inside it, laid out from its known kind or from the shape of the value. */
function SettingValue({ path, value, onChange, lookups, problemAt, top }: ValueProps) {
  const { t } = useTranslation();
  const spec = FIELD_KINDS[path];
  const label = labelFor(t, path);
  const hint = hintFor(t, path);
  const error = problemAt(path);

  if (isPlainObject(value) && spec?.kind !== 'perLanguage') {
    const entries = Object.entries(value);
    const body = (
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        {entries.map(([k, v]) => {
          const child = `${path}.${k}`;
          const wide = isPlainObject(v) || Array.isArray(v) || FIELD_KINDS[child]?.kind === 'perLanguage' || typeof v === 'boolean';
          return (
            <div key={k} className={wide ? 'md:col-span-2' : undefined}>
              <SettingValue path={child} value={v} lookups={lookups} problemAt={problemAt} onChange={(x) => onChange(setPath(value, [k], x))} />
            </div>
          );
        })}
      </div>
    );
    return top ? (
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 flex flex-col gap-0.5">
          <span className="font-semibold">{label}</span>
          {hint && <span className="text-sm text-muted">{hint}</span>}
        </legend>
        {body}
      </fieldset>
    ) : (
      <fieldset className="flex flex-col gap-4 rounded-input border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink-2">{label}</legend>
        {hint && <p className="-mt-2 text-sm text-muted">{hint}</p>}
        {body}
      </fieldset>
    );
  }
  return <Leaf spec={spec} path={path} label={label} hint={hint} error={error} value={value} onChange={onChange} lookups={lookups} />;
}

function Leaf({ spec, path, label, hint, error, value, onChange, lookups }: { spec: FieldKind | undefined; path: string; label: string; hint?: string; error?: string; value: unknown; onChange: (v: unknown) => void; lookups: Lookups }) {
  const { t, i18n } = useTranslation();
  const kind = spec?.kind ?? (typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : Array.isArray(value) ? 'list' : 'text');

  if (kind === 'boolean') return <Toggle label={label} hint={hint} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  if (kind === 'number' && (!spec || spec.kind === 'number'))
    return <UnitNumber label={label} hint={hint} error={error} value={value as number} unit={spec?.unit} min={spec?.min} max={spec?.max} onChange={onChange} />;
  if (kind === 'time') return <Field label={label} hint={hint} error={error} type="time" dir="ltr" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="max-w-48" />;
  if (kind === 'timezone')
    return <Select label={label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} options={timeZones(String(value ?? '')).map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} className="max-w-sm" />;
  if (kind === 'currency') {
    const cur = String(value ?? '');
    const list = CURRENCIES.includes(cur) || !cur ? CURRENCIES : [cur, ...CURRENCIES];
    return <Select label={label} value={cur} onChange={(e) => onChange(e.target.value)} options={list.map((c) => ({ value: c, label: c }))} className="max-w-48" />;
  }
  if (kind === 'chime') {
    const cur = String(value ?? '');
    const list = lookups.chimes.filter((c) => c.active || c.code === cur);
    const options = list.length ? list.map((c) => ({ value: c.code, label: c.name })) : [{ value: cur, label: cur }];
    return <Select label={label} value={cur} onChange={(e) => onChange(e.target.value)} options={options} className="max-w-sm" />;
  }
  if (kind === 'waitMode')
    return (
      <div className="flex flex-col gap-1">
        <Segmented label={label} value={String(value)} onChange={onChange} options={(['manual', 'auto', 'off'] as const).map((m) => ({ value: m, label: t(`settingsForm.waitMode.${m}`) }))} />
        <p className="text-sm text-muted">{t(`settingsForm.waitModeHint.${String(value)}`, { defaultValue: '' })}</p>
      </div>
    );
  if (kind === 'languages') return <LanguagePicker label={label} hint={hint} error={error} value={(value as string[]) ?? []} languages={lookups.languages} onChange={onChange} />;
  if (kind === 'perLanguage') {
    const msg = isPlainObject(value) ? (value as Record<string, string>) : {};
    const codes = [...new Set([...lookups.languages.map((l) => l.code), ...Object.keys(msg)])];
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink-2">{label}</span>
          {hint && <span className="text-sm text-muted">{hint}</span>}
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          {codes.map((c) => {
            const lang = lookups.languages.find((l) => l.code === c);
            return (
              <TextArea
                key={c}
                label={t('settingsForm.inLanguage', { lang: lang?.name ?? c })}
                lang={c}
                dir={lang?.direction ?? 'ltr'}
                maxLength={280}
                className="min-h-20 rounded-input border border-line bg-surface p-3 text-base"
                value={msg[c] ?? ''}
                onChange={(e) => {
                  const { [c]: _old, ...rest } = msg;
                  onChange(e.target.value ? { ...rest, [c]: e.target.value } : rest);
                }}
              />
            );
          })}
        </div>
      </fieldset>
    );
  }
  if (kind === 'datetime') {
    const local = isoToLocal(value as string | null);
    return (
      <div className="flex flex-wrap items-end gap-3">
        <Field label={label} hint={hint ?? (local ? undefined : t('settingsForm.noEnd'))} type="datetime-local" value={local} onChange={(e) => onChange(localToIso(e.target.value) ?? null)} className="max-w-xs" />
        {local && (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            {t('settingsForm.clearTime')}
          </Button>
        )}
        {local && <span className="pb-3 text-sm text-muted">{fmtDate(value as string, i18n.language)}</span>}
      </div>
    );
  }
  if (kind === 'secondsList' && spec?.kind === 'secondsList') {
    const list = (value as number[]) ?? [];
    return (
      <ListField<number>
        label={label}
        hint={hint ?? t('settingsForm.secondsListHint', { min: spec.min, max: spec.max, n: spec.count })}
        values={list}
        max={spec.count}
        inputMode="numeric"
        placeholder={t('settingsForm.secondsPlaceholder')}
        format={(s) => fmtSeconds(t, s)}
        parse={(s) => {
          const n = Number(s);
          return Number.isInteger(n) && n >= spec.min && n <= spec.max ? { ok: true, value: n } : { ok: false, error: t('settingsForm.invalid.range', { min: spec.min, max: spec.max }) };
        }}
        onChange={(v) => onChange([...v].sort((a, b) => a - b))}
      />
    );
  }
  if (kind === 'addressList')
    return (
      <ListField<string>
        label={label}
        hint={hint}
        values={(value as string[]) ?? []}
        placeholder="203.0.113.0/24"
        parse={(s) => (/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(s) ? { ok: true, value: s } : { ok: false, error: t('settingsForm.invalid.address') })}
        onChange={onChange}
      />
    );
  if (kind === 'list') {
    const list = (value as Array<string | number>) ?? [];
    const numeric = list.length > 0 && list.every((x) => typeof x === 'number');
    return (
      <ListField<string | number>
        label={label}
        hint={hint}
        values={list}
        inputMode={numeric ? 'numeric' : undefined}
        parse={(s) => (numeric ? (Number.isFinite(Number(s)) ? { ok: true, value: Number(s) } : { ok: false, error: t('settingsForm.invalid.whole') }) : { ok: true, value: s })}
        onChange={onChange}
      />
    );
  }
  // Text; an empty value that started as null stays null.
  return <Field label={label} hint={hint} error={error} value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' && value === null ? null : e.target.value)} />;
}

const fmtSeconds = (t: T, s: number) => (s % 60 === 0 ? t('settingsForm.unit.minutesShort', { count: s / 60 }) : t('settingsForm.unit.secondsShort', { count: s }));

/** A whole number with its unit next to it ("days", "per second"). */
function UnitNumber({ label, hint, error, value, unit, min, max, onChange }: { label: string; hint?: string; error?: string; value: number; unit?: string; min?: number; max?: number; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  const range = min !== undefined && max !== undefined ? t('settingsForm.rangeHint', { min, max }) : min !== undefined && min > 0 ? t('settingsForm.minHint', { min }) : undefined;
  const help = [hint, range].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-2">
        {label}
      </label>
      <div className={`flex min-h-12 max-w-56 items-center overflow-hidden rounded-input border bg-surface transition-all duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 ${error ? 'border-danger ring-2 ring-danger/20' : 'border-line'}`}>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={min}
          max={max}
          className="num min-w-0 flex-1 bg-transparent px-3.5 text-base font-medium outline-none"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : help ? `${id}-h` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value === '' ? NaN : Number(e.target.value));
          }}
        />
        {unit && <span className="shrink-0 border-s border-line bg-canvas/60 px-3 py-3 text-xs font-semibold uppercase tracking-wider text-muted">{t(`settingsForm.unit.${unit}`)}</span>}
      </div>
      {help && !error && (
        <p id={`${id}-h`} className="text-xs text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-e`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Languages as pill checkboxes, in the platform's language list order. */
function LanguagePicker({ label, hint, error, value, languages, onChange }: { label: string; hint?: string; error?: string; value: string[]; languages: Language[]; onChange: (v: unknown) => void }) {
  const codes = [...new Set([...languages.map((l) => l.code), ...value])];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-ink-2">{label}</legend>
      <div className="flex flex-wrap gap-2.5">
        {codes.map((c) => {
          const on = value.includes(c);
          const name = languages.find((l) => l.code === c)?.name ?? c;
          return (
            <label
              key={c}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full px-4 text-sm font-semibold ring-1 transition-all duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                on ? 'bg-ink text-white ring-ink shadow-sm' : 'bg-surface text-ink-2 ring-line hover:border-line-hover hover:bg-canvas/40 hover:text-ink'
              }`}
            >
              <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked ? codes.filter((x) => x === c || value.includes(x)) : value.filter((x) => x !== c))} />
              <span aria-hidden="true" className={`inline-flex size-4 items-center justify-center rounded-full text-xs ${on ? 'bg-white/20 text-white' : 'text-muted'}`}>{on ? '✓' : '+'}</span>
              <span>{name}</span>
              <span dir="ltr" className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${on ? 'bg-white/15 text-white/80' : 'bg-canvas text-muted ring-1 ring-line/50'}`}>
                {c}
              </span>
            </label>
          );
        })}
      </div>
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function Languages({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['languages'], queryFn: () => api.get<{ items: Language[] }>('/languages') });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const patch = async (code: string, body: { customerEnabled?: boolean; ttsLang?: string | null }) => {
    setBusy(code);
    setError(null);
    try {
      await api.patch(`/languages/${encodeURIComponent(code)}`, body);
      onSaved();
      void qc.invalidateQueries({ queryKey: ['languages'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          </span>
          <span>{t('settings.languages')}</span>
        </span>
      }
      description={t('settingsForm.languagesIntro')}
    >
      <ErrorNote error={q.error ?? error} />
      {q.isPending ? (
        <Spinner label={t('common:loading')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {q.data?.items.map((l) => (
            <li key={l.code} className="grid gap-4 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:items-center xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,18rem)]">
              <div className="flex min-w-0 items-center gap-3">
                <span dir="ltr" className="grid size-10 shrink-0 place-items-center rounded-lg bg-canvas font-mono text-sm font-bold ring-1 ring-line text-ink">
                  {l.code}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold text-ink break-words">{l.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <span className={`inline-block size-1.5 rounded-full ${l.direction === 'rtl' ? 'bg-primary' : 'bg-muted'}`} />
                    {l.direction === 'rtl' ? t('settings.rtl') : t('settings.ltr')}
                  </span>
                </span>
              </div>
              <Toggle label={t('settings.enabledFor', { name: l.name })} hint={t('settingsForm.customerPagesHint')} checked={Boolean(l.customer_enabled)} disabled={busy === l.code} onChange={(e) => void patch(l.code, { customerEnabled: e.target.checked })} />
              <TtsEditor lang={l} busy={busy === l.code} onSave={(v) => void patch(l.code, { ttsLang: v })} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TtsEditor({ lang, busy, onSave }: { lang: Language; busy: boolean; onSave: (v: string | null) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(lang.tts_lang ?? '');
  return (
    <form
      className="flex items-end gap-2 md:col-span-2 md:max-w-md xl:col-span-1 xl:max-w-none"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v.trim() || null);
      }}
    >
      <Field label={t('settings.ttsFor', { name: lang.name })} className="min-w-0 flex-1" dir="ltr" maxLength={10} placeholder="ar-SA" value={v} onChange={(e) => setV(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || v === (lang.tts_lang ?? '')}>
        {t('common:save')}
      </Button>
    </form>
  );
}

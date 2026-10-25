import { ApiError } from '@dop/client-sdk';
import { overlaySiteCopy, SITE_LANDING_SECTIONS, siteLandingSchema, type SiteLanding as Landing } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field, Select, Spinner } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { diffCopy, EDITED_ELSEWHERE, getIn, humanize, isObject, loadSiteCopy, missingPlaceholders, setIn, type CopyLangs } from '../lib/siteCopy';
import { ErrorNote, TextArea, Toggle } from './common';
import { MfaCancelled, useFreshMfa } from './FreshMfa';

const LANGS = ['ar', 'en'] as const;
type Lang = (typeof LANGS)[number];
type Path = (string | number)[];

/** Field names in the site copy with a clearer label than the key itself. */
const FIELD_LABELS: Record<string, string> = { q: 'question', a: 'answer' };

/**
 * Landing page content on the website, stored as the platform setting `site.landing`: which sections show, and any
 * text in Arabic and English. Every field starts from the site's built-in text; only changes are saved, and a blank
 * field goes back to the built-in text.
 */
export function SiteLanding({ value, onSaved }: { value: Landing; onSaved: () => void }) {
  const { t } = useTranslation();
  const builtIn = useQuery({ queryKey: ['site-copy'], queryFn: loadSiteCopy, staleTime: Infinity });
  return (
    <section aria-labelledby="sl-h" className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">
          <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </span>
        <div>
          <h2 id="sl-h" className="text-lg font-bold text-ink">
            {t('siteLanding.title')}
          </h2>
          <p className="text-xs text-muted">{t('siteLanding.intro')}</p>
        </div>
      </div>
      <ErrorNote error={builtIn.error} />
      {builtIn.isPending ? <Spinner label={t('common:loading')} /> : builtIn.data && <LandingForm builtIn={builtIn.data} value={value} onSaved={onSaved} />}
    </section>
  );
}

function LandingForm({ builtIn, value, onSaved }: { builtIn: CopyLangs; value: Landing; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa();
  const [hidden, setHidden] = useState<string[]>(value.hidden);
  const [draft, setDraft] = useState<CopyLangs>(() => ({ ar: overlaySiteCopy(builtIn.ar, value.copy.ar) as CopyLangs['ar'], en: overlaySiteCopy(builtIn.en, value.copy.en) as CopyLangs['en'] }));
  const [group, setGroup] = useState('hero');
  const [error, setError] = useState('');
  const groups = ['nav', ...Object.keys((builtIn.en.landing ?? {}) as object)];
  const groupLabel = (g: string) => t(`siteLanding.groups.${g}`, { defaultValue: humanize(g) });
  const groupPath: Path = group === 'nav' ? ['nav'] : ['landing', group];
  const edit = (lang: Lang, path: Path, v: unknown) => setDraft((d) => ({ ...d, [lang]: setIn(d[lang], path, v) }));

  const save = useMutation({
    mutationFn: (v: Landing) => run(() => api.put('/settings/site.landing', { value: v })),
    onSuccess: () => {
      onSaved();
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const broken = LANGS.flatMap((l) => missingPlaceholders(builtIn[l], draft[l]).map((p) => `${p} (${l.toUpperCase()})`));
    if (broken.length) {
      setError(t('siteLanding.invalid.placeholders', { fields: broken.join(', ') }));
      return;
    }
    const copy = { ar: diffCopy(builtIn.ar, draft.ar) ?? {}, en: diffCopy(builtIn.en, draft.en) ?? {} };
    const r = siteLandingSchema.safeParse({ hidden: SITE_LANDING_SECTIONS.filter((s) => hidden.includes(s)), copy });
    if (!r.success) {
      setError(t('siteLanding.invalid.general'));
      return;
    }
    setError('');
    save.mutate(r.data);
  };
  const failed = save.error && !(save.error instanceof MfaCancelled) ? save.error : null;
  return (
    <Card className="border border-line/80 bg-surface shadow-xs">
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-0.5 text-sm font-bold text-ink">{t('siteLanding.sections')}</legend>
          <p className="text-xs text-muted">{t('siteLanding.sectionsHint')}</p>
          <div className="mt-2 grid gap-x-6 gap-y-2 rounded-input border border-line bg-canvas/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {SITE_LANDING_SECTIONS.map((s) => (
              <Toggle key={s} label={groupLabel(s)} checked={!hidden.includes(s)} onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== s) : [...h, s]))} />
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-5 border-t border-line/70 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Select label={t('siteLanding.part')} value={group} onChange={(e) => setGroup(e.target.value)} options={groups.map((g) => ({ value: g, label: groupLabel(g) }))} className="max-w-sm" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-3 py-1 font-mono text-xs text-muted ring-1 ring-line">
              <span className="size-1.5 rounded-full bg-primary" />
              {groupPath.join('.')}
            </span>
          </div>
          {group === 'pricing' && <p className="rounded-md bg-canvas px-3 py-2 text-xs text-muted ring-1 ring-line">{t('siteLanding.pricingNote')}</p>}
          <CopyNode key={group} path={groupPath} builtIn={builtIn} draft={draft} edit={edit} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line/70 pt-4">
          <Button type="submit" busy={save.isPending}>
            {t('siteLanding.save')}
          </Button>
          {save.isSuccess && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
              <span className="size-1.5 rounded-full bg-ok" />
              {t('siteLanding.saved')}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3.5 py-2 text-xs font-medium text-danger">
            {error}
          </p>
        )}
        {failed && (failed instanceof ApiError ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3.5 py-2 text-xs font-medium text-danger">{errorText(t, failed)}</p> : <ErrorNote error={failed} />)}
      </form>
    </Card>
  );
}

interface NodeProps {
  path: Path;
  builtIn: CopyLangs;
  draft: CopyLangs;
  edit: (lang: Lang, path: Path, v: unknown) => void;
}

const labelOf = (path: Path) => humanize(FIELD_LABELS[String(path[path.length - 1])] ?? String(path[path.length - 1]));

/** One part of the copy, laid out from the English built-in text: texts, groups of texts, and lists. */
function CopyNode({ path, builtIn, draft, edit }: NodeProps) {
  const base = getIn(builtIn.en, path);
  if (EDITED_ELSEWHERE.has(path.join('.'))) return null;
  if (typeof base === 'string') return <TextPair path={path} builtIn={builtIn} draft={draft} edit={edit} />;
  if (Array.isArray(base))
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">{labelOf(path)}</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {LANGS.map((l) => (
            <ListEditor key={l} lang={l} path={path} builtIn={builtIn} draft={draft} edit={edit} />
          ))}
        </div>
      </fieldset>
    );
  if (isObject(base)) {
    const children = Object.keys(base).map((k) => <CopyNode key={k} path={[...path, k]} builtIn={builtIn} draft={draft} edit={edit} />);
    // The part chosen in the menu is the page's own heading; nested groups get a framed legend.
    return path.length <= 2 ? (
      <div className="flex flex-col gap-5">{children}</div>
    ) : (
      <fieldset className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line p-4">
        <legend className="px-1 font-semibold">{labelOf(path)}</legend>
        {children}
      </fieldset>
    );
  }
  return null;
}

/** A text in Arabic and English side by side, with a way back to the built-in text. */
function TextPair({ path, builtIn, draft, edit }: NodeProps) {
  const { t } = useTranslation();
  const label = labelOf(path);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {LANGS.map((l) => {
        const base = String(getIn(builtIn[l], path) ?? '');
        const v = String(getIn(draft[l], path) ?? '');
        const edited = v !== base;
        const common = {
          label: `${label} (${l.toUpperCase()})`,
          dir: l === 'ar' ? 'rtl' : 'ltr',
          lang: l,
          value: v,
          placeholder: base,
          hint: edited ? t('siteLanding.edited') : undefined,
        } as const;
        return (
          <div key={l} className="flex flex-col gap-1.5 rounded-lg border border-line/60 bg-canvas/30 p-3">
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {l === 'ar' ? 'العربية' : 'English'}
              </span>
              {edited && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {t('siteLanding.edited')}
                </span>
              )}
            </div>
            {base.length > 70 ? (
              <TextArea {...common} className="min-h-24 rounded-input border border-line bg-surface p-3" onChange={(e) => edit(l, path, e.target.value)} />
            ) : (
              <Field {...common} onChange={(e) => edit(l, path, e.target.value)} />
            )}
            {edited && (
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 self-start text-xs font-semibold text-primary hover:underline underline-offset-4" onClick={() => edit(l, path, base)}>
                <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                {t('siteLanding.reset', { field: common.label })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A list in one language: items can be changed, added and removed; each item keeps the built-in item's fields. */
function ListEditor({ lang, path, builtIn, draft, edit }: NodeProps & { lang: Lang }) {
  const { t } = useTranslation();
  const base = (getIn(builtIn[lang], path) as unknown[]) ?? [];
  const items = (getIn(draft[lang], path) as unknown[]) ?? [];
  const sample = getIn(builtIn.en, [...path, 0]);
  const L = lang.toUpperCase();
  const label = labelOf(path);
  const changed = JSON.stringify(base) !== JSON.stringify(items);
  const blank = isObject(sample) ? Object.fromEntries(Object.keys(sample).map((k) => [k, ''])) : '';
  return (
    <div lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">{t(`siteLanding.lang.${lang}`)}</p>
        <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted ring-1 ring-line">
          {items.length} {t('siteLanding.itemsCount', { defaultValue: 'items' })}
        </span>
      </div>
      {items.map((item, i) => {
        const n = i + 1;
        const remove = (
          <Button type="button" variant="ghost" className="self-start text-xs text-danger hover:bg-danger-bg" onClick={() => edit(lang, path, items.filter((_, j) => j !== i))}>
            <span aria-hidden="true">✕ </span>
            {t('siteLanding.removeItem', { list: label, n, lang: L })}
          </Button>
        );
        return isObject(sample) ? (
          <fieldset key={i} className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/20 p-4">
            <legend className="px-2 text-xs font-bold text-ink uppercase tracking-wider">{t('siteLanding.item', { n })}</legend>
            {Object.keys(sample).map((k) => {
              const fieldLabel = `${humanize(FIELD_LABELS[k] ?? k)} ${n} (${L})`;
              const v = String(getIn(item, [k]) ?? '');
              return String(sample[k]).length > 70 ? (
                <TextArea key={k} label={fieldLabel} className="min-h-20 rounded-input border border-line bg-surface p-3" value={v} onChange={(e) => edit(lang, [...path, i, k], e.target.value)} />
              ) : (
                <Field key={k} label={fieldLabel} value={v} onChange={(e) => edit(lang, [...path, i, k], e.target.value)} />
              );
            })}
            {remove}
          </fieldset>
        ) : (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line bg-canvas/20 p-3">
            <Field label={`${label} ${n} (${L})`} value={String(item ?? '')} onChange={(e) => edit(lang, [...path, i], e.target.value)} />
            {remove}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {items.length < 24 && (
          <Button type="button" variant="secondary" onClick={() => edit(lang, path, [...items, blank])}>
            <span aria-hidden="true">+ </span>
            {t('siteLanding.addItem', { list: label, lang: L })}
          </Button>
        )}
        {changed && (
          <Button type="button" variant="ghost" onClick={() => edit(lang, path, base)}>
            {t('siteLanding.resetList', { list: label, lang: L })}
          </Button>
        )}
      </div>
    </div>
  );
}

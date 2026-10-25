import { ApiError } from '@dop/client-sdk';
import { SITE_PRICING_PERIODS, sitePricingSchema, type SitePricing as Pricing } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { Button, Card, Field } from '@dop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import type { Plan } from '../lib/types';
import { Checkbox, ErrorNote, TextArea } from './common';
import { MfaCancelled, useFreshMfa } from './FreshMfa';

const LANGS = ['ar', 'en'] as const;
type Lang = (typeof LANGS)[number];
type Look = Pricing['plans'][string];
const emptyLook = (): Look => ({ name: { ar: '', en: '' }, tagline: { ar: '', en: '' }, featured: false });
const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * The packages section on the website, stored as the platform setting `site.pricing`. Prices, limits and features
 * stay in the plan catalogue; this sets the wording around them, which periods visitors can pick, and how each
 * public plan is named, described and highlighted.
 */
export function SitePricing({ value, onSaved }: { value: Pricing; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useFreshMfa();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ items: Plan[] }>('/plans') });
  const [title, setTitle] = useState(value.title);
  const [included, setIncluded] = useState({ ar: value.included.ar.join('\n'), en: value.included.en.join('\n') });
  const [note, setNote] = useState(value.note);
  const [periods, setPeriods] = useState(value.periods);
  const [looks, setLooks] = useState(value.plans);
  const [error, setError] = useState('');
  const shown = (plans.data?.items ?? []).filter((p) => p.isPublic && !p.archived && p.code !== 'trial');
  const featured = Object.entries(looks).find(([, l]) => l.featured)?.[0] ?? '';

  const look = (code: string) => looks[code] ?? emptyLook();
  const setLook = (code: string, field: 'name' | 'tagline', lang: Lang, v: string) => setLooks((all) => ({ ...all, [code]: { ...look(code), [field]: { ...look(code)[field], [lang]: v } } }));
  const setFeatured = (code: string) =>
    setLooks((all) => {
      const next: Pricing['plans'] = {};
      for (const c of new Set([...Object.keys(all), ...(code ? [code] : [])])) next[c] = { ...(all[c] ?? emptyLook()), featured: c === code };
      return next;
    });
  const togglePeriod = (p: (typeof SITE_PRICING_PERIODS)[number], on: boolean) => setPeriods((cur) => SITE_PRICING_PERIODS.filter((x) => (x === p ? on : cur.includes(x))));

  const save = useMutation({
    mutationFn: (v: Pricing) => run(() => api.put('/settings/site.pricing', { value: v })),
    onSuccess: () => {
      onSaved();
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Plans left blank and not highlighted are dropped, so the site uses their catalogue names.
    const kept = Object.fromEntries(Object.entries(looks).filter(([, l]) => l.featured || [l.name.ar, l.name.en, l.tagline.ar, l.tagline.en].some((x) => x.trim())));
    const r = sitePricingSchema.safeParse({ title, included: { ar: lines(included.ar), en: lines(included.en) }, note, periods, plans: kept });
    if (!r.success) {
      setError(t(`sitePricing.invalid.${String(r.error.issues[0]?.path[0] ?? 'title')}`));
      return;
    }
    setError('');
    save.mutate(r.data);
  };
  const failed = save.error && !(save.error instanceof MfaCancelled) ? save.error : null;
  return (
    <section aria-labelledby="sp-h" className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-canvas text-primary ring-1 ring-line">
          <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </span>
        <div>
          <h2 id="sp-h" className="text-lg font-bold text-ink">
            {t('sitePricing.title')}
          </h2>
          <p className="text-xs text-muted">{t('sitePricing.intro')}</p>
        </div>
      </div>
      <Card className="border border-line/80 bg-surface shadow-xs">
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <div className="grid gap-6 md:grid-cols-2">
            {LANGS.map((l) => (
              <fieldset key={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} className="flex flex-col gap-4 rounded-lg border border-line/70 bg-canvas/30 p-4">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-ink">{t(`sitePricing.lang.${l}`)}</legend>
                <Field label={t('sitePricing.heading', { lang: l.toUpperCase() })} value={title[l]} onChange={(e) => setTitle({ ...title, [l]: e.target.value })} maxLength={120} />
                <TextArea
                  label={t('sitePricing.included', { lang: l.toUpperCase() })}
                  hint={t('sitePricing.includedHint')}
                  className="min-h-36 rounded-input border border-line bg-surface p-3"
                  value={included[l]}
                  onChange={(e) => setIncluded({ ...included, [l]: e.target.value })}
                />
                <Field label={t('sitePricing.note', { lang: l.toUpperCase() })} hint={t('sitePricing.noteHint')} value={note[l]} onChange={(e) => setNote({ ...note, [l]: e.target.value })} maxLength={160} />
              </fieldset>
            ))}
          </div>
          <fieldset className="flex flex-col gap-2 border-t border-line/70 pt-5">
            <legend className="mb-0.5 text-sm font-bold text-ink">{t('sitePricing.periods')}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {SITE_PRICING_PERIODS.map((p) => (
                <Checkbox key={p} label={t(`sitePricing.period.${p}`)} checked={periods.includes(p)} onChange={(e) => togglePeriod(p, e.target.checked)} />
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3 border-t border-line/70 pt-5">
            <legend className="mb-0.5 text-sm font-bold text-ink">{t('sitePricing.plans')}</legend>
            <p className="text-xs text-muted">{t('sitePricing.plansHint')}</p>
            <ErrorNote error={plans.error} />
            {plans.isSuccess && shown.length === 0 && <p className="text-muted">{t('sitePricing.noPlans')}</p>}
            {shown.map((p) => {
              const isFeat = featured === p.code;
              return (
                <div key={p.code} className={`flex flex-col gap-4 rounded-xl border p-4 transition-all duration-150 ${isFeat ? 'border-primary/50 bg-primary/[0.02] shadow-xs ring-1 ring-primary/20' : 'border-line bg-canvas/20'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-ink break-words">{p.name}</span>
                      <span className="rounded-md bg-canvas px-2.5 py-0.5 font-mono text-xs font-semibold text-muted ring-1 ring-line">
                        {p.code}
                      </span>
                      {isFeat && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                          ★ {t('sitePricing.featured')}
                        </span>
                      )}
                    </div>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-line hover:bg-canvas">
                      <input type="radio" name="sp-featured" className="size-4 text-primary" checked={isFeat} onChange={() => setFeatured(p.code)} />
                      {t('sitePricing.featured')}
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {LANGS.map((l) => (
                      <div key={l} lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'} className="flex flex-col gap-3">
                        <Field label={t('sitePricing.planName', { lang: l.toUpperCase() })} placeholder={p.name} value={look(p.code).name[l]} onChange={(e) => setLook(p.code, 'name', l, e.target.value)} maxLength={40} />
                        <Field label={t('sitePricing.tagline', { lang: l.toUpperCase() })} value={look(p.code).tagline[l]} onChange={(e) => setLook(p.code, 'tagline', l, e.target.value)} maxLength={140} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {shown.length > 0 && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted ring-1 ring-line hover:text-ink">
                <input type="radio" name="sp-featured" className="size-4" checked={featured === ''} onChange={() => setFeatured('')} />
                {t('sitePricing.noFeatured')}
              </label>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3 border-t border-line/70 pt-4">
            <Button type="submit" busy={save.isPending}>
              {t('sitePricing.save')}
            </Button>
            {save.isSuccess && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                <span className="size-1.5 rounded-full bg-ok" />
                {t('sitePricing.saved')}
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
    </section>
  );
}

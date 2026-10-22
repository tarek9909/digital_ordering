import { useTranslation } from '@dop/i18n';
import { useState } from 'react';
import { Link } from 'react-router';
import { Pricing, type BillingPeriod } from '../components/Pricing';
import { useList, useSiteInfo } from './lib';
import { AlertRings, Scene } from './visuals';

const ALL_PERIODS: BillingPeriod[] = ['month', 'quarter', 'year'];

/** The packages section. Its wording and periods come from the console (`site.pricing`); the built-in copy covers loading. */
export function PricingSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const builtIn = useList('landing.pricing.includedItems');
  const site = useSiteInfo();
  const cfg = site.data?.pricing;
  const title = cfg?.title[lang] || t('landing.pricing.title');
  const included = cfg ? cfg.included[lang] : builtIn;
  const note = cfg ? cfg.note[lang] : t('landing.pricing.chains');
  const periods = cfg?.periods ?? ALL_PERIODS;
  const [chosen, setPeriod] = useState<BillingPeriod>('month');
  const period = periods.includes(chosen) ? chosen : periods[0]!;
  const contactHref = site.data?.contact.whatsappUrl ?? (site.data?.contact.email ? `mailto:${site.data.contact.email}` : '/contact');
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-28 bg-canvas">
      <div className="mx-auto max-w-7xl flex flex-col gap-10 px-4 sm:px-8 lg:px-12 py-24">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <h2 id="pricing-h" className="max-w-[20ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {title}
          </h2>
          {periods.length > 1 && (
            <fieldset>
              <legend className="sr-only">{t('landing.pricing.periodLabel')}</legend>
              <div className="inline-flex rounded-full border border-line bg-surface p-1">
                {periods.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={period === p}
                    onClick={() => setPeriod(p)}
                    className={`min-h-11 rounded-full px-5 font-semibold ${period === p ? 'bg-ink text-white' : 'text-ink-2'}`}
                  >
                    {t(`landing.pricing.period.${p}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        {included.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="font-semibold">{t('landing.pricing.included')}</p>
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {included.map((x) => (
                <li key={x} className="inline-flex items-center gap-2 text-ink-2">
                  <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-ok" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {x}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pricing period={period} />
        {note && (
          <a href={contactHref} className="w-fit font-semibold text-ink underline decoration-line decoration-2 underline-offset-8 hover:decoration-ink">
            {note}
          </a>
        )}
      </div>
    </section>
  );
}

type Qa = { q: string; a: string };

export function Faq() {
  const { t } = useTranslation();
  const items = useList<Qa>('landing.faq.items');
  return (
    <section id="faq" aria-labelledby="faq-h" className="mx-auto max-w-7xl scroll-mt-28 px-4 sm:px-8 lg:px-12 py-24">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div className="flex flex-col gap-8">
          <h2 id="faq-h" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('landing.faq.title')}
          </h2>
          <Scene kind="phone" className="hidden aspect-[4/5] max-w-xs rounded-[var(--radius-card)] lg:block" />
        </div>
        <div className="flex flex-col">
          {items.map((x) => (
            <details key={x.q} className="faq group border-t border-line last:border-b">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-lg font-semibold">
                {x.q}
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line transition-transform group-open:rotate-45">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.4}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
              </summary>
              <p className="max-w-[62ch] pb-6 text-ink-2">{x.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="closing-h" className="ember-glow relative overflow-hidden bg-ink text-white">
      <div className="mx-auto max-w-7xl relative flex flex-col items-start gap-8 px-4 sm:px-8 lg:px-12 py-28">
        <div className="relative">
          <AlertRings active className="opacity-40" />
          <h2 id="closing-h" className="relative max-w-[14ch] font-display text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-7xl" data-anim="closing">
            {t('landing.closing.title')}
          </h2>
        </div>
        <p className="max-w-[48ch] text-lg text-white/75">{t('landing.closing.body')}</p>
        <Link to="/contact" className="inline-flex min-h-14 items-center rounded-full bg-glow px-8 text-lg font-semibold text-ink active:scale-[.98]">
          {t('landing.closing.cta')}
        </Link>
      </div>
    </section>
  );
}

/** Floating WhatsApp button, shown when super admins set a number in the console. */
export function WhatsAppButton() {
  const { t } = useTranslation();
  const site = useSiteInfo();
  const url = site.data?.contact.whatsappUrl;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('landing.whatsapp')}
      title={t('landing.whatsapp')}
      className="fixed end-5 bottom-5 z-50 flex size-14 items-center justify-center rounded-full bg-ink text-white shadow-[var(--shadow-card)] ring-4 ring-surface hover:bg-ink-2 active:scale-[.98]"
    >
      <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.76 4.88-1.28A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-2.9.76.78-2.83-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.48a.92.92 0 0 0-.66.31 2.8 2.8 0 0 0-.87 2.07 4.86 4.86 0 0 0 1.02 2.58 11.1 11.1 0 0 0 4.25 3.76c1.58.68 2.2.74 2.99.62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
      </svg>
    </a>
  );
}

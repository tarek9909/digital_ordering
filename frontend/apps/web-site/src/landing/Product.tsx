import { brandTokens } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { prefersReducedMotion, useList } from './lib';
import { PhoneFrame, Scene, TvFrame } from './visuals';

// Venue colours a restaurant might pick: data for the preview, not platform brand colours.
const SWATCHES = ['#C2410C', '#1F6FEB', '#0F766E', '#7C3AED', '#BE123C', '#1C1917'];

/** "Make it yours": the visitor's own name, colour and language on the customer page, then on to the contact page to have it set up. */
export function BrandPreview() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [colour, setColour] = useState(SWATCHES[1]!);
  const [lang, setLang] = useState<'ar' | 'en'>(i18n.language === 'en' ? 'en' : 'ar');
  const pt = i18n.getFixedT(lang, 'site');
  const vars = brandTokens(colour) as CSSProperties;
  const shown = name.trim() || pt('landing.brand.defaultName');
  return (
    <section aria-labelledby="brand-h" className="bg-primary text-on-primary">
      <div className="mx-auto max-w-7xl grid items-center gap-12 px-4 sm:px-8 lg:px-12 py-16 sm:py-24 lg:grid-cols-[1fr_auto] lg:gap-20">
        <div className="flex flex-col gap-6">
          <h2 id="brand-h" className="max-w-[16ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('landing.brand.title')}
          </h2>
          <p className="max-w-[50ch] text-lg text-on-primary/85">{t('landing.brand.body')}</p>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void nav(`/contact${name.trim() ? `?name=${encodeURIComponent(name.trim())}` : ''}`);
            }}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="brand-name" className="font-semibold">
                {t('landing.brand.nameLabel')}
              </label>
              <input
                id="brand-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('landing.brand.namePlaceholder')}
                className="min-h-14 w-full max-w-md rounded-full border-2 border-on-primary/40 bg-on-primary/10 px-6 text-lg text-on-primary placeholder:text-on-primary/60 focus-visible:border-on-primary focus-visible:outline-none"
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-semibold">{t('landing.brand.colourLabel')}</legend>
              <div className="flex flex-wrap items-center gap-3">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColour(c)}
                    aria-pressed={colour === c}
                    aria-label={c}
                    className={`size-11 rounded-full border-2 ${colour === c ? 'border-on-primary ring-2 ring-on-primary ring-offset-2 ring-offset-primary' : 'border-on-primary/40'}`}
                    style={{ background: c }}
                  />
                ))}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-on-primary/40 px-4 text-sm font-semibold">
                  <input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
                  {t('landing.brand.custom')}
                </label>
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-semibold">{t('landing.brand.langLabel')}</legend>
              <div className="inline-flex w-fit rounded-full bg-on-primary/15 p-1">
                {(['ar', 'en'] as const).map((l) => (
                  <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} className={`min-h-10 rounded-full px-5 font-semibold ${lang === l ? 'bg-on-primary text-primary' : ''}`}>
                    {l === 'ar' ? 'العربية' : 'English'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button type="submit" className="inline-flex min-h-14 items-center rounded-full bg-ink px-8 text-lg font-semibold text-white active:scale-[.98]">
                {t('landing.brand.cta')}
              </button>
              <p className="text-sm text-on-primary/80">{t('landing.brand.note')}</p>
            </div>
          </form>
        </div>
        <div className="flex justify-center" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} style={vars}>
          <PhoneFrame className="rotate-[-3deg] rtl:rotate-[3deg]">
            <div className="-mt-9 flex items-center gap-3 bg-[var(--brand-band)] px-4 pt-11 pb-4 text-[var(--on-band)]">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--on-band)]/20 font-display font-bold">
                {shown.slice(0, 1)}
              </span>
              <span className="min-w-0 truncate font-semibold">{shown}</span>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4 text-ink">
              <div className="flex flex-col items-center gap-1 rounded-[1.2rem] bg-surface py-6 shadow-[var(--shadow-card)]">
                <span className="text-xs text-muted">{pt('landing.brand.previewNumber')}</span>
                <span className="num font-display text-6xl leading-none font-extrabold text-[var(--brand-band)]">27</span>
                <span className="mt-2 text-sm font-semibold">{pt('landing.brand.previewStatus')}</span>
                <span className="text-xs text-muted">{pt('landing.brand.previewWait')}</span>
              </div>
              <span className="mx-auto rounded-full bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-[var(--on-brand)]">{pt('landing.brand.previewAlert')}</span>
            </div>
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}

export function Cashier() {
  const { t } = useTranslation();
  const items = useList('landing.cashier.items');
  return (
    <section aria-labelledby="cashier-h" className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12 py-24">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h2 id="cashier-h" className="max-w-[14ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('landing.cashier.title')}
          </h2>
          <p className="max-w-[50ch] text-lg text-ink-2">{t('landing.cashier.body')}</p>
          <ul className="flex flex-col gap-4">
            {items.map((x) => (
              <li key={x} className="flex items-start gap-3 text-lg">
                <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-ink" />
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative pb-20 sm:pb-10">
          <Scene kind="counter" className="aspect-[5/4] rounded-[var(--radius-card)]" />
          {/* The real staff board, overlapping the scene */}
          <div className="absolute inset-x-4 -bottom-2 rounded-[var(--radius-card)] bg-ink p-4 text-white shadow-[var(--shadow-card)] sm:inset-x-auto sm:end-6 sm:w-[22rem]" data-anim="cashier-board">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="font-display font-bold">{t('landing.cashier.board')}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs">
                <span aria-hidden="true" className="live-dot size-1.5 rounded-full bg-glow" />
                {t('landing.cashier.open')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { n: 31, time: '4:05' },
                { n: 32, time: '1:12' },
              ].map((x) => (
                <div key={x.n} className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="num font-display text-3xl font-bold">{x.n}</span>
                    <span className="num font-mono text-xs text-white/60">{x.time}</span>
                  </div>
                  <span className="rounded-full bg-glow py-1.5 text-center text-sm font-bold text-ink">{t('landing.cashier.ready')}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-2.5">
              <span className="flex items-center gap-2">
                <span className="num rounded-lg bg-glow px-2.5 py-1 font-display text-xl font-bold text-ink">27</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{t('landing.cashier.onTheWay')}</span>
              </span>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-ink">{t('landing.cashier.collect')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The pickup TV running by itself: a number moves to Ready every few seconds and is announced. */
export function TvShowcase() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion() || !ref.current || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) timer ??= setInterval(() => setTick((x) => x + 1), 2600);
      else if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);
  const latest = 40 + tick;
  const ready = [latest, latest - 1, latest - 2, latest - 3, latest - 4, latest - 5];
  const preparing = [latest + 1, latest + 2, latest + 3, latest + 4];
  const announce = tick % 2 === 0 ? t('landing.tv.announceAr', { number: latest }) : t('landing.tv.announce', { number: latest });
  return (
    <section aria-labelledby="tv-h" className="bg-canvas">
      <div className="mx-auto max-w-7xl grid items-center gap-14 px-4 sm:px-8 lg:px-12 py-24 lg:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-6">
          <h2 id="tv-h" className="max-w-[14ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('landing.tv.title')}
          </h2>
          <p className="max-w-[48ch] text-lg text-ink-2">{t('landing.tv.body')}</p>
        </div>
        <div ref={ref} className="flex flex-col items-center gap-4">
          <TvFrame className="w-full">
            <div className="grid h-full grid-cols-[2fr_3fr] gap-2 p-2 sm:gap-3 sm:p-4">
              <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line p-2 sm:gap-2 sm:p-3">
                <span className="truncate text-xs font-semibold text-muted sm:text-sm">{t('landing.demo.tvPreparing')}</span>
                <div className="grid grid-cols-2 gap-1 sm:gap-2">
                  {preparing.map((x) => (
                    <span key={x} className="num text-center font-display text-xl font-semibold text-muted sm:text-3xl">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-ink p-2 text-white sm:gap-2 sm:p-3">
                <span className="truncate text-xs font-semibold text-white/70 sm:text-sm">{t('landing.demo.tvReady')}</span>
                <div className="grid grid-cols-3 gap-1 sm:gap-2">
                  {ready.map((x) => (
                    <span key={x} className={`num rounded-lg py-0.5 text-center font-display text-xl font-bold sm:py-1 sm:text-3xl ${x === latest ? 'demo-pop bg-primary text-on-primary' : 'bg-white/10'}`}>
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </TvFrame>
          <p className="inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-[var(--shadow-card)]" aria-live="off">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M3 10v4h4l6 5V5L7 10H3zm13.5-2.5a6 6 0 0 1 0 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span lang={tick % 2 === 0 ? 'ar' : 'en'}>{announce}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

type Route = { title: string; body: string };
const ROUTE_ICONS = [
  'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0',
  'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  'M3 5h18v11H3zM8 20h8M12 16v4',
];

/** What if the phone is locked: one Ready, three routes to the customer. */
export function Reach() {
  const { t } = useTranslation();
  const items = useList<Route>('landing.reach.items');
  return (
    <section aria-labelledby="reach-h" className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12 py-24">
      <div className="mb-12 flex flex-col gap-4">
        <h2 id="reach-h" className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          {t('landing.reach.title')}
        </h2>
        <p className="max-w-[56ch] text-lg text-ink-2">{t('landing.reach.body')}</p>
      </div>
      <div className="relative">
        <div className="mx-auto mb-10 flex w-fit items-center gap-2 rounded-full bg-ink px-6 py-3 font-display text-xl font-bold text-white">
          <span aria-hidden="true" className="live-dot size-2.5 rounded-full bg-glow" />
          {t('landing.demo.tapReady')}
        </div>
        <div aria-hidden="true" className="absolute inset-x-[16.6%] top-14 hidden h-10 border-x-2 border-t-2 border-dashed border-line md:block" />
        <ul className="grid gap-6 md:grid-cols-3">
          {items.map((x, i) => (
            <li key={x.title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-6" data-anim="reach-item">
              <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-canvas text-ink">
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d={ROUTE_ICONS[i] ?? ROUTE_ICONS[0]} />
                </svg>
              </span>
              <h3 className="font-display text-xl font-bold">{x.title}</h3>
              <p className="text-ink-2">{x.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-ink-2">{t('landing.reach.footnote')}</p>
      </div>
    </section>
  );
}

/** Works with the cashier system: receipt → customer number → Ready rings. */
export function Pos() {
  const { t } = useTranslation();
  const items = useList('landing.pos.items');
  const Arrow = () => (
    <svg viewBox="0 0 24 24" className="pos-arrow mx-auto size-6 text-glow" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 4v16m0 0-6-6m6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <section aria-labelledby="pos-h" className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12 py-12">
      <div className="ember-glow grid items-center gap-12 rounded-[2rem] bg-ink p-6 text-white sm:p-14 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h2 id="pos-h" className="max-w-[14ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('landing.pos.title')}
          </h2>
          <ul className="flex flex-col gap-3">
            {items.map((x) => (
              <li key={x} className="flex items-start gap-3 text-white/85">
                <svg viewBox="0 0 24 24" className="mt-1 size-4 shrink-0 text-glow" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                  <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {x}
              </li>
            ))}
          </ul>
          <p className="text-sm text-white/60">{t('landing.pos.start')}</p>
        </div>
        <div className="flex flex-col gap-2" data-anim="pos-flow">
          <div className="pos-step flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
            <span className="text-sm text-white/70">{t('landing.pos.pos')}</span>
            <span className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{t('landing.pos.receipt')}</span>
              <span className="num font-mono text-2xl">1042</span>
            </span>
          </div>
          <Arrow />
          <div className="pos-step flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl bg-surface px-5 py-4 text-ink">
            <span className="flex flex-col">
              <span className="text-sm text-muted">{t('landing.pos.customer')}</span>
              <span className="num font-display text-5xl font-extrabold">27</span>
            </span>
            <span className="num rounded-full bg-canvas px-3 py-1 font-mono text-sm">
              {t('landing.pos.receipt')} 1042
            </span>
          </div>
          <Arrow />
          <div className="pos-step relative flex items-center justify-center gap-2 overflow-hidden rounded-full bg-glow px-5 py-4 text-center font-display text-lg font-bold text-ink">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
              <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('landing.pos.ringing')}
          </div>
        </div>
      </div>
    </section>
  );
}

type Point = { title: string; body: string };
const LOCAL_ICONS = [
  'M4 7h16v10H4zM8 12h8M4 10h16',
  'M4 6h9M8.5 4v2M6 6c1 4 4 7 8 8M11 6c-1 3-3 6-7 8M14 20l4-9 4 9M15.5 17h5',
  'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  'M2 9a14 14 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
];

/** Lebanon: dollar prices, Arabic and English, no customer data, light pages for patchy internet. */
export function Local() {
  const { t } = useTranslation();
  const items = useList<Point>('landing.local.items');
  return (
    <section aria-labelledby="local-h" className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12 py-24">
      <h2 id="local-h" className="mb-12 max-w-[18ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        {t('landing.local.title')}
      </h2>
      <ul className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {items.map((x, i) => (
          <li key={x.title} className="flex gap-4 sm:gap-5">
            <span aria-hidden="true" className="flex size-12 shrink-0 sm:size-14 items-center justify-center rounded-2xl bg-ink text-glow">
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={LOCAL_ICONS[i] ?? LOCAL_ICONS[0]} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <h3 className="font-display text-xl font-bold">{x.title}</h3>
              <p className="max-w-[40ch] text-ink-2">{x.body}</p>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

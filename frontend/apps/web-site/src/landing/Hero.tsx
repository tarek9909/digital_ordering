import { scheduleChime } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { useState } from 'react';
import { Link } from 'react-router';
import { useList } from './lib';
import { AlertRings, PhoneFrame, TabletFrame, TvFrame } from './visuals';

const NUMBER = 63;

/** The chime the customer's phone would play; created on the visitor's tap, so the browser allows audio. */
function playDemoChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().then(() => {
      scheduleChime(ctx, 'classic', 1.4);
      setTimeout(() => void ctx.close(), 2000);
    });
  } catch {
    /* sound is a bonus; the visuals carry the demo */
  }
}

/**
 * One button, three screens: the staff tablet, the customer's phone and the pickup TV. Pressing Ready rings the
 * phone and lights the number on the TV, which is the product in five seconds.
 */
function LiveDemo() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [n, setN] = useState(NUMBER);
  const press = () => {
    if (ready) {
      setReady(false);
      setN((x) => x + 1);
      return;
    }
    setReady(true);
    playDemoChime();
  };
  const preparing = [n + 1, n + 2];
  const readyList = ready ? [n, n - 1, n - 2] : [n - 1, n - 2];
  return (
    <figure className="relative" data-anim="demo">
      <figcaption className="sr-only">{t('landing.demo.label')}</figcaption>
      <div className="relative grid grid-cols-[1fr_auto] items-end gap-4 sm:gap-6">
        {/* Pickup TV, behind */}
        <div className="col-span-2 sm:col-span-1" data-anim="demo-tv">
          <p className="eyebrow mb-2">{t('landing.demo.tv')}</p>
          <TvFrame>
            <div className="grid h-full grid-cols-[2fr_3fr] gap-2 p-3">
              <div className="flex flex-col gap-1 rounded-lg border border-line p-2">
                <span className="text-[0.65rem] font-semibold text-muted">{t('landing.demo.tvPreparing')}</span>
                <div className="grid grid-cols-2 gap-1">
                  {preparing.map((x) => (
                    <span key={x} className="num text-center font-display text-lg font-semibold text-muted">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-ink p-2 text-white">
                <span className="text-[0.65rem] font-semibold text-white/70">{t('landing.demo.tvReady')}</span>
                <div className="grid grid-cols-3 gap-1">
                  {readyList.map((x) => (
                    <span key={x} className={`num rounded-md py-0.5 text-center font-display text-lg font-bold ${x === n && ready ? 'bg-primary text-on-primary demo-pop' : 'bg-white/10'}`}>
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </TvFrame>
        </div>

        {/* Customer phone, in front */}
        <div className="row-start-1 -mb-6 justify-self-end sm:col-start-2 sm:row-span-2" data-anim="demo-phone">
          <p className="eyebrow mb-2">{t('landing.demo.phone')}</p>
          <PhoneFrame className={ready ? 'phone-ring' : ''}>
            <div className="flex flex-1 flex-col gap-3 px-4 pb-5">
              <p className="text-center text-sm font-semibold text-ink-2">{t('landing.demo.venue')}</p>
              <div className={`relative flex flex-col items-center gap-1 rounded-[1.2rem] px-3 py-5 ${ready ? 'bg-ink text-white' : 'bg-surface text-ink'}`}>
                <AlertRings active={ready} />
                <span className={`text-xs ${ready ? 'text-white/70' : 'text-muted'}`}>{t('landing.demo.order')}</span>
                <span className={`num font-display text-6xl leading-none font-extrabold ${ready ? 'text-glow' : ''}`}>{n}</span>
                <span className={`mt-2 rounded-full px-3 py-1 text-xs font-semibold ${ready ? 'bg-glow text-ink' : 'bg-canvas text-ink-2'}`}>
                  {ready ? t('landing.demo.ready') : t('landing.demo.preparing')}
                </span>
              </div>
              <p className="min-h-10 text-center text-sm text-ink-2" aria-live="polite">
                {ready ? t('landing.demo.phoneReady') : t('landing.demo.phoneWait')}
              </p>
              {/* What the customer taps: turn on alerts while waiting, "I'm coming" once ready. */}
              <span aria-hidden="true" className={`mt-auto rounded-full py-3 text-center text-sm font-bold ${ready ? 'bg-ink text-white' : 'bg-surface text-ink shadow-[var(--shadow-card)]'}`}>
                {ready ? t('landing.demo.coming') : t('landing.brand.previewAlert')}
              </span>
            </div>
          </PhoneFrame>
        </div>

        {/* Staff tablet, the one button */}
        <div className="col-span-2 sm:col-span-1" data-anim="demo-tablet">
          <p className="eyebrow mb-2">{t('landing.demo.tablet')}</p>
          <TabletFrame>
            <div className="flex items-center gap-3 p-3 text-white">
              <span className="num font-display text-4xl font-bold">{n}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/70">{ready ? t('landing.demo.ready') : t('landing.demo.preparing')}</span>
              <button
                type="button"
                onClick={press}
                aria-pressed={ready}
                className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-glow px-6 font-display text-lg font-bold whitespace-nowrap text-ink active:scale-[.98]"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
                  <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {ready ? t('landing.demo.again') : t('landing.demo.tapReady')}
              </button>
            </div>
          </TabletFrame>
          <p className="mt-2 text-sm text-muted">{t('landing.demo.hint')}</p>
        </div>
      </div>
    </figure>
  );
}

export function Hero() {
  const { t } = useTranslation();
  const ticks = useList('landing.hero.ticks');
  return (
    <section aria-labelledby="hero" className="mx-auto max-w-7xl grid items-center gap-12 px-4 sm:px-8 lg:px-12 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
      <div className="flex flex-col items-start gap-6">
        <p className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-sm font-semibold text-ink-2" data-anim="hero-item">
          <span aria-hidden="true" className="live-dot size-2 rounded-full bg-primary" />
          {t('landing.hero.kicker')}
        </p>
        <h1 id="hero" className="hero-title max-w-[14ch] font-display text-5xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl" data-anim="hero-title">
          {t('landing.hero.title')}
        </h1>
        <p className="max-w-[52ch] text-lg leading-relaxed text-ink-2" data-anim="hero-item">
          {t('landing.hero.body')}
        </p>
        <div className="flex flex-wrap items-center gap-4" data-anim="hero-item">
          <Link to="/contact" className="inline-flex min-h-14 items-center rounded-full bg-primary px-8 text-lg font-semibold text-on-primary hover:bg-primary-hover active:scale-[.98]">
            {t('landing.hero.cta')}
          </Link>
          <a href="#how" className="inline-flex min-h-12 items-center px-1 text-lg font-semibold text-ink underline decoration-line decoration-2 underline-offset-8 hover:decoration-ink">
            {t('landing.hero.secondary')}
          </a>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2" data-anim="hero-item">
          {ticks.map((x) => (
            <li key={x} className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="size-4 text-ok" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {x}
            </li>
          ))}
        </ul>
      </div>
      <LiveDemo />
    </section>
  );
}

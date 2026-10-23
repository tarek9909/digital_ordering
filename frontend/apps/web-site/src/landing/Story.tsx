import { useTranslation } from '@dop/i18n';
import { QRCodeSVG } from 'qrcode.react';
import { useList } from './lib';
import { AlertRings, PhoneFrame, Scene } from './visuals';

/** Partner logos. Placeholders until pilot venues agree to be listed; never invented names. */
export function Trust() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="trust" className="border-y border-line bg-canvas">
      <div className="mx-auto max-w-7xl flex flex-col items-center gap-6 px-4 sm:px-8 lg:px-12 py-10">
        <h2 id="trust" className="text-center text-lg font-semibold text-ink-2">
          {t('landing.trust.title')}
        </h2>
        <ul className="flex flex-wrap justify-center gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="flex h-14 w-32 items-center sm:w-36 justify-center rounded-[var(--radius-input)] border-2 border-dashed border-line text-sm text-muted" data-logo-slot={i}>
              {t('landing.trust.slot')}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t('landing.trust.note')}</p>
      </div>
    </section>
  );
}

/** A slow band of the product's promises; the only element that keeps moving (stops for reduced motion). */
export function Marquee() {
  const words = useList('landing.marquee');
  const run = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="marquee-run flex shrink-0 items-center gap-10 pe-10">
      {words.map((w) => (
        <li key={w} className="flex items-center gap-10 font-display text-3xl font-bold whitespace-nowrap sm:text-4xl">
          {w}
          <span aria-hidden="true" className="size-2.5 rounded-full bg-glow" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="overflow-hidden bg-ink py-6 text-white" data-anim="marquee">
      <div className="marquee-track flex w-max">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}

type StepItem = { title: string; body: string };

/** The phone screen for each step of the flow. */
function StepScreen({ step }: { step: number }) {
  const { t } = useTranslation();
  if (step === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-card)]">
          <QRCodeSVG value="https://t.tanbeeh.example/63" size={140} level="M" />
        </div>
        <span className="num font-display text-4xl font-extrabold">63</span>
      </div>
    );
  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pb-5">
      <p className="text-center text-sm font-semibold text-ink-2">{t('landing.demo.venue')}</p>
      <div className={`relative flex flex-col items-center gap-1 rounded-[1.2rem] px-3 py-6 ${step === 2 ? 'bg-ink text-white' : 'bg-surface'}`}>
        <AlertRings active={step === 2} />
        <span className={`text-xs ${step === 2 ? 'text-white/70' : 'text-muted'}`}>{t('landing.demo.order')}</span>
        <span className={`num font-display text-6xl leading-none font-extrabold ${step === 2 ? 'text-glow' : ''}`}>63</span>
        <span className={`mt-2 rounded-full px-3 py-1 text-xs font-semibold ${step === 2 ? 'bg-glow text-ink' : step === 3 ? 'bg-ok-bg text-ok' : 'bg-canvas text-ink-2'}`}>
          {step === 1 ? t('landing.demo.preparing') : step === 2 ? t('landing.demo.ready') : '✓'}
        </span>
      </div>
      {step === 1 && <span className="mx-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white">{t('landing.brand.previewAlert')}</span>}
      {step === 3 && (
        <p aria-hidden="true" className="text-center text-2xl tracking-widest text-glow">
          ★★★★★
        </p>
      )}
    </div>
  );
}

/** How it works: a real sequence, so the steps are numbered; the phone follows the active step. */
export function Steps({ active, onSelect }: { active: number; onSelect: (i: number) => void }) {
  const { t } = useTranslation();
  const items = useList<StepItem>('landing.steps.items');
  return (
    <section id="how" aria-labelledby="how-h" className="mx-auto max-w-7xl scroll-mt-28 px-4 sm:px-8 lg:px-12 py-24" data-anim="steps">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_auto] lg:gap-20">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 id="how-h" className="max-w-[16ch] font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
              {t('landing.steps.title')}
            </h2>
            <p className="max-w-[56ch] text-lg text-ink-2">{t('landing.steps.body')}</p>
          </div>
          <ol className="flex flex-col">
            {items.map((s, i) => (
              <li key={s.title} data-step={i} className="border-t border-line last:border-b">
                <button type="button" onClick={() => onSelect(i)} aria-current={active === i ? 'step' : undefined} className="flex w-full items-start gap-5 py-5 text-start">
                  <span className={`num font-mono text-lg transition-colors ${active === i ? 'text-primary' : 'text-muted'}`}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex flex-col gap-1">
                    <span className={`font-display text-xl font-bold transition-colors ${active === i ? 'text-ink' : 'text-ink-2'}`}>{s.title}</span>
                    <span className="text-ink-2">{s.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-center lg:sticky lg:top-28 lg:self-start">
          <PhoneFrame>
            <StepScreen step={active} />
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}

/** One strong line over an evening scene; words light up as the visitor scrolls (scrubbed by GSAP). */
export function Statement() {
  const { t } = useTranslation();
  const words = t('landing.statement.text').split(' ');
  return (
    <section aria-label={t('landing.statement.scene')}>
      <Scene kind="service" className="min-h-[26rem] sm:min-h-[34rem]">
        <div className="relative mx-auto flex min-h-[26rem] max-w-7xl sm:min-h-[34rem] items-center px-4 sm:px-8 lg:px-12 py-20">
          <p className="max-w-[24ch] font-display text-3xl leading-snug font-bold text-white sm:text-5xl" data-anim="statement">
            {words.map((w, i) => (
              <span key={i} className="statement-word">
                {w}{' '}
              </span>
            ))}
          </p>
        </div>
      </Scene>
    </section>
  );
}

type Row = { label: string; buzzer: string; tanbeeh: string };

export function Compare() {
  const { t } = useTranslation();
  const rows = useList<Row>('landing.compare.rows');
  return (
    <section aria-labelledby="compare-h" className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12 py-24">
      <h2 id="compare-h" className="mb-10 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        {t('landing.compare.title')}
      </h2>
      {/* A table from md up; on phones each row stacks into a small card (label, buzzer, then Tanbeeh). */}
      <div className="md:overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-start max-md:block md:min-w-[40rem]">
          <caption className="sr-only">{t('landing.compare.title')}</caption>
          <thead className="max-md:sr-only">
            <tr>
              <th scope="col" className="w-1/5" />
              <th scope="col" className="px-5 pb-4 text-start font-display text-lg font-bold text-muted">
                {t('landing.compare.buzzer')}
              </th>
              <th scope="col" className="rounded-t-[var(--radius-card)] bg-ink px-5 pt-5 pb-4 text-start font-display text-lg font-bold text-white">
                {t('landing.compare.tanbeeh')}
              </th>
            </tr>
          </thead>
          <tbody className="max-md:flex max-md:flex-col">
            {rows.map((r, i) => (
              <tr key={r.label} className="max-md:flex max-md:flex-col max-md:gap-2 max-md:border-t max-md:border-line max-md:py-5">
                <th scope="row" className="border-t border-line py-4 pe-4 text-start align-top font-semibold text-ink max-md:border-0 max-md:p-0 max-md:font-display max-md:text-lg">
                  {r.label}
                </th>
                <td className="border-t border-line px-5 py-4 align-top text-muted max-md:border-0 max-md:p-0">
                  <span className="block text-xs font-semibold md:hidden">{t('landing.compare.buzzer')}</span>
                  {r.buzzer}
                </td>
                <td
                  className={`border-t border-white/10 bg-ink px-5 py-4 align-top text-white max-md:rounded-[var(--radius-input)] max-md:border-0 max-md:px-4 max-md:py-3 ${i === rows.length - 1 ? 'md:rounded-b-[var(--radius-card)]' : ''}`}
                >
                  <span className="mb-1 block text-xs font-semibold text-white/60 md:hidden">{t('landing.compare.tanbeeh')}</span>
                  <span className="inline-flex items-start gap-2">
                    <svg viewBox="0 0 24 24" className="mt-1 size-4 shrink-0 text-glow" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {r.tanbeeh}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

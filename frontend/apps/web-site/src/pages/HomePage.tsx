import { useTranslation } from '@dop/i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Closing, Faq, PricingSection, WhatsAppButton } from '../landing/Closing';
import { Hero } from '../landing/Hero';
import { prefersReducedMotion, useHidden, useSiteInfo } from '../landing/lib';
import { BrandPreview, Cashier, Local, Pos, Reach, TvShowcase } from '../landing/Product';
import { Compare, Marquee, Statement, Steps, Trust } from '../landing/Story';

/**
 * Landing page. Sections in order: hero with the live three-screen demo, partner logos, word band, how it works,
 * statement, buzzers vs Tanbeeh, make it yours, cashier, pickup TV, locked phone, POS, Lebanon, pricing, FAQ,
 * closing. Super admins can hide any section but the hero and change its text in the console. GSAP motion is loaded
 * once that content has arrived (so it animates the final text) and skipped for reduced motion.
 */
export function HomePage() {
  const { i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [intro, setIntro] = useState(false);
  const site = useSiteInfo();
  const hidden = useHidden();
  const settled = !site.isPending;
  const content = JSON.stringify(site.data?.landing ?? null);

  // Hide the hero only while its entrance is about to play, and never for longer than 2.5 s.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    setIntro(true);
    const t = setTimeout(() => setIntro(false), 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion() || !root.current || !settled) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void import('../landing/motion')
      .then(({ animateLanding }) => {
        if (cancelled || !root.current) return;
        cleanup = animateLanding(root.current, { rtl: i18n.dir() === 'rtl', onStep: setStep, introReady: () => setIntro(false) });
      })
      .catch(() => setIntro(false));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [i18n, settled, content]);

  return (
    <div ref={root} className={intro ? 'landing-intro' : undefined}>
      <Hero />
      {!hidden('trust') && <Trust />}
      {!hidden('marquee') && <Marquee />}
      {!hidden('steps') && <Steps active={step} onSelect={setStep} />}
      {!hidden('statement') && <Statement />}
      {!hidden('compare') && <Compare />}
      {!hidden('brand') && <BrandPreview />}
      {!hidden('cashier') && <Cashier />}
      {!hidden('tv') && <TvShowcase />}
      {!hidden('reach') && <Reach />}
      {!hidden('pos') && <Pos />}
      {!hidden('local') && <Local />}
      {!hidden('pricing') && <PricingSection />}
      {!hidden('faq') && <Faq />}
      {!hidden('closing') && <Closing />}
      {!hidden('whatsapp') && <WhatsAppButton />}
    </div>
  );
}

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Landing page motion (GSAP). Loaded on demand after the page renders, and only when the visitor has not asked for
// reduced motion: the content is complete without it. A few deliberate moments, not an effect on every section:
// the hero entrance, the word band, the steps following the scroll, the statement lighting up word by word, the
// cashier board and the POS flow arriving, and the closing line.

gsap.registerPlugin(ScrollTrigger);

export function animateLanding(root: HTMLElement, opts: { rtl: boolean; onStep: (i: number) => void; introReady: () => void }): () => void {
  const q = gsap.utils.selector(root);
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // 1. Hero entrance: the one orchestrated page-load moment.
    gsap.set(q('[data-anim=hero-title], [data-anim=hero-item], [data-anim^=demo-]'), { opacity: 0 });
    opts.introReady();
    gsap
      .timeline({ defaults: { ease: 'power3.out' } })
      .fromTo(q('[data-anim=hero-title]'), { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 })
      .fromTo(q('[data-anim=hero-item]'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.08 }, '-=0.55')
      .fromTo(q('[data-anim=demo-tv]'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.7')
      .fromTo(q('[data-anim=demo-phone]'), { y: 70, rotate: opts.rtl ? 6 : -6, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 1, ease: 'back.out(1.4)' }, '-=0.55')
      .fromTo(q('[data-anim=demo-tablet]'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, '-=0.7');

    // 2. Word band: a slow endless loop; the track holds two copies, so half its width is one cycle.
    const track = q('.marquee-track')[0];
    if (track) gsap.to(track, { xPercent: opts.rtl ? 50 : -50, ease: 'none', duration: 32, repeat: -1 });

    // 3. Steps: the phone shows the step in the middle of the screen.
    q('[data-step]').forEach((el) => {
      const i = Number((el as HTMLElement).dataset.step);
      ScrollTrigger.create({ trigger: el, start: 'top 60%', end: 'bottom 60%', onToggle: (self) => self.isActive && opts.onStep(i) });
    });

    // 4. Statement: words light up with the scroll.
    const words = q('[data-anim=statement] .statement-word');
    if (words.length)
      gsap.fromTo(words, { opacity: 0.16 }, { opacity: 1, stagger: 0.12, ease: 'none', scrollTrigger: { trigger: words[0]!.parentElement, start: 'top 80%', end: 'bottom 45%', scrub: true } });

    // 5. The staff board slides over the counter scene.
    const board = q('[data-anim=cashier-board]');
    if (board.length) gsap.from(board, { y: 60, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: board[0], start: 'top 90%', once: true } });

    // 6. The three alert routes branch out in order.
    const routes = q('[data-anim=reach-item]');
    if (routes.length) gsap.from(routes, { y: 30, opacity: 0, duration: 0.6, stagger: 0.15, ease: 'power2.out', scrollTrigger: { trigger: routes[0], start: 'top 85%', once: true } });

    // 7. POS flow: receipt, then customer number, then the ring.
    const flow = q('[data-anim=pos-flow] .pos-step, [data-anim=pos-flow] .pos-arrow');
    if (flow.length) gsap.from(flow, { y: 20, opacity: 0, duration: 0.5, stagger: 0.18, ease: 'power2.out', scrollTrigger: { trigger: flow[0], start: 'top 80%', once: true } });

    // 8. Closing line lands.
    const closing = q('[data-anim=closing]');
    if (closing.length) gsap.from(closing, { scale: 0.92, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: closing[0], start: 'top 85%', once: true } });

    return () => undefined;
  });
  return () => mm.revert();
}

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// GSAP runtime for the shared motion vocabulary (see motion.ts). Loaded on demand, never for reduced motion.
// Entrances are short and quiet (≤ 0.6 s, small distances); the brand moments carry the personality.

gsap.registerPlugin(ScrollTrigger);
gsap.defaults({ ease: 'power3.out', duration: 0.5 });

const seen = new WeakSet<Element>();
const EASE_SETTLE = 'back.out(1.6)';

/** Children that take part in an entrance: skip hidden and screen-reader-only nodes. */
const kids = (el: Element) => Array.from(el.children).filter((c) => !(c as HTMLElement).classList?.contains('sr-only') && (c as HTMLElement).offsetParent !== null);

function onceInView(el: Element, play: () => void) {
  const r = el.getBoundingClientRect();
  if (r.top < window.innerHeight * 0.92) return play();
  ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: play });
}

function countUp(el: HTMLElement) {
  const text = el.textContent ?? '';
  const m = text.match(/\d[\d,.\s]*/);
  if (!m) return;
  const raw = m[0];
  const target = Number(raw.replace(/[,\s]/g, ''));
  if (!Number.isFinite(target) || target === 0) return;
  const decimals = (raw.split('.')[1] ?? '').replace(/\D/g, '').length;
  const grouped = /,/.test(raw);
  const fmt = (v: number) => {
    const s = v.toFixed(decimals);
    return grouped ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
  };
  const state = { v: 0 };
  // Keep the width steady while digits change (tabular figures), and announce only the final value.
  el.style.fontVariantNumeric = 'tabular-nums';
  el.setAttribute('aria-label', text.trim());
  gsap.to(state, {
    v: target,
    duration: Math.min(1.4, 0.6 + Math.log10(target + 1) * 0.25),
    ease: 'power2.out',
    onUpdate: () => (el.textContent = text.replace(raw, fmt(state.v))),
    onComplete: () => {
      el.textContent = text;
      el.removeAttribute('aria-label');
    },
  });
}

function draw(el: Element) {
  const paths = el.querySelectorAll<SVGGeometryElement>('path, circle');
  paths.forEach((p, i) => {
    if (p.tagName === 'circle' && p.getAttribute('fill') !== 'none' && !p.getAttribute('stroke')) {
      // The ember dot lands after the ring has drawn.
      gsap.from(p, { scale: 0, transformOrigin: '50% 50%', duration: 0.45, ease: EASE_SETTLE, delay: 0.55 + i * 0.05 });
      return;
    }
    const len = p.getTotalLength?.() ?? 0;
    if (!len) return;
    gsap.fromTo(p, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' });
  });
}

function prepare(el: HTMLElement) {
  if (seen.has(el)) return;
  seen.add(el);
  switch (el.dataset.motion) {
    case 'page':
      gsap.fromTo(kids(el), { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.06, clearProps: 'transform,opacity,visibility' });
      break;
    case 'stagger': {
      const items = kids(el);
      gsap.set(items, { y: 18, autoAlpha: 0 });
      onceInView(el, () => gsap.to(items, { y: 0, autoAlpha: 1, stagger: 0.06, duration: 0.55, clearProps: 'transform,opacity,visibility' }));
      break;
    }
    case 'rise':
      gsap.set(el, { y: 22, autoAlpha: 0 });
      onceInView(el, () => gsap.to(el, { y: 0, autoAlpha: 1, duration: 0.6, clearProps: 'transform,opacity,visibility' }));
      break;
    case 'pop':
      gsap.fromTo(el, { scale: 0.86, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.45, ease: EASE_SETTLE, clearProps: 'transform,opacity,visibility' });
      break;
    case 'count':
      onceInView(el, () => countUp(el));
      break;
    case 'draw':
      draw(el);
      break;
  }
}

function scan(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-motion]').forEach(prepare);
}

/** Prepares every [data-motion] element under `root` now and whenever new ones are rendered. */
export function watch(root: HTMLElement) {
  scan(root);
  let queued = false;
  const mo = new MutationObserver((records) => {
    if (queued) return;
    if (!records.some((r) => r.addedNodes.length)) return;
    queued = true;
    // Same frame as React's commit, before paint: no flash of the final state.
    queueMicrotask(() => {
      queued = false;
      scan(root);
    });
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}

/**
 * FLIP step for useFlip(): items glide from their previous rects; new items fade up into place. `carry` holds the
 * offset an item still had from a glide that was interrupted, so the new glide starts from where it is drawn
 * instead of jumping. Calm, single-direction easing (no overshoot): cards on a busy board should never wobble.
 */
export function flip(items: HTMLElement[], prev: Map<string, DOMRect>, next: Map<string, DOMRect>, carry = new Map<string, { x: number; y: number }>()) {
  for (const item of items) {
    const id = item.dataset.flipId!;
    const a = prev.get(id);
    const b = next.get(id);
    if (!b) continue;
    if (!a) {
      gsap.killTweensOf(item);
      gsap.fromTo(item, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity,visibility' });
      continue;
    }
    const c = carry.get(id) ?? { x: 0, y: 0 };
    const dx = a.left - b.left + c.x;
    const dy = a.top - b.top + c.y;
    // Same layout spot as last time: a glide already running there just carries on.
    if (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1) continue;
    gsap.killTweensOf(item, 'x,y');
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      gsap.set(item, { clearProps: 'transform,zIndex,position' });
      continue;
    }
    // The item that travels furthest (the one that changed column) passes over neighbours that only shift.
    const dist = Math.hypot(dx, dy);
    const z = 2 + Math.min(50, Math.round(dist / 24));
    gsap.fromTo(
      item,
      { x: dx, y: dy, zIndex: z, position: 'relative' },
      { x: 0, y: 0, duration: Math.min(0.5, 0.28 + dist / 2400), ease: 'expo.out', clearProps: 'transform,zIndex,position' },
    );
  }
}

/** Named one-off moments, each tied to the brand idea: a ring that is almost closed, about to be called. */
export const moments = {
  /**
   * The customer's ring: the arc ([data-ring-arc], pathLength=1) closes toward `progress` (0–1). When `ready`,
   * it snaps shut, the ember dot ([data-ring-dot]) ignites and a pulse ([data-ring-pulse]) radiates.
   */
  ring(el: Element, a?: { progress: number; ready: boolean }) {
    const arc = el.querySelector('[data-ring-arc]');
    const dot = el.querySelector('[data-ring-dot]');
    const pulse = el.querySelector('[data-ring-pulse]');
    const p = Math.max(0, Math.min(1, a?.progress ?? 0));
    const tl = gsap.timeline();
    // pathLength=1 means the offset is a fraction, not pixels: tween the attribute without rounding.
    if (arc) tl.to(arc, { attr: { 'stroke-dashoffset': 1 - (a?.ready ? 1 : p) }, autoRound: false, duration: a?.ready ? 0.7 : 1.1, ease: a?.ready ? 'power4.inOut' : 'power2.out' });
    if (a?.ready) {
      if (dot) tl.fromTo(dot, { scale: 0.4, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.45)' }, '-=0.1');
      if (pulse)
        tl.fromTo(pulse, { scale: 0.9, autoAlpha: 0.7, transformOrigin: '50% 50%' }, { scale: 1.6, autoAlpha: 0, duration: 1.4, ease: 'power2.out', repeat: -1, repeatDelay: 0.3 }, '<');
    }
    return () => tl.kill();
  },

  /** A number that just became ready on the TV: lands with weight, then one ember pulse ([data-land-pulse]). */
  land(el: Element) {
    const pulse = el.querySelector('[data-land-pulse]');
    const tl = gsap.timeline();
    tl.fromTo(el, { scale: 1.18, y: -12, autoAlpha: 0 }, { scale: 1, y: 0, autoAlpha: 1, duration: 0.7, ease: 'power4.out', clearProps: 'transform,opacity,visibility' });
    if (pulse) tl.fromTo(pulse, { scale: 0.8, autoAlpha: 0.8, transformOrigin: '50% 50%' }, { scale: 1.5, autoAlpha: 0, duration: 1.2, ease: 'power2.out' }, '-=0.35');
    return () => tl.kill();
  },

  /** A gentle sweep under the active navigation item: answers the click by showing where you went. */
  indicator(el: Element) {
    const tween = gsap.fromTo(el, { scaleX: 0.4, autoAlpha: 0, transformOrigin: 'center' }, { scaleX: 1, autoAlpha: 1, duration: 0.35, ease: 'power2.out' });
    return () => tween.kill();
  },
};

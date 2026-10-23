import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

// Shared motion (GSAP). This module never imports GSAP: the runtime (motion-runtime.ts) is a separate chunk loaded
// after first render, so it never counts against an app's initial-route budget (TR-FE-05), and it is never loaded
// for visitors who ask for reduced motion. Every screen is complete without it.
//
// Markup vocabulary, used sparingly (one orchestrated moment per screen, plus motion that answers an action):
//   data-motion="page"     a page header: its children arrive in a short stagger once (PageShell sets it)
//   data-motion="stagger"  a group of tiles or cards: children arrive in order once, when scrolled into view
//   data-motion="rise"     one element arrives once, when scrolled into view
//   data-motion="pop"      a status that just appeared (a badge, a ready number): a small settle
//   data-motion="count"    a big figure counts up to its value once (digits only; other characters are kept)
//   data-motion="draw"     an SVG whose paths draw themselves once (the brand ring)
// Lists whose items move (the staff board, the TV board) use useFlip() instead: items glide to their new place.

type Runtime = typeof import('./motion-runtime');

let runtime: Promise<Runtime> | null = null;

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Starts loading GSAP (once). Resolves to null when motion is off. */
export function loadMotion(): Promise<Runtime | null> {
  if (prefersReducedMotion() || typeof window === 'undefined') return Promise.resolve(null);
  runtime ??= import('./motion-runtime');
  return runtime.catch(() => null);
}

/**
 * Call once in an app's entry, before render. Hides [data-motion] elements only until the runtime has prepared
 * them (at most 1.2 s), so an entrance never starts from content that was already visible. Skipped for reduced
 * motion and in tests.
 */
export function preloadMotion() {
  if (typeof document === 'undefined' || prefersReducedMotion() || import.meta.env?.MODE === 'test') return;
  const html = document.documentElement;
  html.classList.add('motion-pending');
  const release = () => html.classList.remove('motion-pending');
  const timer = setTimeout(release, 1200);
  void loadMotion().then((rt) => {
    if (!rt) return release();
    rt.watch(document.body);
    clearTimeout(timer);
    // Let the runtime set its starting states on this frame, then reveal.
    requestAnimationFrame(release);
  });
}

/** The translation a transform string applies (what an in-flight glide still adds to an item's layout position). */
function translation(transform: string) {
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  try {
    const m = new DOMMatrixReadOnly(transform);
    return { x: m.m41, y: m.m42 };
  } catch {
    return { x: 0, y: 0 };
  }
}

/**
 * Keyed FLIP: children with data-flip-id glide from where they were to where they are after each render, and new
 * ones settle in. Pass the list (or anything that changes when items move) as `deps`. When `scope` changes (a
 * different tab, a different layout) the items are a new set: they are shown in place, not animated.
 */
export function useFlip(container: RefObject<HTMLElement | null>, deps: unknown[], scope?: string | number | boolean) {
  const last = useRef(new Map<string, DOMRect>());
  const lastScope = useRef(scope);
  // Layout effect: measure after React has moved the nodes but before the browser paints them.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-flip-id]'));
    // Measure layout positions, not where an item is drawn mid-glide: a render that lands during a glide (the
    // server confirming a move, the clock ticking) would otherwise record a half-way spot and snap from it.
    // The in-flight offset is kept so the next glide continues from where the item is on screen.
    const moving = items.filter((item) => item.style.transform);
    const saved = moving.map((item) => item.style.transform);
    moving.forEach((item) => (item.style.transform = 'none'));
    // Relative to the container, so page scrolling between renders is not replayed as movement.
    const box = el.getBoundingClientRect();
    const next = new Map<string, DOMRect>();
    for (const item of items) {
      const r = item.getBoundingClientRect();
      next.set(item.dataset.flipId!, new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height));
    }
    const carry = new Map<string, { x: number; y: number }>();
    moving.forEach((item, i) => {
      item.style.transform = saved[i]!;
      carry.set(item.dataset.flipId!, translation(saved[i]!));
    });
    const prev = last.current;
    last.current = next;
    const sameScope = lastScope.current === scope;
    lastScope.current = scope;
    if (prev.size === 0 || !sameScope || prefersReducedMotion()) return;
    void loadMotion().then((rt) => rt?.flip(items, prev, next, carry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, scope]);
  // Scrolling or resizing moves every rect; forget them so the next change does not replay that as motion.
  useEffect(() => {
    const reset = () => last.current.clear();
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);
}

/** Runs a named one-off moment from the runtime (for example the customer's ring closing) on an element. */
export function useMoment<K extends keyof Runtime['moments']>(ref: RefObject<HTMLElement | SVGElement | null>, name: K, deps: unknown[], arg?: Parameters<Runtime['moments'][K]>[1]) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: (() => void) | void;
    let cancelled = false;
    void loadMotion().then((rt) => {
      if (cancelled || !rt) return;
      cleanup = (rt.moments[name] as (e: Element, a?: unknown) => (() => void) | void)(el, arg);
    });
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

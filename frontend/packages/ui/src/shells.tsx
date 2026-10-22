import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark.js';

// App frames shared by the console and the restaurant admin (brand: console shell and auth split screen).
// @dop/ui does not depend on the router: apps render their own NavLinks and style them with navItemClass().

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Class for a sidebar link: the active item is an ink pill. */
export const navItemClass = (active: boolean) =>
  cx(
    'group flex min-h-12 items-center gap-3 rounded-input px-3 text-[0.9375rem] font-medium transition-colors',
    active ? 'bg-ink text-white shadow-button' : 'text-ink-2 hover:bg-canvas hover:text-ink',
  );

/** The dot in front of a sidebar link; it glows on the active item and settles in when you arrive. */
export function NavMarker({ active }: { active: boolean }) {
  return <span key={active ? 'on' : 'off'} aria-hidden="true" data-motion={active ? 'pop' : undefined} className={cx('size-1.5 shrink-0 rounded-full', active ? 'bg-glow' : 'bg-current opacity-40')} />;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Signed-in person: gradient initials, name and a detail line (role, venue). */
export function AccountChip({ name, detail }: { name: string; detail?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-glow to-primary font-display text-sm font-bold text-white">
        {initials(name) || '•'}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block truncate font-semibold">{name}</span>
        {detail && <span className="block truncate text-muted">{detail}</span>}
      </span>
    </div>
  );
}

/** Group heading inside the sidebar navigation. */
export function NavGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="eyebrow px-3 pb-1">{label}</span>}
      {children}
    </div>
  );
}

/**
 * Sticky white sidebar (brand, grouped navigation, account and footer actions) beside the page. On small screens
 * the sidebar collapses to a top bar with a menu button; `menuOpen`/`onMenu` are owned by the app.
 */
export function SidebarShell({
  title,
  nav,
  account,
  footer,
  top,
  children,
  navLabel,
  menuOpen,
  onMenu,
  menuText,
}: {
  title: ReactNode;
  nav: ReactNode;
  account?: ReactNode;
  footer?: ReactNode;
  /** Bars above the page (environment, notices). */
  top?: ReactNode;
  children: ReactNode;
  navLabel: string;
  menuOpen: boolean;
  onMenu: () => void;
  menuText: { open: string; close: string };
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:flex-row">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-68 lg:shrink-0 lg:flex-col lg:border-e lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:pt-6 lg:pb-4">
          <span className="flex min-w-0 items-center gap-3 font-display text-lg font-bold">
            <span data-motion="draw" className="contents">
              <BrandMark />
            </span>
            <span className="truncate">{title}</span>
          </span>
          <button
            type="button"
            className="inline-flex min-h-12 items-center gap-2 rounded-control border border-line px-4 font-semibold lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="app-nav"
            onClick={onMenu}
          >
            <span aria-hidden="true" className="flex w-4 flex-col gap-1">
              <span className={cx('h-0.5 rounded bg-current transition-transform', menuOpen && 'translate-y-[3px] rotate-45')} />
              <span className={cx('h-0.5 rounded bg-current transition-transform', menuOpen && '-translate-y-[3px] -rotate-45')} />
            </span>
            {menuOpen ? menuText.close : menuText.open}
          </button>
        </div>
        <nav id="app-nav" aria-label={navLabel} className={cx(menuOpen ? 'flex' : 'hidden', 'flex-col gap-5 overflow-y-auto px-3 pb-4 lg:flex lg:min-h-0 lg:flex-1')}>
          {nav}
        </nav>
        {(account || footer) && (
          <div className={cx(menuOpen ? 'flex' : 'hidden', 'flex-col gap-2 border-t border-line p-3 lg:flex')}>
            {account}
            {footer}
          </div>
        )}
      </aside>
      <div className="min-w-0 flex-1">
        {top}
        <div className="lg:px-4 lg:py-2">{children}</div>
      </div>
    </div>
  );
}

/**
 * Split screen for sign-in and invitation pages: an ink brand panel with one ember glow (wide screens) and the
 * form on white.
 */
export function AuthShell({
  appTitle,
  panelEyebrow,
  headline,
  points,
  title,
  eyebrow,
  corner,
  children,
}: {
  appTitle: ReactNode;
  panelEyebrow?: ReactNode;
  headline: ReactNode;
  points?: ReactNode[];
  title: ReactNode;
  eyebrow?: ReactNode;
  /** Top-end control on the form side, usually the language switch. */
  corner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="ember-glow hidden flex-col justify-between gap-10 bg-ink p-12 text-white lg:flex">
        <span className="flex items-center gap-3 font-display text-lg font-bold">
          <span data-motion="draw" className="contents">
            <BrandMark tone="light" />
          </span>
          {appTitle}
        </span>
        <div data-motion="page" className="flex max-w-lg flex-col gap-6">
          {panelEyebrow && <span className="eyebrow text-white/65">{panelEyebrow}</span>}
          <p className="font-display text-5xl leading-[1.05] font-extrabold tracking-tight text-balance">{headline}</p>
          {points && points.length > 0 && (
            <ul className="flex flex-col gap-3 text-white/85">
              {points.map((p, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-glow" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-sm text-white/55">© {new Date().getFullYear()} Tanbeeh</span>
      </aside>

      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-3 font-display font-bold lg:invisible">
            <BrandMark className="size-8" />
            {appTitle}
          </span>
          {corner}
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10">
          <div data-motion="page" className="flex flex-col gap-2">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h1 className="text-3xl font-bold">{title}</h1>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

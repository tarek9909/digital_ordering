import { useTranslation } from '@dop/i18n';
import { BrandMark } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { api } from '../lib/api';
import { setTheme, useTheme } from '../lib/theme';
import type { TodayReport } from '../lib/types';
import { useCurrentVenueId, useVenues, useVenueStore } from '../lib/venue';

// The restaurant admin's frame: a floating white sidebar that folds to an icon rail and, above every page, the "pass" —
// a floating ink bar that keeps the venue being run and its live service in view, the way the pass between kitchen and
// counter does, and carries the language switch and sign-out.

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Sidebar link: the active item gets a canvas pill and an ink notch on its start edge; a folded rail shows the icon only. */
export const sideItemClass = (active: boolean, collapsed = false) =>
  cx(
    'relative flex min-h-12 items-center rounded-input text-[0.9375rem] transition-colors',
    collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
    'before:absolute before:inset-y-3 before:start-0 before:w-[3px] before:rounded-full before:transition-colors',
    active ? 'bg-canvas font-semibold text-ink before:bg-ink' : 'font-medium text-ink-2 before:bg-transparent hover:bg-canvas/70 hover:text-ink',
  );

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  venue: 'M4 9l1-5h14l1 5M4 9v11h16V9M4 9a3 3 0 0 0 5 0 3 3 0 0 0 6 0 3 3 0 0 0 5 0M10 20v-5h4v5',
  counters: 'M4 6h16M4 12h16M4 18h10',
  screens: 'M3 5h18v11H3zM8 20h8M12 16v4',
  staff: 'M3 5h18v11H3zM8 20h8M12 16v4',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  team: 'M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 20v-1a3 3 0 0 0-2-2.8M16 5.2a3 3 0 0 1 0 5.6',
  billing: 'M3 6h18v12H3zM3 10h18M7 15h3',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
};

/** Line icon for a nav entry; decorative, the label carries the name. */
export function NavIcon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name] ?? ICONS.home} />
    </svg>
  );
}

export function SideGroup({ label, children, collapsed }: { label: ReactNode; children: ReactNode; collapsed?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {collapsed ? <span aria-hidden="true" className="mx-auto my-1 hidden h-px w-6 bg-line lg:block" /> : null}
      <span className={cx('px-3.5 pb-1 text-xs font-semibold text-muted', collapsed && 'lg:sr-only')}>{label}</span>
      {children}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Closes a pop-up panel on Escape or a click outside it, returning focus to its button. */
function useDismiss(open: boolean, close: () => void, root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        root.current?.querySelector('button')?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close, root]);
}

/**
 * The signed-in person at the foot of the sidebar: a row with their initials, name and role that opens a panel with a
 * link to their account (when they have one) and sign-out. In the folded rail only the initials show.
 */
export function AccountMenu({
  name,
  detail,
  badge,
  accountTo,
  accountLabel,
  signOutLabel,
  onSignOut,
  collapsed,
}: {
  name: string;
  detail?: ReactNode;
  badge?: ReactNode;
  accountTo?: string;
  accountLabel: string;
  signOutLabel: string;
  onSignOut: () => void;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-input px-3 text-start text-sm font-semibold transition-colors';
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={cx('flex min-h-14 w-full items-center gap-3 rounded-input px-2.5 py-2 text-start transition-colors hover:bg-canvas', open && 'bg-canvas', collapsed && 'lg:justify-center lg:px-0')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-panel font-display text-sm font-bold text-white">
          {initials(name) || '•'}
        </span>
        <span className={cx('min-w-0 flex-1 text-sm leading-tight', collapsed && 'lg:sr-only')}>
          <span className="block truncate font-semibold">{name}</span>
          {detail && <span className="block truncate text-muted">{detail}</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={cx('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180', collapsed && 'lg:hidden')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
      {open && (
        <div id={id} className="absolute start-0 bottom-[calc(100%+0.5rem)] z-40 flex w-64 flex-col gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-dialog">
          <div className="flex flex-col gap-0.5 px-3 py-2">
            <span className="truncate font-semibold">{name}</span>
            {detail && <span className="truncate text-sm text-muted">{detail}</span>}
            {badge}
          </div>
          <div className="my-1 h-px bg-line" />
          {accountTo && (
            <NavLink to={accountTo} className={cx(item, 'text-ink hover:bg-canvas')} onClick={close}>
              {accountLabel}
            </NavLink>
          )}
          <button type="button" className={cx(item, 'text-ink-2 hover:bg-danger-bg hover:text-danger')} onClick={onSignOut}>
            {signOutLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/** English | العربية as one segmented switch; the folded rail shows a single button for the other language. */
export function LangSwitch({ lng, onChange, label, collapsed }: { lng: 'en' | 'ar'; onChange: (l: 'en' | 'ar') => void; label: string; collapsed?: boolean }) {
  const chip = (code: 'en' | 'ar') =>
    cx('inline-flex min-h-9 flex-1 items-center justify-center rounded-full px-3 text-sm font-semibold transition-colors', lng === code ? 'bg-surface text-ink shadow-button' : 'text-ink-2 hover:text-ink');
  const other = lng === 'ar' ? 'en' : 'ar';
  return (
    <>
      <div role="group" aria-label={label} className={cx('flex items-center gap-0.5 rounded-full bg-canvas p-1', collapsed && 'lg:hidden')}>
        <button type="button" lang="en" aria-pressed={lng === 'en'} className={chip('en')} onClick={() => onChange('en')}>
          English
        </button>
        <button type="button" lang="ar" aria-pressed={lng === 'ar'} className={chip('ar')} onClick={() => onChange('ar')}>
          العربية
        </button>
      </div>
      {collapsed && (
        <button
          type="button"
          lang={other}
          aria-label={other === 'ar' ? 'العربية' : 'English'}
          title={other === 'ar' ? 'العربية' : 'English'}
          className="mx-auto hidden size-11 place-items-center rounded-full bg-canvas text-sm font-bold transition-colors hover:bg-line/60 lg:grid"
          onClick={() => onChange(other)}
        >
          {other === 'ar' ? 'ع' : 'EN'}
        </button>
      )}
    </>
  );
}

/** Light | dark as one segmented switch; the folded rail shows a single button for the other theme. */
export function ThemeSwitch({ label, lightLabel, darkLabel, collapsed }: { label: string; lightLabel: string; darkLabel: string; collapsed?: boolean }) {
  const theme = useTheme();
  const chip = (t: 'light' | 'dark') =>
    cx('inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors', theme === t ? 'bg-surface text-ink shadow-button' : 'text-ink-2 hover:text-ink');
  const icon = (d: string) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
  const SUN = 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';
  const MOON = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z';
  const other = theme === 'dark' ? 'light' : 'dark';
  const otherLabel = other === 'dark' ? darkLabel : lightLabel;
  return (
    <>
      <div role="group" aria-label={label} className={cx('flex items-center gap-0.5 rounded-full bg-canvas p-1', collapsed && 'lg:hidden')}>
        <button type="button" aria-pressed={theme === 'light'} className={chip('light')} onClick={() => setTheme('light')}>
          {icon(SUN)}
          {lightLabel}
        </button>
        <button type="button" aria-pressed={theme === 'dark'} className={chip('dark')} onClick={() => setTheme('dark')}>
          {icon(MOON)}
          {darkLabel}
        </button>
      </div>
      {collapsed && (
        <button
          type="button"
          aria-label={otherLabel}
          title={otherLabel}
          className="mx-auto hidden size-11 place-items-center rounded-full bg-canvas transition-colors hover:bg-line/60 lg:grid"
          onClick={() => setTheme(other)}
        >
          {icon(other === 'dark' ? MOON : SUN)}
        </button>
      )}
    </>
  );
}

/** The venue being run, as a pill: a switch for multi-site tenants (TR-FE-26), remembered on this device; else its name. */
export function VenueSwitch({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const venues = useVenues(enabled).data ?? [];
  const current = useCurrentVenueId(enabled);
  const set = useVenueStore((s) => s.setVenueId);
  const pill = 'flex min-h-11 w-full min-w-0 items-center gap-2 rounded-input bg-canvas px-3.5 font-display text-base font-bold tracking-tight';
  if (venues.length < 2) return null;
  return (
    <span className="relative flex min-w-0 items-center">
      <label htmlFor={id} className="sr-only">
        {t('nav.switchVenue')}
      </label>
      <span aria-hidden="true" className="pointer-events-none absolute start-3.5 grid">
        <NavIcon name="venue" />
      </span>
      <select
        id={id}
        className={cx(pill, 'select-chevron cursor-pointer appearance-none truncate ps-11 pe-10 transition-colors hover:bg-line/60 [&>option]:bg-surface [&>option]:font-sans [&>option]:text-ink')}
        value={current ?? ''}
        onChange={(e) => set(e.target.value)}
      >
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * The sidebar's one action: open the staff board. While service is live it shows a pulsing dot and today's open
 * orders (the same report the Today page reads, so both stay in step). The folded rail shows a round icon button.
 */
export function StaffBoardButton({ venueEnabled, live, href, collapsed }: { venueEnabled: boolean; live: boolean; href: string | null; collapsed?: boolean }) {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId(venueEnabled);
  const today = useQuery({
    queryKey: ['today', venueId],
    queryFn: () => api.get<TodayReport>('/reports/today', { venueId: venueId ?? '' }),
    enabled: live && Boolean(venueId),
    refetchInterval: 60_000,
  }).data;
  if (!href) return null;
  const dot = live && (
    <span aria-hidden="true" className={cx('relative grid size-2.5 place-items-center', collapsed && 'lg:absolute lg:end-2 lg:top-2')}>
      <span className="absolute inset-0 rounded-full bg-glow opacity-60 motion-safe:animate-ping" />
      <span className="size-2 rounded-full bg-glow" />
    </span>
  );
  return (
    <a
      href={href}
      title={collapsed ? t('onboarding.openBoard') : undefined}
      className={cx(
        'relative flex min-h-12 items-center gap-2.5 rounded-input bg-panel px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-panel-2 active:scale-[.98]',
        collapsed && 'lg:mx-auto lg:size-12 lg:justify-center lg:px-0',
      )}
    >
      {dot}
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cx('hidden size-5 shrink-0', collapsed && 'lg:block')} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS.screens} />
      </svg>
      <span className={cx('min-w-0 flex-1 truncate', collapsed && 'lg:sr-only')}>{t('onboarding.openBoard')}</span>
      {today && (
        <span className={cx('num grid min-w-7 place-items-center rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold', collapsed && 'lg:sr-only')}>
          <span className="sr-only">{t('today.open')}: </span>
          {today.open}
        </span>
      )}
    </a>
  );
}

/** Sidebar fold toggle, beside the logo. Large screens only; small screens use the menu button. */
export function CollapseButton({ collapsed, onClick, label }: { collapsed: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="hidden size-10 shrink-0 place-items-center rounded-control text-ink-2 transition-colors hover:bg-canvas hover:text-ink lg:grid"
      aria-expanded={!collapsed}
      aria-controls="app-nav"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16" />
        <path d={collapsed ? 'M14 10l2 2-2 2' : 'M16 10l-2 2 2 2'} className="rtl:[transform:scaleX(-1)] rtl:[transform-origin:15px_12px]" />
      </svg>
    </button>
  );
}

/**
 * A floating sidebar that holds everything: the logo and fold toggle, the venue, the staff board action, the pages,
 * and at the foot the language switch and the person's menu. It folds to an icon rail on large screens (`collapsed`);
 * on small screens it is a header with a menu button (`menuOpen`/`onMenu`). `top` is for site-wide banners above the
 * page. State is owned by the layout.
 */
export function Frame({
  title,
  subtitle,
  venue,
  action,
  nav,
  footer,
  top,
  children,
  navLabel,
  menuOpen,
  onMenu,
  menuText,
  collapsed,
  onCollapse,
  collapseText,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  venue?: ReactNode;
  action?: ReactNode;
  nav: ReactNode;
  footer?: ReactNode;
  top?: ReactNode;
  children: ReactNode;
  navLabel: string;
  menuOpen: boolean;
  onMenu: () => void;
  menuText: { open: string; close: string };
  collapsed: boolean;
  onCollapse: () => void;
  collapseText: { collapse: string; expand: string };
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <aside
        className={cx(
          'border-b border-line bg-surface transition-[width] duration-200 ease-out motion-reduce:transition-none print:hidden',
          'lg:sticky lg:top-3 lg:m-3 lg:me-0 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:shrink-0 lg:flex-col lg:rounded-[var(--radius-card)] lg:border lg:shadow-card',
          collapsed ? 'lg:w-[4.75rem]' : 'lg:w-72',
        )}
      >
        <div className={cx('flex items-center justify-between gap-3 px-4 py-3 lg:pt-5 lg:pb-3', collapsed && 'lg:flex-col lg:px-2')}>
          <span className="flex min-w-0 items-center gap-3">
            <span data-motion="draw" className="contents">
              <BrandMark />
            </span>
            <span className={cx('flex min-w-0 flex-col leading-tight', collapsed && 'lg:sr-only')}>
              <span className="truncate font-display text-lg font-bold">{title}</span>
              {subtitle && <span className="truncate text-xs font-medium text-muted">{subtitle}</span>}
            </span>
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
          <CollapseButton collapsed={collapsed} onClick={onCollapse} label={collapsed ? collapseText.expand : collapseText.collapse} />
        </div>
        <div id="app-nav" className={cx(menuOpen ? 'flex' : 'hidden', 'min-h-0 flex-1 flex-col lg:flex')}>
          {(venue || action) && (
            <div className={cx('flex flex-col gap-2 px-3 pb-3', collapsed && 'lg:px-2')}>
              {venue && <div className={cx(collapsed && 'lg:hidden')}>{venue}</div>}
              {action}
            </div>
          )}
          <nav aria-label={navLabel} className={cx('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4', collapsed && 'lg:px-2')}>
            {nav}
          </nav>
          {footer && <div className={cx('flex flex-col gap-2 border-t border-line p-3', collapsed && 'lg:px-2')}>{footer}</div>}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {top}
        {children}
      </div>
    </div>
  );
}

import { useTranslation } from '@dop/i18n';
import { BrandMark } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { api } from '../lib/api';
import type { TodayReport } from '../lib/types';
import { useCurrentVenueId, useVenues, useVenueStore } from '../lib/venue';

// The restaurant admin's frame: a quiet white sidebar and, above every page, the "pass" — an ink strip that keeps
// the venue being run and its live service in view, the way the pass between kitchen and counter does.

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Sidebar link: the active item gets a canvas pill and an ink notch on its start edge. */
export const sideItemClass = (active: boolean) =>
  cx(
    'relative flex min-h-12 items-center rounded-input px-3.5 text-[0.9375rem] transition-colors',
    'before:absolute before:inset-y-3 before:start-0 before:w-[3px] before:rounded-full before:transition-colors',
    active ? 'bg-canvas font-semibold text-ink before:bg-ink' : 'font-medium text-ink-2 before:bg-transparent hover:bg-canvas/70 hover:text-ink',
  );

export function SideGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-3.5 pb-1 text-xs font-semibold text-muted">{label}</span>
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

/** Who is signed in; a link to their account when they have one. */
export function AccountLink({ name, detail, to }: { name: string; detail?: ReactNode; to?: string }) {
  const body = (
    <>
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white">
        {initials(name) || '•'}
      </span>
      <span className="min-w-0 text-sm leading-tight">
        <span className="block truncate font-semibold">{name}</span>
        {detail && <span className="block truncate text-muted">{detail}</span>}
      </span>
    </>
  );
  const base = 'flex min-h-14 items-center gap-3 rounded-input px-2.5 py-2';
  if (!to) return <div className={base}>{body}</div>;
  return (
    <NavLink to={to} className={({ isActive }) => cx(base, 'transition-colors hover:bg-canvas', isActive && 'bg-canvas')}>
      {body}
    </NavLink>
  );
}

/** The venue being run: a switch for multi-site tenants (TR-FE-26), remembered on this device; else its name. */
function VenueName({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const venues = useVenues(enabled).data ?? [];
  const current = useCurrentVenueId(enabled);
  const set = useVenueStore((s) => s.setVenueId);
  const name = venues.find((v) => v.id === current)?.name;
  const text = 'font-display text-base font-bold tracking-tight sm:text-lg';
  if (venues.length < 2) return name ? <span className={cx(text, 'truncate')}>{name}</span> : null;
  return (
    <span className="relative flex min-w-0 items-center">
      <label htmlFor={id} className="sr-only">
        {t('nav.switchVenue')}
      </label>
      <select
        id={id}
        className={cx(
          text,
          'select-chevron min-h-11 max-w-full min-w-0 cursor-pointer appearance-none truncate rounded-input bg-transparent ps-2.5 pe-9 text-white hover:bg-white/10 focus-visible:bg-white/10 [&>option]:bg-surface [&>option]:font-sans [&>option]:text-ink',
        )}
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
 * The pass: live dot, the venue, today's open orders and tickets, and the way to the staff board. It reads the same
 * report as the Today page (same query key), so both stay in step; the figures hide where Today shows them in full.
 */
export function Pass({ venueEnabled, live, showFigures, boardHref }: { venueEnabled: boolean; live: boolean; showFigures: boolean; boardHref: string | null }) {
  const { t } = useTranslation();
  const venueId = useCurrentVenueId(venueEnabled);
  const today = useQuery({
    queryKey: ['today', venueId],
    queryFn: () => api.get<TodayReport>('/reports/today', { venueId: venueId ?? '' }),
    enabled: live && Boolean(venueId),
    refetchInterval: 60_000,
  }).data;
  const figures: Array<[string, number]> = today && showFigures ? [[t('today.open'), today.open], [t('today.tickets'), today.tickets]] : [];
  return (
    <div role="region" aria-label={t('pass.label')} className="sticky top-0 z-30 bg-ink text-white print:hidden">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:gap-5 sm:px-8 lg:px-10">
        {live && (
          <span className="flex shrink-0 items-center gap-2 text-sm text-white/70">
            <span aria-hidden="true" className="relative grid size-2.5 place-items-center">
              <span className="absolute inset-0 rounded-full bg-glow opacity-60 motion-safe:animate-ping" />
              <span className="size-2 rounded-full bg-glow" />
            </span>
            <span className="hidden sm:inline">{t('pass.live')}</span>
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-5">
          <VenueName enabled={venueEnabled} />
          {figures.length > 0 && (
            <dl className="hidden items-baseline gap-5 border-s border-white/15 ps-5 md:flex">
              {figures.map(([label, n]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <dt className="text-sm text-white/60">{label}</dt>
                  <dd className="num font-display text-lg font-bold">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </span>
        {boardHref && (
          <a
            href={boardHref}
            className="inline-flex min-h-11 shrink-0 items-center rounded-control bg-white px-4 text-sm font-semibold whitespace-nowrap text-ink transition-[background-color,transform] duration-150 hover:bg-primary-wash active:scale-[.98]"
          >
            {t('onboarding.openBoard')}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Sidebar beside the page; on small screens it folds into a top bar with a menu button (`menuOpen`/`onMenu` are
 * owned by the layout).
 */
export function Frame({
  title,
  subtitle,
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
  subtitle?: ReactNode;
  nav: ReactNode;
  account?: ReactNode;
  footer?: ReactNode;
  top?: ReactNode;
  children: ReactNode;
  navLabel: string;
  menuOpen: boolean;
  onMenu: () => void;
  menuText: { open: string; close: string };
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:flex-row">
      <aside className="border-b border-line bg-surface print:hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-e lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:pt-6 lg:pb-5">
          <span className="flex min-w-0 items-center gap-3">
            <span data-motion="draw" className="contents">
              <BrandMark />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
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
        </div>
        <nav id="app-nav" aria-label={navLabel} className={cx(menuOpen ? 'flex' : 'hidden', 'flex-col gap-4 overflow-y-auto px-3 pb-4 lg:flex lg:min-h-0 lg:flex-1')}>
          {nav}
        </nav>
        {(account || footer) && (
          <div className={cx(menuOpen ? 'flex' : 'hidden', 'flex-col gap-1 border-t border-line p-3 lg:flex')}>
            {account}
            {footer}
          </div>
        )}
      </aside>
      <div className="min-w-0 flex-1">
        {top}
        {children}
      </div>
    </div>
  );
}

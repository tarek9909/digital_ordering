import { useTranslation } from '@dop/i18n';
import { AccountChip, Button, EmptyState, NavGroup, NavMarker, PageShell, Pill, SidebarShell, navItemClass } from '@dop/ui';
import { useId, useState } from 'react';
import { Navigate, NavLink, Outlet, useMatches } from 'react-router';
import { canReach, homeSection, isLimited, type Section } from '../lib/access';
import { authApi, BASENAME } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe, useTenant, viewerRole } from '../lib/me';
import { setSupportMode } from '../lib/support';
import { useCurrentVenueId, useVenues, useVenueStore } from '../lib/venue';
import { Banners } from './Banners';
import { LoadingShape } from './common';
import { LegalGate } from './LegalGate';

// Grouped like the work: running today's service, reading how it went, and running the business.
const NAV: Array<{
  group: 'service' | 'insights' | 'business';
  items: Array<{ section: Section; to: string }>;
}> = [
  {
    group: 'service',
    items: [
      { section: 'home', to: '/' },
      { section: 'venues', to: '/venues' },
      { section: 'venue', to: '/venue' },
      { section: 'counters', to: '/counters' },
      { section: 'staff', to: '/staff-access' },
      { section: 'displays', to: '/displays' },
      { section: 'posters', to: '/posters' },
    ],
  },
  {
    group: 'insights',
    items: [
      { section: 'reports', to: '/reports' },
      { section: 'ratings', to: '/ratings' },
    ],
  },
  {
    group: 'business',
    items: [
      { section: 'team', to: '/team' },
      { section: 'integrations', to: '/integrations' },
      { section: 'support', to: '/support' },
      { section: 'billing', to: '/billing' },
      { section: 'settings', to: '/settings' },
      { section: 'account', to: '/account' },
    ],
  },
];

export interface RouteHandle {
  section: Section;
}

async function signOut(support: boolean) {
  try {
    // Leaving support mode ends the support session on the server and clears its cookie (M-23), not only this
    // tab's flag; an ordinary sign-out revokes the user session.
    if (support) {
      await authApi.post('/support/leave').catch(() => undefined);
      setSupportMode(false);
    } else await authApi.post('/sign-out');
  } finally {
    window.location.assign(`${BASENAME}/sign-in`);
  }
}

function VenuePicker({ enabled, className }: { enabled: boolean; className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const venues = useVenues(enabled).data ?? [];
  const current = useCurrentVenueId(enabled);
  const set = useVenueStore((s) => s.setVenueId);
  // Venue switcher for multi-site tenants (TR-FE-26); the choice is remembered on this device.
  if (venues.length < 2) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="eyebrow px-1">
        {t('nav.switchVenue')}
      </label>
      <select
        id={id}
        className="select-chevron min-h-12 w-full appearance-none rounded-input border border-line bg-surface ps-3.5 pe-10 font-semibold hover:border-ink-2/30"
        value={current ?? ''}
        onChange={(e) => set(e.target.value)}
      >
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function LimitedAccess() {
  const { t } = useTranslation();
  return (
    <PageShell title={t('limited.title')} description={t('limited.body')}>
      <EmptyState title={t('limited.reachableTitle')}>{t('limited.reachable')}</EmptyState>
    </PageShell>
  );
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const tenant = useTenant();
  const status = tenant.data?.status;
  const role = viewerRole(me);
  const isSupport = me?.support === true;
  const limited = isLimited(status);
  const matches = useMatches();
  const section = (
    matches
      .map((m) => m.handle as RouteHandle | undefined)
      .filter(Boolean)
      .pop() ?? { section: 'home' }
  ).section;
  const allowed = canReach(section, status, role);
  const lng = i18n.language === 'ar' ? 'ar' : 'en';
  const [menuOpen, setMenuOpen] = useState(false);
  const pickVenue = (Boolean(tenant.data) || isSupport) && !limited;
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => canReach(n.section, status, role)),
  })).filter((g) => g.items.length > 0);

  const title = (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate">{tenant.data?.name ?? t('common:appName')}</span>
      {tenant.data && <span className="truncate font-sans text-xs font-medium text-muted">{t('common:appName')}</span>}
    </span>
  );

  const account = me && (
    <div className="flex flex-col gap-2">
      <AccountChip
        name={isSupport ? (me.agentName ?? t('nav.supportMode')) : me.user.name || me.user.email}
        detail={isSupport ? t('nav.supportMode') : role ? t(`roles.${role}`, { defaultValue: role }) : undefined}
      />
      {isSupport && (
        <span className="px-1">
          <Pill tone="warn">{t('nav.supportMode')}</Pill>
        </span>
      )}
    </div>
  );

  const footer = (
    <div className="flex gap-2">
      <Button variant="ghost" className="shrink-0 px-3" onClick={() => switchLang(lng === 'ar' ? 'en' : 'ar')} lang={lng === 'ar' ? 'en' : 'ar'}>
        {lng === 'ar' ? 'English' : 'العربية'}
      </Button>
      <Button variant="secondary" className="flex-1 px-3 whitespace-nowrap" onClick={() => void signOut(isSupport)}>
        {isSupport ? t('nav.leaveSupport') : t('common:signOut')}
      </Button>
    </div>
  );

  const nav = (
    <>
      <VenuePicker enabled={pickVenue} className="hidden px-1 pt-1 lg:flex" />
      {groups.map((g) => (
        <NavGroup key={g.group} label={t(`nav.groups.${g.group}`)}>
          {g.items.map((n) => (
            <NavLink key={n.section} to={n.to} end={n.to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => navItemClass(isActive)}>
              {({ isActive }) => (
                <>
                  <NavMarker active={isActive} />
                  {t(`nav.${n.section}`)}
                </>
              )}
            </NavLink>
          ))}
        </NavGroup>
      ))}
    </>
  );

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-input focus:bg-surface focus:p-3 focus:shadow-card">
        {t('nav.skip')}
      </a>
      <SidebarShell
        title={title}
        nav={nav}
        account={account}
        footer={footer}
        navLabel={t('nav.label')}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((o) => !o)}
        menuText={{ open: t('nav.menu'), close: t('nav.closeMenu') }}
        top={
          <div className="print:hidden">
            {/* On small screens the sidebar is a top bar, so the venue switch sits above the page. */}
            <VenuePicker enabled={pickVenue} className="border-b border-line bg-surface px-4 py-3 lg:hidden" />
            <Banners />
          </div>
        }
      >
        {/* Pages render their own <main> through PageShell. */}
        <div id="main" tabIndex={-1} className="outline-none">
          {tenant.isLoading ? (
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
              <LoadingShape kind="tiles" />
            </div>
          ) : allowed ? (
            <Outlet />
          ) : limited && section === 'home' ? (
            <Navigate to={`/${homeSection(status, role)}`} replace />
          ) : limited ? (
            <LimitedAccess />
          ) : (
            <PageShell title={t(`nav.${section}`)}>
              <p role="alert" className="font-semibold text-danger">
                {t('limited.notAllowed')}
              </p>
            </PageShell>
          )}
        </div>
      </SidebarShell>
      {!isSupport && <LegalGate />}
    </>
  );
}

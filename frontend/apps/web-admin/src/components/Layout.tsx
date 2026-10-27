import { useTranslation } from '@dop/i18n';
import { EmptyState, Pill } from '@dop/ui';
import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useMatches } from 'react-router';
import { canReach, homeSection, isLimited, type Section } from '../lib/access';
import { authApi, BASENAME } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe, useTenant, viewerRole } from '../lib/me';
import { setSupportMode } from '../lib/support';
import { useCurrentVenueId } from '../lib/venue';
import { staffBoardUrl } from '../pages/Home';
import { Banners } from './Banners';
import { reachableTabs } from './SubNav';
import { LoadingShape, Page } from './common';
import { AccountMenu, Frame, LangSwitch, NavIcon, SideGroup, StaffBoardButton, ThemeSwitch, VenueSwitch, sideItemClass } from './Frame';
import { LegalGate } from './LegalGate';

// Grouped like the work: running today's service, reading how it went, and running the business. Account is
// reached from the signed-in person at the foot of the sidebar.
const NAV: Array<{
  group: 'service' | 'insights' | 'business';
  // `also` are sibling pages reached from this entry (Venues from Venue, Staff and Displays from Counters & screens), so the
  // entry stays lit while you are on them.
  items: Array<{ section: Section; to: string; label?: string; also?: string[] }>;
}> = [
  {
    group: 'service',
    items: [
      { section: 'home', to: '/' },
      { section: 'venue', to: '/venue', also: ['/venues'] },
      { section: 'counters', to: '/counters', label: 'screens', also: ['/staff-access', '/displays', '/posters'] },
    ],
  },
  {
    group: 'insights',
    items: [{ section: 'reports', to: '/reports', also: ['/ratings'] }],
  },
  {
    group: 'business',
    items: [
      // One entry for the tabbed Settings and Team page; it opens the first tab this viewer may reach.
      { section: 'settings', to: '/settings', also: ['/team'] },
    ],
  },
];

const COLLAPSE_KEY = 'admin.sidebar.collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

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

function LimitedAccess() {
  const { t } = useTranslation();
  return (
    <Page title={t('limited.title')} description={t('limited.body')}>
      <EmptyState title={t('limited.reachableTitle')}>{t('limited.reachable')}</EmptyState>
    </Page>
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* a private window: the choice is not remembered */
      }
      return !c;
    });
  const pickVenue = (Boolean(tenant.data) || isSupport) && !limited;
  const venueId = useCurrentVenueId(pickVenue);
  // Live figures need the Today report; Today itself shows them in full, so the pass leaves them out there.
  const live = pickVenue && canReach('home', status, role);
  const businessTo = reachableTabs('business', status, role)[0]?.to;
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.flatMap((n) => (n.section === 'settings' ? (businessTo ? [{ ...n, to: businessTo }] : []) : canReach(n.section, status, role) ? [n] : [])),
  })).filter((g) => g.items.length > 0);

  const accountName = me ? (isSupport ? (me.agentName ?? t('nav.supportMode')) : me.user.name || me.user.email) : '';
  const footer = (
    <>
      <LangSwitch lng={lng} onChange={switchLang} label={t('nav.language')} collapsed={collapsed} />
      <ThemeSwitch label={t('nav.theme')} lightLabel={t('nav.themeLight')} darkLabel={t('nav.themeDark')} collapsed={collapsed} />
      {me && (
        <AccountMenu
          name={accountName}
          detail={isSupport ? t('nav.supportMode') : role ? t(`roles.${role}`, { defaultValue: role }) : undefined}
          badge={isSupport ? <Pill tone="warn">{t('nav.supportMode')}</Pill> : undefined}
          accountTo={canReach('account', status, role) ? '/account' : undefined}
          accountLabel={t('nav.account')}
          signOutLabel={isSupport ? t('nav.leaveSupport') : t('common:signOut')}
          onSignOut={() => void signOut(isSupport)}
          collapsed={collapsed}
        />
      )}
    </>
  );

  const { pathname } = useLocation();
  const isOn = (n: { to: string; also?: string[] }) => [n.to, ...(n.also ?? [])].some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
  const nav = groups.map((g) => (
    <SideGroup key={g.group} label={t(`nav.groups.${g.group}`)} collapsed={collapsed}>
      {g.items.map((n) => (
        <Link key={n.section} to={n.to} aria-current={isOn(n) ? 'page' : undefined} onClick={() => setMenuOpen(false)} className={sideItemClass(isOn(n), collapsed)} title={collapsed ? t(`nav.${n.label ?? n.section}`) : undefined}>
          <NavIcon name={n.label ?? n.section} />
          <span className={collapsed ? 'lg:sr-only' : undefined}>{t(`nav.${n.label ?? n.section}`)}</span>
        </Link>
      ))}
    </SideGroup>
  ));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-input focus:bg-surface focus:p-3 focus:shadow-card">
        {t('nav.skip')}
      </a>
      <Frame
        title={tenant.data?.name ?? t('common:appName')}
        subtitle={tenant.data ? t('common:appName') : undefined}
        logoUrl={tenant.data?.logoUrl}
        venue={pickVenue ? <VenueSwitch enabled={pickVenue} /> : undefined}
        action={<StaffBoardButton venueEnabled={pickVenue} live={live} href={live && venueId ? staffBoardUrl(venueId) : null} collapsed={collapsed} />}
        nav={nav}
        footer={footer}
        navLabel={t('nav.label')}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((o) => !o)}
        menuText={{ open: t('nav.menu'), close: t('nav.closeMenu') }}
        collapsed={collapsed}
        onCollapse={toggleCollapsed}
        collapseText={{ collapse: t('nav.collapse'), expand: t('nav.expand') }}
        top={
          <div className="print:hidden">
            <Banners />
          </div>
        }
      >
        {/* Pages render their own <main> through Page. */}
        <div id="main" tabIndex={-1} className="outline-none">
          {tenant.isLoading ? (
            <div className="px-4 py-8 sm:px-8 lg:px-10">
              <LoadingShape kind="tiles" />
            </div>
          ) : allowed ? (
            <Outlet />
          ) : limited && section === 'home' ? (
            <Navigate to={`/${homeSection(status, role)}`} replace />
          ) : limited ? (
            <LimitedAccess />
          ) : (
            <Page title={t(`nav.${section}`)}>
              <p role="alert" className="font-semibold text-danger">
                {t('limited.notAllowed')}
              </p>
            </Page>
          )}
        </div>
      </Frame>
      {!isSupport && <LegalGate />}
    </>
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

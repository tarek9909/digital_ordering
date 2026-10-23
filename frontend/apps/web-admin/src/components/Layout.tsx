import { useTranslation } from '@dop/i18n';
import { Button, EmptyState, Pill } from '@dop/ui';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useMatches } from 'react-router';
import { canReach, homeSection, isLimited, type Section } from '../lib/access';
import { authApi, BASENAME } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe, useTenant, viewerRole } from '../lib/me';
import { setSupportMode } from '../lib/support';
import { useCurrentVenueId } from '../lib/venue';
import { staffBoardUrl } from '../pages/Home';
import { Banners } from './Banners';
import { LoadingShape, Page } from './common';
import { AccountLink, Frame, Pass, SideGroup, sideItemClass } from './Frame';
import { LegalGate } from './LegalGate';

// Grouped like the work: running today's service, reading how it went, and running the business. Account is
// reached from the signed-in person at the foot of the sidebar.
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
  const pickVenue = (Boolean(tenant.data) || isSupport) && !limited;
  const venueId = useCurrentVenueId(pickVenue);
  // Live figures need the Today report; Today itself shows them in full, so the pass leaves them out there.
  const live = pickVenue && canReach('home', status, role);
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => canReach(n.section, status, role)),
  })).filter((g) => g.items.length > 0);

  const account = me && (
    <div className="flex flex-col gap-1">
      <AccountLink
        name={isSupport ? (me.agentName ?? t('nav.supportMode')) : me.user.name || me.user.email}
        detail={isSupport ? t('nav.supportMode') : role ? t(`roles.${role}`, { defaultValue: role }) : undefined}
        to={canReach('account', status, role) ? '/account' : undefined}
      />
      {isSupport && (
        <span className="px-2.5 pb-1">
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
      <Button variant="ghost" className="flex-1 px-3 whitespace-nowrap text-ink-2" onClick={() => void signOut(isSupport)}>
        {isSupport ? t('nav.leaveSupport') : t('common:signOut')}
      </Button>
    </div>
  );

  const nav = groups.map((g) => (
    <SideGroup key={g.group} label={t(`nav.groups.${g.group}`)}>
      {g.items.map((n) => (
        <NavLink key={n.section} to={n.to} end={n.to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => sideItemClass(isActive)}>
          {t(`nav.${n.section}`)}
        </NavLink>
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
        nav={nav}
        account={account}
        footer={footer}
        navLabel={t('nav.label')}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((o) => !o)}
        menuText={{ open: t('nav.menu'), close: t('nav.closeMenu') }}
        top={
          <div className="print:hidden">
            {pickVenue && venueId && <Pass venueEnabled={pickVenue} live={live} showFigures={section !== 'home'} boardHref={live ? staffBoardUrl(venueId) : null} />}
            <Banners />
          </div>
        }
      >
        {/* Pages render their own <main> through Page. */}
        <div id="main" tabIndex={-1} className="outline-none">
          {tenant.isLoading ? (
            <div className="max-w-6xl px-4 py-8 sm:px-8 lg:px-10">
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
}

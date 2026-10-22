import { useTranslation } from '@dop/i18n';
import { Button, Card } from '@dop/ui';
import { Navigate, NavLink, Outlet, useMatches } from 'react-router';
import { canReach, homeSection, isLimited, type Section } from '../lib/access';
import { authApi, BASENAME } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe, useTenant, viewerRole } from '../lib/me';
import { setSupportMode } from '../lib/support';
import { useCurrentVenueId, useVenues, useVenueStore } from '../lib/venue';
import { Banners } from './Banners';
import { Loading } from './common';
import { LegalGate } from './LegalGate';

const NAV: Array<{ section: Section; to: string }> = [
  { section: 'home', to: '/' },
  { section: 'venues', to: '/venues' },
  { section: 'venue', to: '/venue' },
  { section: 'counters', to: '/counters' },
  { section: 'staff', to: '/staff-access' },
  { section: 'displays', to: '/displays' },
  { section: 'posters', to: '/posters' },
  { section: 'reports', to: '/reports' },
  { section: 'ratings', to: '/ratings' },
  { section: 'team', to: '/team' },
  { section: 'integrations', to: '/integrations' },
  { section: 'support', to: '/support' },
  { section: 'billing', to: '/billing' },
  { section: 'settings', to: '/settings' },
  { section: 'account', to: '/account' },
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

function VenuePicker({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const venues = useVenues(enabled).data ?? [];
  const current = useCurrentVenueId(enabled);
  const set = useVenueStore((s) => s.setVenueId);
  // Venue switcher for multi-site tenants (TR-FE-26); the choice is remembered on this device.
  if (venues.length < 2) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="text-sm">{t('nav.switchVenue')}</span>
      <select className="min-h-12 rounded-lg border border-line bg-surface px-3" value={current ?? ''} onChange={(e) => set(e.target.value)}>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function LimitedAccess() {
  const { t } = useTranslation();
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-bold">{t('limited.title')}</h1>
      <p className="mb-2">{t('limited.body')}</p>
      <p className="text-muted">{t('limited.reachable')}</p>
    </Card>
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
  const section = (matches.map((m) => m.handle as RouteHandle | undefined).filter(Boolean).pop() ?? { section: 'home' }).section;
  const allowed = canReach(section, status, role);
  const lng = i18n.language === 'ar' ? 'ar' : 'en';

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-3">
        {t('nav.skip')}
      </a>
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="text-lg font-bold">
            {t('common:appName')}
            {tenant.data && <span className="ms-2 font-normal text-muted">· {tenant.data.name}</span>}
            {isSupport && <span className="ms-2 rounded-full bg-warn-bg px-2 py-0.5 text-sm text-warn">{t('nav.supportMode')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <VenuePicker enabled={(Boolean(tenant.data) || isSupport) && !limited} />
            <Button variant="ghost" onClick={() => switchLang(lng === 'ar' ? 'en' : 'ar')} lang={lng === 'ar' ? 'en' : 'ar'}>
              {lng === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Button variant="secondary" onClick={() => void signOut(isSupport)}>
              {isSupport ? t('nav.leaveSupport') : t('common:signOut')}
            </Button>
          </div>
        </div>
        <nav aria-label={t('nav.label')} className="mx-auto max-w-6xl overflow-x-auto px-2">
          <ul className="flex gap-1">
            {NAV.filter((n) => canReach(n.section, status, role)).map((n) => (
              <li key={n.section}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `inline-flex min-h-12 items-center whitespace-nowrap border-b-4 px-3 font-medium ${isActive ? 'border-primary text-primary' : 'border-transparent text-ink hover:bg-canvas'}`
                  }
                >
                  {t(`nav.${n.section}`)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="print:hidden">
        <Banners />
      </div>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">
        {tenant.isLoading ? (
          <Loading />
        ) : allowed ? (
          <Outlet />
        ) : limited && section === 'home' ? (
          <Navigate to={`/${homeSection(status, role)}`} replace />
        ) : limited ? (
          <LimitedAccess />
        ) : (
          <p role="alert">{t('limited.notAllowed')}</p>
        )}
      </main>
      {!isSupport && <LegalGate />}
    </div>
  );
}

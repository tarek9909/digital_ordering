import { useTranslation } from '@dop/i18n';
import type { TenantStatus } from '@dop/contracts';
import { Link, Outlet, useLocation } from 'react-router';
import { canReach, type Section, type ViewerRole } from '../lib/access';
import { useRole, useTenant } from '../lib/me';
import { Page, tabBarClass, tabClass } from './common';

// Pages that belong together share one sidebar entry and switch between each other here, so the sidebar stays short
// and a related page is one click away instead of a trip back to the menu.

export const SUBNAV = {
  screens: [
    { to: '/counters', label: 'nav.counters' },
    { to: '/staff-access', label: 'nav.staff' },
    { to: '/displays', label: 'nav.displays' },
    { to: '/posters', label: 'nav.posters' },
  ],
  insights: [
    { to: '/reports', label: 'nav.reports' },
    { to: '/ratings', label: 'nav.ratings' },
  ],
  // Settings and team read as one page; each tab keeps its own address so links and access rules still apply.
  business: [
    { to: '/settings', label: 'nav.general', section: 'settings' },
    { to: '/team', label: 'nav.team', section: 'team' },
  ],
} as const satisfies Record<string, ReadonlyArray<{ to: string; label: string; section?: Section }>>;

type Tab = { to: string; label: string; section?: Section };

/** Tabs of a group this viewer may open (a support agent sees neither settings nor team). */
export function reachableTabs(group: keyof typeof SUBNAV, status: TenantStatus | undefined, role: ViewerRole | null): Tab[] {
  return (SUBNAV[group] as readonly Tab[]).filter((i) => !i.section || canReach(i.section, status, role));
}

export function SubNav({ group }: { group: keyof typeof SUBNAV }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const tabs = reachableTabs(group, useTenant().data?.status, useRole());
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t('nav.related')} className={tabBarClass}>
      {tabs.map((i) => {
        const on = pathname === i.to || pathname.startsWith(`${i.to}/`);
        return (
          <Link
            key={i.to}
            to={i.to}
            aria-current={on ? 'page' : undefined}
            className={tabClass(on)}
          >
            {t(i.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * One page for a group of tabs (counters, staff, screens and posters; general, team and billing): the title and tab
 * bar stay in place and only the tab below them changes. Each tab keeps its own address and access rule.
 */
export function TabbedPage({ group, title }: { group: keyof typeof SUBNAV; title: string }) {
  const { t } = useTranslation();
  return (
    <Page title={t(title)} tabs={<SubNav group={group} />}>
      <Outlet />
    </Page>
  );
}

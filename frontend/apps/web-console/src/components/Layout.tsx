import { useTranslation } from '@dop/i18n';
import { AccountChip, Button, NavGroup, NavMarker, navItemClass, SidebarShell } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { authApi } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe } from '../lib/me';
import { can, type ConsolePermission } from '../lib/roles';

/** Environment bar (TR-FE-24): red on production, neutral elsewhere. */
export function EnvBar({ environment, className = '' }: { environment: string; className?: string }) {
  const { t } = useTranslation();
  const prod = environment === 'production';
  return (
    <div role="note" className={`px-4 py-1 text-center text-sm font-bold ${prod ? 'bg-danger text-white' : 'bg-line text-ink'} ${className}`}>
      {prod ? t('env.production') : t('env.other', { env: environment })}
    </div>
  );
}

type NavItem = { to: string; key: string; perm: ConsolePermission };
const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'tenants',
    items: [
      { to: '/tenants', key: 'nav.tenants', perm: 'tenants.read' },
      {
        to: '/tenants/new',
        key: 'nav.createTenant',
        perm: 'tenants.lifecycle',
      },
    ],
  },
  {
    group: 'platform',
    items: [
      { to: '/plans', key: 'nav.plans', perm: 'settings' },
      { to: '/announcements', key: 'nav.announcements', perm: 'announcements' },
      { to: '/website', key: 'nav.website', perm: 'settings' },
      { to: '/content', key: 'nav.content', perm: 'settings' },
      {
        to: '/platform-users',
        key: 'nav.platformUsers',
        perm: 'platform_users',
      },
      { to: '/settings', key: 'nav.settings', perm: 'settings' },
    ],
  },
  {
    group: 'insights',
    items: [
      { to: '/reports/platform', key: 'nav.platformReport', perm: 'reports' },
      { to: '/reports/pilot', key: 'nav.reports', perm: 'reports' },
      { to: '/audit', key: 'nav.audit', perm: 'audit' },
    ],
  },
];

/** The console frame: the shared sidebar shell with the console's navigation, environment bar and account. */
export function Layout() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const qc = useQueryClient();
  const role = me?.platformUser.role;
  const [menuOpen, setMenuOpen] = useState(false);
  const other = i18n.language === 'ar' ? 'en' : 'ar';

  const signOut = async () => {
    try {
      await authApi.post('/sign-out');
    } finally {
      qc.clear();
      window.location.assign('/sign-in');
    }
  };

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((n) => can(role, n.perm)),
  })).filter((g) => g.items.length > 0);

  return (
    // On small screens the environment bar sits above everything; next to the sidebar it heads the page column.
    <div className="flex min-h-dvh flex-col [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1">
      {me && <EnvBar environment={me.environment} className="lg:hidden" />}
      <SidebarShell
        title={t('appTitle')}
        navLabel={t('nav.label')}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((o) => !o)}
        menuText={{ open: t('layout.menu'), close: t('layout.closeMenu') }}
        top={me && <EnvBar environment={me.environment} className="hidden lg:block" />}
        nav={groups.map((g) => (
          <NavGroup key={g.group} label={t(`layout.groups.${g.group}`)}>
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end onClick={() => setMenuOpen(false)} className={({ isActive }) => navItemClass(isActive)}>
                {({ isActive }) => (
                  <>
                    <NavMarker active={isActive} />
                    {t(n.key)}
                  </>
                )}
              </NavLink>
            ))}
          </NavGroup>
        ))}
        account={me && <AccountChip name={me.platformUser.name} detail={t(`role.${me.platformUser.role}`)} />}
        footer={
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <Button variant="ghost" className="whitespace-nowrap" lang={other} onClick={() => switchLang(other)}>
              {t('otherLanguage')}
            </Button>
            <Button variant="secondary" className="whitespace-nowrap" onClick={() => void signOut()}>
              {t('common:signOut')}
            </Button>
          </div>
        }
      >
        {/* Pages render their own <main> through PageShell. */}
        <Outlet />
      </SidebarShell>
    </div>
  );
}

import { useTranslation } from '@dop/i18n';
import { Button } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { authApi } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe } from '../lib/me';
import { can, type ConsolePermission } from '../lib/roles';
import { BrandMark } from './BrandMark';

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
      { to: '/tenants/new', key: 'nav.createTenant', perm: 'tenants.lifecycle' },
    ],
  },
  {
    group: 'platform',
    items: [
      { to: '/plans', key: 'nav.plans', perm: 'settings' },
      { to: '/announcements', key: 'nav.announcements', perm: 'announcements' },
      { to: '/content', key: 'nav.content', perm: 'settings' },
      { to: '/platform-users', key: 'nav.platformUsers', perm: 'platform_users' },
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function Layout() {
  const { t, i18n } = useTranslation();
  const me = useMe().data;
  const qc = useQueryClient();
  const role = me?.platformUser.role;
  const [menuOpen, setMenuOpen] = useState(false);

  const signOut = async () => {
    try {
      await authApi.post('/sign-out');
    } finally {
      qc.clear();
      window.location.assign('/sign-in');
    }
  };

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => can(role, n.perm)) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      {/* Above everything on small screens; above the page content next to the sidebar on wide ones. */}
      {me && <EnvBar environment={me.environment} className="lg:hidden" />}
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-68 lg:shrink-0 lg:flex-col lg:border-e lg:border-b-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:pt-6 lg:pb-4">
            <span className="flex items-center gap-3 font-display text-lg font-bold">
              <BrandMark />
              {t('appTitle')}
            </span>
            <Button variant="secondary" className="lg:hidden" aria-expanded={menuOpen} aria-controls="console-nav" onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? t('layout.closeMenu') : t('layout.menu')}
            </Button>
          </div>

          <nav id="console-nav" aria-label={t('nav.label')} className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-4 overflow-y-auto px-3 pb-4 lg:flex lg:min-h-0 lg:flex-1`}>
            {groups.map((g) => (
              <div key={g.group} className="flex flex-col gap-0.5">
                <span className="eyebrow px-3 pb-1">{t(`layout.groups.${g.group}`)}</span>
                {g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `group flex min-h-12 items-center gap-3 rounded-input px-3 text-[0.9375rem] font-medium transition-colors ${
                        isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-canvas hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span aria-hidden="true" className={`size-1.5 rounded-full ${isActive ? 'bg-glow' : 'bg-current opacity-40'}`} />
                        {t(n.key)}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-2 border-t border-line p-3 lg:flex`}>
            {me && (
              <div className="flex items-center gap-3 rounded-2xl bg-canvas p-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-glow to-primary font-display text-sm font-bold text-white">
                  {initials(me.platformUser.name)}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">{me.platformUser.name}</span>
                  <span className="block truncate text-muted">{t(`role.${me.platformUser.role}`)}</span>
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" lang={i18n.language === 'ar' ? 'en' : 'ar'} onClick={() => switchLang(i18n.language === 'ar' ? 'en' : 'ar')}>
                {t('otherLanguage')}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => void signOut()}>
                {t('common:signOut')}
              </Button>
            </div>
          </div>
        </aside>

        {/* Pages render their own <main> through PageShell. */}
        <div className="min-w-0 flex-1">
          {me && <EnvBar environment={me.environment} className="hidden lg:block" />}
          <div className="lg:px-4 lg:py-2">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

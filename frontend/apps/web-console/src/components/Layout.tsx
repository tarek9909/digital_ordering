import { useTranslation } from '@dop/i18n';
import { AccountChip, Button, NavGroup, navItemClass, SidebarShell } from '@dop/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { authApi } from '../lib/api';
import { switchLang } from '../lib/lang';
import { useMe } from '../lib/me';
import { can, type ConsolePermission } from '../lib/roles';

/** Environment bar (TR-FE-24): red with live pulse on production, calm neutral elsewhere. */
export function EnvBar({ environment, className = '' }: { environment: string; className?: string }) {
  const { t } = useTranslation();
  const prod = environment === 'production';
  return (
    <div
      role="note"
      className={`px-4 py-1.5 text-center text-xs font-bold tracking-wide transition-colors flex items-center justify-center gap-2 ${
        prod ? 'bg-danger text-white shadow-sm' : 'bg-surface text-ink-2 border-b border-line'
      } ${className}`}
    >
      <span className={`size-2 rounded-full ${prod ? 'nova-live-dot bg-white' : 'bg-warn'}`} aria-hidden="true" />
      <span>{prod ? t('env.production') : t('env.other', { env: environment })}</span>
    </div>
  );
}

type NavItem = {
  to: string;
  key: string;
  perm: ConsolePermission;
  icon: (active: boolean) => ReactNode;
};

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'tenants',
    items: [
      {
        to: '/tenants',
        key: 'nav.tenants',
        perm: 'tenants.read',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <path d="M3 7.5L10 3l7 4.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V7.5z" />
            <path d="M7 18v-7h6v7" />
          </svg>
        ),
      },
    ],
  },
  {
    group: 'platform',
    items: [
      {
        to: '/plans',
        key: 'nav.plans',
        perm: 'settings',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <rect x="2" y="4" width="16" height="12" rx="2" />
            <path d="M2 9h16" />
            <path d="M6 13h2" />
          </svg>
        ),
      },
      {
        to: '/website',
        key: 'nav.website',
        perm: 'settings',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M2.5 10h15" />
            <path d="M10 2.5a11 11 0 010 15 11 11 0 010-15z" />
          </svg>
        ),
      },
      {
        to: '/content',
        key: 'nav.content',
        perm: 'settings',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <path d="M12 2.5H5a1.5 1.5 0 00-1.5 1.5v12A1.5 1.5 0 005 17.5h10a1.5 1.5 0 001.5-1.5V6.5L12 2.5z" />
            <path d="M11.5 2.5v4.5H16" />
            <path d="M7 11h6" />
            <path d="M7 14h4" />
          </svg>
        ),
      },
      {
        to: '/platform-users',
        key: 'nav.platformUsers',
        perm: 'platform_users',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <path d="M10 2.5L3.5 5.5v5c0 4 3 6.5 6.5 7.5 3.5-1 6.5-3.5 6.5-7.5v-5L10 2.5z" />
            <circle cx="10" cy="8.5" r="2" />
            <path d="M7 13.5c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5" />
          </svg>
        ),
      },
      {
        to: '/settings',
        key: 'nav.settings',
        perm: 'settings',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <circle cx="10" cy="10" r="2.5" />
            <path d="M16 10a6 6 0 00-.1-.9l1.4-1.1-1.3-2.3-1.7.5a6.2 6.2 0 00-1.5-.9L12.5 3.5h-2.7l-.3 1.8a6.2 6.2 0 00-1.5.9l-1.7-.5L5 8l1.4 1.1A6 6 0 006.3 10l-1.4 1.1 1.3 2.3 1.7-.5c.4.4.9.7 1.5.9l.3 1.8h2.7l.3-1.8c.6-.2 1.1-.5 1.5-.9l1.7.5 1.3-2.3-1.4-1.1c.1-.3.1-.6.1-.9z" />
          </svg>
        ),
      },
    ],
  },
  {
    group: 'insights',
    items: [
      {
        to: '/reports',
        key: 'nav.reportsHub',
        perm: 'reports',
        icon: (a) => (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`size-4.5 shrink-0 ${a ? 'text-glow' : 'opacity-70'}`} aria-hidden="true">
            <path d="M3 17h14" />
            <path d="M5.5 13.5L9 9.5l3.5 3L16 6.5" />
            <path d="M13 6.5h3v3" />
          </svg>
        ),
      },
    ],
  },
];

/** The console frame: shared sidebar shell with enhanced icons, navigation, and user controls. */
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
    <div className="flex min-h-dvh flex-col [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1 bg-canvas">
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
              <NavLink
                key={n.to}
                to={n.to}
                end
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `${navItemClass(isActive)} relative group overflow-hidden ${
                    isActive ? 'border-s-2 border-primary' : ''
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {n.icon(isActive)}
                    <span className="truncate flex-1 font-medium">{t(n.key)}</span>
                    {isActive && (
                      <span className="size-1.5 rounded-full bg-glow shadow-[0_0_8px_rgba(251,146,60,0.8)] shrink-0" aria-hidden="true" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </NavGroup>
        ))}
        account={
          me && (
            <div className="flex flex-col gap-2">
              <AccountChip
                name={me.platformUser.name}
                detail={
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="inline-block size-1.5 rounded-full bg-ok" aria-hidden="true" />
                    {t(`role.${me.platformUser.role}`)}
                  </span>
                }
              />
            </div>
          )
        }
        footer={
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/60">
            <Button
              variant="ghost"
              size="md"
              className="text-xs sm:text-sm font-semibold justify-center hover:bg-canvas"
              lang={other}
              onClick={() => switchLang(other)}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4 shrink-0 opacity-70" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" />
                <path d="M2.5 10h15" />
                <path d="M10 2.5a11 11 0 010 15 11 11 0 010-15z" />
              </svg>
              {t('otherLanguage')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              className="text-xs sm:text-sm font-semibold justify-center"
              onClick={() => void signOut()}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4 shrink-0 opacity-70" aria-hidden="true">
                <path d="M13 14l3-4-3-4" />
                <path d="M16 10H7" />
                <path d="M8 3.5H4.5A1.5 1.5 0 003 5v10a1.5 1.5 0 001.5 1.5H8" />
              </svg>
              {t('common:signOut')}
            </Button>
          </div>
        }
      >
        <Outlet />
      </SidebarShell>
    </div>
  );
}

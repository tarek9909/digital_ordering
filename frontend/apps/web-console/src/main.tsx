import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import { preloadMotion } from '@dop/ui';
import { initI18n, useTranslation } from '@dop/i18n';
import ar from '../../../packages/i18n/locales/ar/console.json';
import en from '../../../packages/i18n/locales/en/console.json';
import { ErrorBoundary } from '@dop/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { FreshMfaProvider } from './components/FreshMfa';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { createQueryClient } from './lib/api';
import { storedLang } from './lib/lang';
import { AcceptInvitePage } from './pages/AcceptInvite';
import { AuditPage } from './pages/Audit';
import { CreateTenantPage } from './pages/CreateTenant';
import { PlatformUsersPage } from './pages/PlatformUsers';
import { SettingsPage } from './pages/Settings';
import { SignInPage } from './pages/SignIn';
import { TenantDetailPage } from './pages/TenantDetail';
import { TenantsPage } from './pages/Tenants';

initI18n('console', { ar, en }, storedLang());

function Fallback() {
  const { t } = useTranslation();
  return (
    <div role="alert" className="p-6 text-lg font-semibold text-danger">
      {t('common:somethingWrong')}
    </div>
  );
}

/** Error boundary per route (TR-FE-04). */
const guard = (el: ReactNode) => <ErrorBoundary fallback={<Fallback />}>{el}</ErrorBoundary>;

const router = createBrowserRouter([
  { path: '/sign-in', element: guard(<SignInPage />) },
  { path: '/accept', element: guard(<AcceptInvitePage />) },
  {
    path: '/',
    element: guard(
      <RequireAuth>
        <Layout />
      </RequireAuth>,
    ),
    children: [
      { index: true, element: <Navigate to="/tenants" replace /> },
      { path: 'tenants', element: guard(<TenantsPage />) },
      { path: 'tenants/new', element: guard(<CreateTenantPage />) },
      { path: 'tenants/:id', element: guard(<TenantDetailPage />) },
      { path: 'platform-users', element: guard(<PlatformUsersPage />) },
      { path: 'settings', element: guard(<SettingsPage />) },
      { path: 'audit', element: guard(<AuditPage />) },
      {
        path: 'reports/pilot',
        // Recharts is only needed here: keep it out of the initial bundle (TR-FE-05).
        lazy: async () => {
          const m = await import('./pages/PilotReport');
          return { element: guard(<m.PilotReportPage />) };
        },
      },
      // R1.1 platform team pages, loaded on demand to keep the initial bundle small (TR-FE-05).
      {
        path: 'reports/platform',
        lazy: async () => {
          const m = await import('./pages/PlatformReport');
          return { element: guard(<m.PlatformReportPage />) };
        },
      },
      {
        path: 'plans',
        lazy: async () => {
          const m = await import('./pages/Plans');
          return { element: guard(<m.PlansPage />) };
        },
      },
      {
        path: 'announcements',
        lazy: async () => {
          const m = await import('./pages/Announcements');
          return { element: guard(<m.AnnouncementsPage />) };
        },
      },
      {
        path: 'website',
        lazy: async () => {
          const m = await import('./pages/Website');
          return { element: guard(<m.WebsitePage />) };
        },
      },
      {
        path: 'content',
        lazy: async () => {
          const m = await import('./pages/Content');
          return { element: guard(<m.ContentPage />) };
        },
      },
      { path: '*', element: <Navigate to="/tenants" replace /> },
    ],
  },
]);

const queryClient = createQueryClient();

// GSAP motion: loaded after first render, never for reduced motion (packages/ui/src/motion.ts).
preloadMotion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FreshMfaProvider>
        <RouterProvider router={router} />
      </FreshMfaProvider>
    </QueryClientProvider>
  </StrictMode>,
);

import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import { preloadMotion } from '@dop/ui';
import { initI18n, useTranslation } from '@dop/i18n';
import { ErrorBoundary } from '@dop/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import ar from '../../../packages/i18n/locales/ar/admin.json';
import en from '../../../packages/i18n/locales/en/admin.json';
import { Layout, type RouteHandle } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { TabbedPage } from './components/SubNav';
import { BASENAME, createQueryClient } from './lib/api';
import { storedLang } from './lib/lang';
import './lib/theme';
import { AccountPage } from './pages/Account';
import { BillingPage } from './pages/Billing';
import { CountersPage } from './pages/Counters';
import { DisplaysPage } from './pages/Displays';
import { HandoffPage } from './pages/Handoff';
import { HomePage } from './pages/Home';
import { InvitationPage } from './pages/Invitation';
import { PosterPrintPage } from './pages/PosterPrint';
import { PostersPage } from './pages/Posters';
import { RatingsPage } from './pages/Ratings';
import { SettingsPage } from './pages/Settings';
import { SignInPage } from './pages/SignIn';
import { StaffAccessPage } from './pages/StaffAccess';
import { SupportHandoffPage } from './pages/SupportHandoff';
import { TeamPage } from './pages/Team';
import { TwoFactorRequiredPage } from './pages/TwoFactorRequired';
import { VenuePage } from './pages/Venue';
import { VenuesPage } from './pages/Venues';

initI18n('admin', { ar, en }, storedLang());

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
const h = (section: RouteHandle['section']): RouteHandle => ({ section });

const router = createBrowserRouter(
  [
    { path: '/sign-in', element: guard(<SignInPage />) },
    { path: '/handoff', element: guard(<HandoffPage />) },
    { path: '/invitation', element: guard(<InvitationPage />) },
    { path: '/support-handoff', element: guard(<SupportHandoffPage />) },
    {
      path: '/two-factor',
      element: guard(
        <RequireAuth>
          <TwoFactorRequiredPage />
        </RequireAuth>,
      ),
    },
    {
      path: '/posters/print',
      element: guard(
        <RequireAuth>
          <PosterPrintPage />
        </RequireAuth>,
      ),
    },
    {
      path: '/',
      element: guard(
        <RequireAuth>
          <Layout />
        </RequireAuth>,
      ),
      children: [
        { index: true, element: guard(<HomePage />), handle: h('home') },
        { path: 'venues', element: guard(<VenuesPage />), handle: h('venues') },
        { path: 'venue/*', element: guard(<VenuePage />), handle: h('venue') },
        {
          element: <TabbedPage group="screens" title="nav.screens" />,
          children: [
            {
              path: 'counters',
              element: guard(<CountersPage />),
              handle: h('counters'),
            },
            {
              path: 'staff-access/*',
              element: guard(<StaffAccessPage />),
              handle: h('staff'),
            },
            {
              path: 'displays',
              element: guard(<DisplaysPage />),
              handle: h('displays'),
            },
            {
              path: 'posters/*',
              element: guard(<PostersPage />),
              handle: h('posters'),
            },
          ],
        },
        {
          path: 'reports',
          handle: h('reports'),
          // Recharts only loads here, keeping the initial bundle small (TR-FE-05).
          lazy: async () => {
            const m = await import('./pages/Reports');
            return { element: guard(<m.ReportsPage />) };
          },
        },
        {
          path: 'ratings',
          element: guard(<RatingsPage />),
          handle: h('ratings'),
        },
        {
          element: <TabbedPage group="business" title="nav.groups.business" />,
          children: [
            {
              path: 'settings/*',
              element: guard(<SettingsPage />),
              handle: h('settings'),
            },
            { path: 'team/*', element: guard(<TeamPage />), handle: h('team') },
            {
              path: 'billing/*',
              element: guard(<BillingPage />),
              handle: h('billing'),
            },
          ],
        },
        {
          path: 'account/*',
          element: guard(<AccountPage />),
          handle: h('account'),
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: BASENAME },
);

const queryClient = createQueryClient();

// GSAP motion: loaded after first render, never for reduced motion (packages/ui/src/motion.ts).
preloadMotion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import './site.css';
import { preloadMotion } from '@dop/ui';
import { initI18n } from '@dop/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import ar from '../../../packages/i18n/locales/ar/site.json';
import en from '../../../packages/i18n/locales/en/site.json';
import { Layout } from './components/Layout';
import { RouteBoundary } from './components/RouteBoundary';
import { initialLanguage } from './lib/lang';
import { ContactPage } from './pages/ContactPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PricingPage } from './pages/PricingPage';

// Marketing and sign-in site on www.{domain} (TRD §16.7). Venues are onboarded by the platform team; there is no
// self-signup. Arabic first unless the visitor chose English.
initI18n('site', { ar, en }, initialLanguage());

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true, retry: 2 } },
});

const b = (el: ReactNode) => <RouteBoundary>{el}</RouteBoundary>;
/** A route whose page component is loaded on demand. */
const page = (load: () => Promise<ComponentType>) => async () => {
  const Page = await load();
  return { element: b(<Page />) };
};

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: b(<NotFoundPage />),
    children: [
      { path: '/', element: b(<HomePage />) },
      { path: '/pricing', element: b(<PricingPage />) },
      { path: '/contact', element: b(<ContactPage />) },
      // Sign-in, account emails and legal pages load on demand (forms and validation stay out of the landing's
      // initial bundle, TR-FE-05).
      {
        path: '/verify-email',
        lazy: page(async () => (await import('./pages/VerifyEmailPage')).VerifyEmailPage),
      },
      {
        path: '/confirm-email',
        lazy: page(async () => (await import('./pages/ConfirmEmailPage')).ConfirmEmailPage),
      },
      {
        path: '/sign-in',
        lazy: page(async () => (await import('./pages/SignInPage')).SignInPage),
      },
      {
        path: '/forgot-password',
        lazy: page(async () => (await import('./pages/PasswordPages')).ForgotPasswordPage),
      },
      {
        path: '/reset-password',
        lazy: page(async () => (await import('./pages/PasswordPages')).ResetPasswordPage),
      },
      {
        path: '/legal/:kind',
        lazy: page(async () => (await import('./pages/LegalPage')).LegalPage),
      },
      { path: '*', element: b(<NotFoundPage />) },
    ],
  },
]);

// GSAP motion: loaded after first render, never for reduced motion (packages/ui/src/motion.ts).
preloadMotion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

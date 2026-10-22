import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import './site.css';
import { initI18n } from '@dop/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import ar from '../../../packages/i18n/locales/ar/site.json';
import en from '../../../packages/i18n/locales/en/site.json';
import { Layout } from './components/Layout';
import { RouteBoundary } from './components/RouteBoundary';
import { initialLanguage } from './lib/lang';
import { ConfirmEmailPage } from './pages/ConfirmEmailPage';
import { ContactPage } from './pages/ContactPage';
import { HomePage } from './pages/HomePage';
import { LegalPage } from './pages/LegalPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import { PricingPage } from './pages/PricingPage';
import { SignInPage } from './pages/SignInPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

// Marketing and sign-in site on www.{domain} (TRD §16.7). Venues are onboarded by the platform team; there is no
// self-signup. Arabic first unless the visitor chose English.
initI18n('site', { ar, en }, initialLanguage());

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnReconnect: true, retry: 2 } } });

const b = (el: ReactNode) => <RouteBoundary>{el}</RouteBoundary>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: b(<NotFoundPage />),
    children: [
      { path: '/', element: b(<HomePage />) },
      { path: '/pricing', element: b(<PricingPage />) },
      { path: '/contact', element: b(<ContactPage />) },
      { path: '/verify-email', element: b(<VerifyEmailPage />) },
      { path: '/confirm-email', element: b(<ConfirmEmailPage />) },
      { path: '/sign-in', element: b(<SignInPage />) },
      { path: '/forgot-password', element: b(<ForgotPasswordPage />) },
      { path: '/reset-password', element: b(<ResetPasswordPage />) },
      { path: '/legal/:kind', element: b(<LegalPage />) },
      { path: '*', element: b(<NotFoundPage />) },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

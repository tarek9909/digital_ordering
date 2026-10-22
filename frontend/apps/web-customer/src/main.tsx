import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import './customer.css';
import { preloadMotion } from '@dop/ui';
import { pickLocale } from '@dop/client-sdk';
import { initI18n } from '@dop/i18n';
import ar from '@dop/i18n/locales/ar/customer.json';
import en from '@dop/i18n/locales/en/customer.json';
import { ErrorBoundary } from '@dop/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { registerWorker } from './lib/push';
import { Router } from './lib/router';
import { TicketPage } from './pages/TicketPage';

// Only the ticket page is in the initial chunk; the other screens load on demand (TR-FE-05).
const VenuePage = lazy(() => import('./pages/VenuePage').then((m) => ({ default: m.VenuePage })));
const MyTicketsPage = lazy(() => import('./pages/MyTicketsPage').then((m) => ({ default: m.MyTicketsPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));

// Customer app on t.{domain} (TRD §16.2). Language starts from the browser and switches to the venue's
// languages once the ticket loads (TR-L10N-02).
initI18n('customer', { ar, en }, pickLocale(['ar', 'en']));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnReconnect: true, retry: 2, staleTime: 5_000 } } });

const fallback = (
  <div className="p-6 text-center text-lg" role="alert">
    Something went wrong. Please reload the page. · حدث خطأ. يرجى إعادة تحميل الصفحة.
  </div>
);

const withBoundary = (el: React.ReactNode) => (
  <ErrorBoundary fallback={fallback}>
    <Suspense fallback={null}>{el}</Suspense>
  </ErrorBoundary>
);

const routes = [
  { path: '/v/:venueCode', element: withBoundary(<VenuePage />) },
  { path: '/tickets', element: withBoundary(<MyTicketsPage />) },
  { path: '/privacy', element: withBoundary(<PrivacyPage />) },
  { path: '/:token', element: withBoundary(<TicketPage />) },
  { path: '/', element: withBoundary(<MyTicketsPage />) },
];

void registerWorker();

// GSAP motion: loaded after first render, never for reduced motion (packages/ui/src/motion.ts).
preloadMotion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router routes={routes} />
    </QueryClientProvider>
  </StrictMode>,
);

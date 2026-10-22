import '@dop/ui/tokens.css';
import '@dop/ui/ember.css';
import './display.css';
import { preloadMotion } from '@dop/ui';
import { pickLocale } from '@dop/client-sdk';
import { initI18n, useTranslation } from '@dop/i18n';
import { ErrorBoundary } from '@dop/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import ar from '../../../packages/i18n/locales/ar/display.json';
import en from '../../../packages/i18n/locales/en/display.json';
import { DisplayRoot } from './DisplayRoot';

// The UI language follows the display settings once the board loads (first announcement language, else Arabic).
initI18n('display', { ar, en }, pickLocale(['ar', 'en']));
document.documentElement.style.colorScheme = 'light';
document.documentElement.style.background = '#ffffff';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true, retry: 2 } },
});

function Fallback() {
  const { t } = useTranslation();
  return <main className="flex min-h-dvh items-center justify-center bg-surface p-8 text-center text-[4vmin] text-ink">{t('common:somethingWrong')}</main>;
}

// GSAP motion: loaded after first render, never for reduced motion (packages/ui/src/motion.ts).
preloadMotion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/display">
        <ErrorBoundary fallback={<Fallback />}>
          <Routes>
            <Route path="*" element={<DisplayRoot />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

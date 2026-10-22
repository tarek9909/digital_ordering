import '@dop/ui/tokens.css';
import { initI18n } from '@dop/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import ar from '../../../packages/i18n/locales/ar/staff.json';
import en from '../../../packages/i18n/locales/en/staff.json';
import { App } from './App';
import { storedLang } from './lib/lang';

initI18n('staff', { ar, en }, storedLang());

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true, retry: 2 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/staff">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

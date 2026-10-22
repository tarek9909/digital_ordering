import { useTranslation } from '@dop/i18n';
import { ErrorBoundary } from '@dop/ui';
import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { BoardPage } from './board/BoardPage';
import { Notice } from './components/Notice';
import { DevicePage } from './pages/DevicePage';
import { SignInPage } from './pages/SignInPage';

function Guard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <ErrorBoundary fallback={<Notice title={t('common:somethingWrong')} />}>{children}</ErrorBoundary>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Guard><BoardPage /></Guard>} />
      <Route path="/kitchen" element={<Guard><BoardPage kitchen /></Guard>} />
      <Route path="/device" element={<Guard><DevicePage /></Guard>} />
      <Route path="/:staffKey" element={<Guard><SignInPage /></Guard>} />
    </Routes>
  );
}

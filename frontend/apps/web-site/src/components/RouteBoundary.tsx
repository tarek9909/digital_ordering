import { useTranslation } from '@dop/i18n';
import { ErrorBoundary } from '@dop/ui';
import type { ReactNode } from 'react';

/** Error boundary per route (TR-FE-04). */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      fallback={
        <div role="alert" className="p-6 text-center text-lg">
          {t('common:somethingWrong')}
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

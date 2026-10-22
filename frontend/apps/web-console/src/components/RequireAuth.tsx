import { ApiError } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import { Spinner } from '@dop/ui';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../lib/me';
import { ErrorNote } from './common';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useMe();
  const loc = useLocation();
  if (me.isPending)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label={t('common:loading')} />
      </div>
    );
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" replace state={{ from: loc.pathname + loc.search }} />;
  if (me.error) return <ErrorNote error={me.error} />;
  return <>{children}</>;
}

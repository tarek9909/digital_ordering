import { ApiError } from '@dop/client-sdk';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../lib/me';
import { ErrorNote, Loading } from './common';

/** Signed-in area: no session (401) → sign-in, remembering where the user wanted to go. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isPending) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" replace state={{ from: loc.pathname + loc.search }} />;
  if (me.error) return <ErrorNote error={me.error} />;
  // Signed in on this host but not a member of this tenant.
  if (!me.data.currentRole && !me.data.support) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

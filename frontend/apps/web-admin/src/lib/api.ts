import { ApiError, createApi } from '@dop/client-sdk';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

// API clients for the tenant admin (TR-FE-03). A 401 UNAUTHENTICATED anywhere sends the user back to sign-in;
// public screens (sign-in, handoff, invitation) never redirect.

export const BASENAME = '/admin';
export const api = createApi({ base: '/api/admin/v1' });
export const authApi = createApi({ base: '/api/auth/v1' });
/** Only used to obtain the CSRF token of a support session (the staff board snapshot carries it). */
export const staffApi = createApi({ base: '/api/staff/v1' });

export const PUBLIC_PATHS = ['/sign-in', '/handoff', '/invitation', '/support-handoff'];
/** Mandatory two-factor enrolment screen (TR-AUTH-11). */
export const MFA_PATH = '/two-factor';

/** `path` is relative to the router basename. */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function routerPath(pathname: string): string {
  return pathname.startsWith(BASENAME) ? pathname.slice(BASENAME.length) || '/' : pathname;
}

function onError(err: unknown) {
  if (typeof window === 'undefined' || !(err instanceof ApiError)) return;
  const path = routerPath(window.location.pathname);
  if (err.code === 'UNAUTHENTICATED' && !isPublicPath(path)) {
    window.location.assign(`${BASENAME}/sign-in`);
  }
  // Multi-venue tenants require two-factor sign-in for owners and managers (TR-AUTH-11).
  if (err.code === 'MFA_REQUIRED' && path !== MFA_PATH && !isPublicPath(path)) {
    window.location.assign(`${BASENAME}${MFA_PATH}`);
  }
}

export function createQueryClient() {
  return new QueryClient({
    // The /me query is handled by RequireAuth, which keeps the page the user wanted.
    queryCache: new QueryCache({ onError: (e, query) => query.queryKey[0] !== 'me' && onError(e) }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        // Client errors (4xx) will not change on retry.
        retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
      },
    },
  });
}

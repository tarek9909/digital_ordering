import { ApiError, createApi } from '@dop/client-sdk';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

// API clients for the console (TR-FE-03). We do not pass onUnauthenticated: MFA_REQUIRED is also HTTP 401 and
// must open the fresh-MFA prompt instead of signing out (TR-FE-23). Only UNAUTHENTICATED redirects.

export const authApi = createApi({ base: '/api/auth/v1' });
export const api = createApi({ base: '/api/console/v1' });

export const PUBLIC_PATHS = ['/sign-in', '/accept'];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function onError(err: unknown) {
  if (typeof window === 'undefined') return;
  if (err instanceof ApiError && err.code === 'UNAUTHENTICATED' && !isPublicPath(window.location.pathname)) {
    window.location.assign('/sign-in');
  }
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
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

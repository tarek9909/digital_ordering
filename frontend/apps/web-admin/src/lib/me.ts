import { ApiError, setCsrfToken } from '@dop/client-sdk';
import { useQuery } from '@tanstack/react-query';
import type { ViewerRole } from './access';
import { api, authApi, staffApi } from './api';
import { isSupportMode, setSupportMode } from './support';
import type { Me, TenantInfo } from './types';

export const meKey = ['me'] as const;
export const tenantKey = ['tenant'] as const;

/** Identity for a support agent: no user account; the session is proven by a support-only API call. */
async function supportMe(): Promise<Me> {
  await api.get('/support-sessions');
  let csrfToken = '';
  try {
    // The support session's CSRF token is delivered with the staff board snapshot (TR-AUTH-02, TR-AUTH-12).
    csrfToken = (await staffApi.get<{ csrfToken: string }>('/board')).csrfToken;
  } catch {
    // Read-only without a token; writes then fail with CSRF_FAILED and say so.
  }
  setCsrfToken(csrfToken);
  return {
    user: { id: '', email: '', name: '', locale: 'ar', emailVerified: true, mfaEnrolled: true },
    memberships: [],
    currentTenantId: null,
    currentRole: null,
    csrfToken,
    support: true,
  };
}

/** What GET /me returns for a platform agent inside an approved support session (no user account). */
interface SupportMeResponse {
  support: { agentName: string; supportSessionId: string };
  currentTenantId: string;
  currentRole: 'support';
  csrfToken: string;
}

const isSupportResponse = (r: unknown): r is SupportMeResponse => typeof (r as SupportMeResponse | null)?.support === 'object' && (r as SupportMeResponse).support !== null;

/**
 * One client identity for both response kinds (AS01): a support response becomes a `Me` with `support: true`, a
 * placeholder user and no member role, so every screen treats it as a support agent and never as a user.
 */
export function normalizeMe(r: Me | SupportMeResponse): Me {
  if (!isSupportResponse(r)) return r;
  return {
    user: { id: '', email: '', name: r.support.agentName, locale: 'ar', emailVerified: true, mfaEnrolled: true },
    memberships: [],
    currentTenantId: r.currentTenantId,
    currentRole: null,
    csrfToken: r.csrfToken,
    support: true,
    agentName: r.support.agentName,
    supportSessionId: r.support.supportSessionId,
  };
}

/** GET /me; sets the CSRF token before any write (TR-AUTH-02). Falls back to support mode after a handoff. */
export async function fetchMe(): Promise<Me> {
  try {
    const me = normalizeMe(await authApi.get<Me | SupportMeResponse>('/me'));
    setCsrfToken(me.csrfToken);
    setSupportMode(me.support === true);
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && isSupportMode()) {
      try {
        return await supportMe();
      } catch (inner) {
        setSupportMode(false);
        throw inner;
      }
    }
    throw e;
  }
}

export const useMe = () => useQuery({ queryKey: meKey, queryFn: fetchMe, retry: false, staleTime: 60_000 });

/** Role of whoever uses the app; null while loading. */
export function viewerRole(me: Me | undefined): ViewerRole | null {
  if (!me) return null;
  return me.support ? 'support' : me.currentRole;
}

export function useRole(): ViewerRole | null {
  return viewerRole(useMe().data);
}

export const useIsSupport = () => useMe().data?.support === true;

/**
 * GET /tenant needs a user session (support agents cannot read it, TR-AUTH-10). It waits for the identity, so a
 * support agent's first render never requests it before /me says who is signed in (AS01).
 */
export function useTenant() {
  const me = useMe();
  return useQuery({ queryKey: tenantKey, queryFn: () => api.get<TenantInfo>('/tenant'), staleTime: 60_000, enabled: me.isSuccess && me.data.support !== true });
}

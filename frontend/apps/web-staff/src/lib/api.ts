import { ApiError, createApi } from '@dop/client-sdk';
import type { TFunction } from 'i18next';
import { currentMember, markNamedStaff, clearMember, requestPin, touchCurrentMember, useMember } from './member';
import { beforeWrite, isPinRequired, MEMBER_HEADER, PIN_REQUIRED_DETAIL } from './memberSession';
import { useStaff } from './store';

// Staff API client (TRD §12.5). Owners and managers open the board with their own session and `?venueId=`
// (FR-STF-17); that id is kept for the tab and added to every request.

const VENUE_KEY = 'dop.staff.venueId';

function readVenueId(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('venueId');
    if (fromUrl) sessionStorage.setItem(VENUE_KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(VENUE_KEY);
  } catch {
    return null;
  }
}

export const venueId = typeof window === 'undefined' ? null : readVenueId();

/** Adds `venueId` to a path when the board was opened by an owner or manager. */
export const vq = (path: string) => (venueId ? `${path}${path.includes('?') ? '&' : '?'}venueId=${encodeURIComponent(venueId)}` : path);

const raw = createApi({
  base: '/api/staff/v1',
  onUnauthenticated: () => useStaff.getState().setSignedOut(true),
  onNetworkError: () => useStaff.getState().markStale(),
});

const memberHeader = (): Record<string, string> | undefined => {
  const m = currentMember();
  return m ? { [MEMBER_HEADER]: m.token } : undefined;
};

/**
 * Named staff (FR-ACC-07, TR-AUTH-12): every write carries the personal-PIN token when a person is signed in.
 * A "Enter your personal PIN" refusal opens the PIN pad and retries the action once; after that first refusal
 * the board asks before each write whenever nobody is signed in.
 */
async function withMember<T>(send: (headers: Record<string, string> | undefined) => Promise<T>): Promise<T> {
  const m = useMember.getState();
  if (beforeWrite(m.namedStaff, currentMember(), Date.now()) === 'ask' && !(await requestPin())) {
    throw new ApiError(403, 'FORBIDDEN', null, PIN_REQUIRED_DETAIL);
  }
  const once = async () => {
    const h = memberHeader();
    const r = await send(h);
    if (h) touchCurrentMember();
    return r;
  };
  try {
    return await once();
  } catch (e) {
    if (!isPinRequired(e)) throw e;
    clearMember();
    markNamedStaff();
    if (!(await requestPin())) throw e;
    return once();
  }
}

/** Device-level calls (rename, mode, sign out) are not ticket actions and never ask for a personal PIN. */
export const deviceApi = raw;

export const api = {
  ...raw,
  post: <T>(path: string, body?: unknown) => withMember((headers) => raw.call<T>('POST', path, { body, headers })),
  put: <T>(path: string, body?: unknown) => withMember((headers) => raw.call<T>('PUT', path, { body, headers })),
  patch: <T>(path: string, body?: unknown) => withMember((headers) => raw.call<T>('PATCH', path, { body, headers })),
  delete: <T>(path: string, body?: unknown) => withMember((headers) => raw.call<T>('DELETE', path, { body, headers })),
};

/** Sign-in and the personal-PIN unlock use their own client: a wrong PIN (401) must not flip the board to "signed out". */
export const signInApi = createApi({ base: '/api/staff/v1' });

export function errorText(t: TFunction, e: unknown): string {
  if (isPinRequired(e)) return t('member.required');
  const code = e instanceof ApiError ? e.code : 'default';
  return t(`errors.${code}`, { defaultValue: t('common:errors.default') });
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (code === undefined || e.code === code);

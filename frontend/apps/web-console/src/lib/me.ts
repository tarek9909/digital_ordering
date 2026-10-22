import { setCsrfToken } from '@dop/client-sdk';
import { useQuery } from '@tanstack/react-query';
import { authApi } from './api';
import type { Me } from './types';

export const meKey = ['me'] as const;

/** GET /me; sets the CSRF token before any write (TR-AUTH-02). */
export async function fetchMe(): Promise<Me> {
  const me = await authApi.get<Me>('/me');
  setCsrfToken(me.csrfToken);
  return me;
}

export const useMe = () => useQuery({ queryKey: meKey, queryFn: fetchMe, retry: false, staleTime: 60_000 });

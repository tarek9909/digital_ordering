import { ApiError, createApi } from '@dop/client-sdk';
import type { TFunction } from 'i18next';

export const api = createApi({ base: '/api/display/v1' });

export const isUnauthenticated = (e: unknown) => e instanceof ApiError && e.status === 401;

export function errorText(t: TFunction, e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'default';
  return t(`errors.${code}`, { defaultValue: t('common:errors.default') });
}

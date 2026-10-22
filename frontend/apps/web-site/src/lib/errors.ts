import { ApiError } from '@dop/client-sdk';
import type { TFunction } from 'i18next';

/** Error code → translated text, with app-level codes and a default (common:errors.*, site errors.*). */
export function errorText(t: TFunction, e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'default';
  return t([`common:errors.${code}`, `errors.${code}`, 'common:errors.default']);
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (code === undefined || e.code === code);

/** Translates a field message: zod issue codes (client) or short server messages like "taken". */
export function fieldMessage(t: TFunction, err: { type?: string | number; message?: string } | undefined): string | undefined {
  if (!err) return undefined;
  if (err.type === 'server') return t([`fieldErrors.${err.message ?? ''}`, 'fieldErrors.invalid']);
  return t([`validation.${String(err.type ?? '')}`, 'validation.invalid']);
}

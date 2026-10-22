import { ApiError } from '@dop/client-sdk';
import type { TFunction } from 'i18next';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

/** Error code → translated text (common namespace, then admin namespace, then a default). */
export function errorText(t: TFunction, e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'default';
  return t([`common:errors.${code}`, `admin:errors.${code}`, 'common:errors.default']);
}

/** Maps server field errors onto form fields (TR-FE-21). Returns true when at least one field was mapped. */
export function applyFieldErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, fields: readonly string[]): boolean {
  if (!(e instanceof ApiError)) return false;
  let mapped = false;
  for (const [path, message] of Object.entries(e.fieldErrors())) {
    if (fields.includes(path)) {
      setError(path as Path<T>, { type: 'server', message });
      mapped = true;
    }
  }
  return mapped;
}

export const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

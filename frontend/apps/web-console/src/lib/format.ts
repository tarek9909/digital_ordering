import { formatDateTime } from '@dop/client-sdk';

export const fmtDate = (iso: string | null | undefined, locale: string) => (iso ? formatDateTime(iso, locale) : '—');

/** Date only (no time), in the reader's language. */
export const fmtDay = (iso: string | null | undefined, locale: string) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/** Seconds → "m:ss" (null → "—"). */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

/** `datetime-local` value → ISO string for the API (empty → undefined). */
export function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Comma/space/newline separated IDs → unique list. */
export const parseIdList = (s: string) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];

export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** JSON columns may arrive parsed or as text depending on the driver. */
export function jsonValue<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return (safeJson(v) as T | null) ?? fallback;
  return v as T;
}

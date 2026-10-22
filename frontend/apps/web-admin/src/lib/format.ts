/** Seconds → "m:ss" (or "h:mm:ss"); null → em dash. Western digits (TR-L10N-01). */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Seconds left until `iso`, never negative. */
export const secondsLeft = (iso: string, now = Date.now()) => Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));

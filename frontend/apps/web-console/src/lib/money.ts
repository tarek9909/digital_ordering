// Money in minor units (cents, fils…) shown and typed as major units with two decimals (FR-SA-10).

/** 1999 → "19.99"; negative values keep the sign. */
export function minorToMajor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "19.99" → 1999, "20" → 2000, "0.5" → 50. Returns null for anything that is not a non-negative amount with ≤ 2 decimals. */
export function majorToMinor(text: string): number | null {
  const s = text.trim();
  const m = /^(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  const v = whole * 100 + frac;
  return Number.isSafeInteger(v) ? v : null;
}

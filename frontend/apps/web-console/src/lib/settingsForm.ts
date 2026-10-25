// Platform settings as forms (appendix 30.4): each known setting gets a fitting input; any other setting is laid out
// from the shape of its value (numbers, switches, text, lists, groups), so nobody has to edit JSON.

export type FieldKind =
  | { kind: 'number'; unit?: 'days' | 'minutes' | 'seconds' | 'perSecond' | 'alerts'; min?: number; max?: number }
  | { kind: 'time' }
  | { kind: 'datetime' }
  | { kind: 'timezone' }
  | { kind: 'currency' }
  | { kind: 'chime' }
  | { kind: 'languages'; min?: number }
  | { kind: 'waitMode' }
  | { kind: 'perLanguage' }
  | { kind: 'secondsList'; min: number; max: number; count: number }
  | { kind: 'addressList' };

const days = (min = 0, max?: number): FieldKind => ({ kind: 'number', unit: 'days', min, max });

/** Inputs for known setting paths (setting key, then the path inside its value). */
export const FIELD_KINDS: Record<string, FieldKind> = {
  'tenant.defaults.timeZone': { kind: 'timezone' },
  'tenant.defaults.locales': { kind: 'languages', min: 1 },
  'tenant.defaults.currency': { kind: 'currency' },
  'tenant.defaults.resetTime': { kind: 'time' },
  'tenant.defaults.autoCloseTime': { kind: 'time' },
  'tenant.defaults.wait.mode': { kind: 'waitMode' },
  'tenant.defaults.wait.defaultMinutes': { kind: 'number', unit: 'minutes', min: 0, max: 240 },
  'tenant.defaults.alerts.repeatOffsetsSec': { kind: 'secondsList', min: 30, max: 1800, count: 5 },
  'tenant.defaults.alerts.maxAutoAlerts': { kind: 'number', unit: 'alerts', min: 1, max: 6 },
  'tenant.defaults.chime': { kind: 'chime' },
  'trial.days': days(1, 90),
  'billing.retryDays': days(),
  'billing.graceDays': days(),
  'billing.suspendedToCancelDays': days(),
  'fairness.perTenantPerSecond.push': { kind: 'number', unit: 'perSecond', min: 0 },
  'fairness.perTenantPerSecond.webhook': { kind: 'number', unit: 'perSecond', min: 0 },
  'fairness.perTenantPerSecond.email': { kind: 'number', unit: 'perSecond', min: 0 },
  'maintenance.message': { kind: 'perLanguage' },
  'maintenance.until': { kind: 'datetime' },
  'retention.ticketDays': days(1),
  'retention.closedTenantDays': days(1),
  'support.defaultMinutes': { kind: 'number', unit: 'minutes', min: 1 },
  'console.ipAllowList': { kind: 'addressList' },
  'customer.supportedLanguages': { kind: 'languages', min: 1 },
  'push.ttlSeconds': { kind: 'number', unit: 'seconds', min: 0 },
};

/** Sections of the Settings page; settings not listed land in "Other". `site.*` is edited on the Website page. */
export const SETTING_GROUPS = [
  { id: 'newTenants', keys: ['tenant.defaults'] },
  { id: 'billing', keys: ['billing.retryDays', 'billing.graceDays', 'billing.suspendedToCancelDays'] },
  { id: 'maintenance', keys: ['maintenance'] },
  { id: 'delivery', keys: ['push.ttlSeconds', 'fairness.perTenantPerSecond', 'customer.supportedLanguages'] },
  { id: 'data', keys: ['support.defaultMinutes', 'retention.ticketDays', 'retention.closedTenantDays'] },
] as const;

/** Trial, new-tenant defaults, overdue-billing timings and the console network allow-list: tenants are set up by hand and the platform has no self-serve billing, so they are not edited here. */
const HIDDEN_PREFIXES = ['site.', 'tenant.defaults', 'trial.days', 'billing.', 'console.ipAllowList'];

export function groupSettings<T extends { key: string }>(rows: T[]) {
  const visible = rows.filter((r) => !HIDDEN_PREFIXES.some((p) => r.key.startsWith(p)));
  const known = new Set<string>(SETTING_GROUPS.flatMap((g) => g.keys));
  const groups = SETTING_GROUPS.map((g) => ({ id: g.id as string, rows: g.keys.map((k) => visible.find((r) => r.key === k)).filter((r): r is T => Boolean(r)) }));
  const other = visible.filter((r) => !known.has(r.key));
  if (other.length) groups.push({ id: 'other', rows: other });
  return groups.filter((g) => g.rows.length > 0);
}

/** i18n key for a setting path: dots become underscores so a group and its fields never collide. */
export const pathKey = (path: string) => path.replace(/\./g, '_');

export const humanize = (s: string) => {
  const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems found before saving, as setting paths → message keys (with values for the message). */
export type Problem = { path: string; message: string; values?: Record<string, unknown> };

/** Checks a setting value against the limits above (whole numbers in range, times, list sizes). */
export function checkSetting(key: string, value: unknown): Problem[] {
  const out: Problem[] = [];
  const walk = (path: string, v: unknown) => {
    const spec = FIELD_KINDS[path];
    if (spec?.kind === 'number' || (!spec && typeof v === 'number')) {
      const n = v as number;
      const min = spec?.kind === 'number' ? spec.min : undefined;
      const max = spec?.kind === 'number' ? spec.max : undefined;
      if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) out.push({ path, message: 'settingsForm.invalid.whole' });
      else if ((min !== undefined && n < min) || (max !== undefined && n > max))
        out.push({ path, message: max === undefined ? 'settingsForm.invalid.atLeast' : 'settingsForm.invalid.range', values: { min, max } });
      return;
    }
    if (spec?.kind === 'time') {
      if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) out.push({ path, message: 'settingsForm.invalid.time' });
      return;
    }
    if (spec?.kind === 'languages' || spec?.kind === 'currency' || spec?.kind === 'timezone') {
      if (spec.kind === 'languages' && (!Array.isArray(v) || v.length < (spec.min ?? 0))) out.push({ path, message: 'settingsForm.invalid.oneLanguage' });
      if (spec.kind === 'currency' && (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v))) out.push({ path, message: 'settingsForm.invalid.currency' });
      if (spec.kind === 'timezone' && (typeof v !== 'string' || !v)) out.push({ path, message: 'settingsForm.invalid.required' });
      return;
    }
    if (isPlainObject(v) && spec?.kind !== 'perLanguage') for (const [k, x] of Object.entries(v)) walk(`${path}.${k}`, x);
  };
  walk(key, value);
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → `datetime-local` value in the browser's zone (null → ''). */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Same value, compared by content (draft vs saved). */
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Value with `path` (inside the setting) replaced. */
export function setPath(value: unknown, path: string[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  const base = isPlainObject(value) ? value : {};
  return { ...base, [head!]: setPath(base[head!], rest, next) };
}

/** Time zones the browser knows, with the current one kept even if it is not in the list. */
export function timeZones(current: string): string[] {
  const list = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Beirut', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'UTC'];
  return list.includes(current) || !current ? list : [current, ...list];
}

export const CURRENCIES = ['USD', 'LBP', 'SAR', 'AED', 'QAR', 'KWD', 'EUR'];

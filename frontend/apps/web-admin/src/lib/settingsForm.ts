import { venueMessagesSchema, venueSettingsSchema, type VenueMessages, type VenueSettings } from '@dop/contracts';

// Venue settings form ↔ settings JSON (appendix 30.5). The form keeps text inputs as strings so the user can type
// freely; on submit the values become the settings JSON and are validated with the SAME `venueSettingsSchema` as
// the API (TR-FE-21). Settings the form does not show are kept from the base.

export interface SettingsForm {
  startStatus: 'received' | 'preparing';
  showReceivedColumn: boolean;
  /** off / manual / calculated from recent orders ("auto", R2 TR-ALG-09). */
  waitMode: 'off' | 'manual' | 'auto';
  defaultMinutes: string;
  rangeStart: string;
  rangeEnd: string;
  skipNumbers: string;
  repeatOffsets: string;
  maxAutoAlerts: string;
  liveLoopSeconds: string;
  /** Chime from the platform library (FR-ADM-08, W11). */
  chime: string;
  checkCode: 'off' | 'optional' | 'mandatory';
  /** How a customer claims an order from the venue page (FR-ADM-06). */
  claimsMode: 'off' | 'code' | 'staff_approval';
  prefixesEnabled: boolean;
  reviewLinkUrl: string;
  showPoweredBy: boolean;
  soundOnApiTicket: boolean;
}

export type SettingsField = keyof SettingsForm;

/** Numbers 13–19 are often skipped in English-speaking markets (suggestion only). */
export const ENGLISH_SKIP_SUGGESTION = [13, 14, 15, 16, 17, 18, 19];

const MAX_LIST = 500;

/** "13, 14-19 ٢٠" → numbers; ranges expand; a bad token becomes NaN so validation flags it. */
export function parseNumberList(text: string): number[] {
  const out: number[] = [];
  const normalised = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[–—]/g, '-');
  for (const token of normalised.split(/[\s,،;]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b < a || b - a > MAX_LIST) {
        out.push(Number.NaN);
        continue;
      }
      for (let n = a; n <= b && out.length <= MAX_LIST; n++) out.push(n);
    } else if (/^\d+$/.test(token)) out.push(Number(token));
    else out.push(Number.NaN);
  }
  return out;
}

/** Compact text for a number list: consecutive runs become ranges ("13-19, 42"). */
export function formatNumberList(nums: readonly number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

const toInt = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : Number.NaN);

export function settingsToForm(s: VenueSettings): SettingsForm {
  return {
    startStatus: s.ticketFlow.startStatus,
    showReceivedColumn: s.ticketFlow.showReceivedColumn,
    waitMode: s.wait.mode,
    defaultMinutes: String(s.wait.defaultMinutes),
    rangeStart: String(s.numbering.rangeStart),
    rangeEnd: String(s.numbering.rangeEnd),
    skipNumbers: formatNumberList(s.numbering.skipNumbers),
    repeatOffsets: s.alerts.repeatOffsetsSec.join(', '),
    maxAutoAlerts: String(s.alerts.maxAutoAlerts),
    liveLoopSeconds: String(s.alerts.liveLoopSeconds),
    chime: s.alerts.chime,
    checkCode: s.checkCode,
    claimsMode: s.claims.mode,
    prefixesEnabled: s.numbering.prefixesEnabled,
    reviewLinkUrl: s.customer.reviewLinkUrl ?? '',
    showPoweredBy: s.customer.showPoweredBy,
    soundOnApiTicket: s.staff.soundOnApiTicket,
  };
}

/** Form → settings JSON (not yet validated). */
export function formToSettings(f: SettingsForm, base: VenueSettings): VenueSettings {
  return {
    ...base,
    ticketFlow: { startStatus: f.startStatus, showReceivedColumn: f.showReceivedColumn },
    // "auto" uses the default minutes until enough recent orders exist (TR-ALG-09).
    wait: { mode: f.waitMode, defaultMinutes: toInt(f.defaultMinutes) },
    numbering: {
      ...base.numbering,
      rangeStart: toInt(f.rangeStart),
      rangeEnd: toInt(f.rangeEnd),
      prefixesEnabled: f.prefixesEnabled,
      skipNumbers: [...new Set(parseNumberList(f.skipNumbers))],
    },
    checkCode: f.checkCode,
    claims: { ...base.claims, mode: f.claimsMode },
    staff: { ...base.staff, soundOnApiTicket: f.soundOnApiTicket },
    customer: { ...base.customer, showPoweredBy: f.showPoweredBy, reviewLinkUrl: f.reviewLinkUrl.trim() || null },
    alerts: {
      ...base.alerts,
      repeatOffsetsSec: parseNumberList(f.repeatOffsets),
      maxAutoAlerts: toInt(f.maxAutoAlerts),
      liveLoopSeconds: toInt(f.liveLoopSeconds),
      chime: f.chime,
    },
  };
}

/** Schema issue path → form field. */
export function fieldForPath(path: ReadonlyArray<string | number>): SettingsField | null {
  const [group, key] = path;
  if (group === 'ticketFlow') return key === 'showReceivedColumn' ? 'showReceivedColumn' : 'startStatus';
  if (group === 'wait') return 'defaultMinutes';
  if (group === 'numbering') {
    if (key === 'rangeStart') return 'rangeStart';
    if (key === 'skipNumbers') return 'skipNumbers';
    if (key === 'prefixesEnabled') return 'prefixesEnabled';
    return 'rangeEnd'; // rangeEnd and the "end > start" refinement
  }
  if (group === 'alerts') {
    if (key === 'repeatOffsetsSec') return 'repeatOffsets';
    if (key === 'maxAutoAlerts') return 'maxAutoAlerts';
    if (key === 'liveLoopSeconds') return 'liveLoopSeconds';
    if (key === 'chime') return 'chime';
  }
  if (group === 'checkCode') return 'checkCode';
  if (group === 'claims') return 'claimsMode';
  if (group === 'customer') return key === 'showPoweredBy' ? 'showPoweredBy' : 'reviewLinkUrl';
  if (group === 'staff') return 'soundOnApiTicket';
  return null;
}

export type SettingsResult = { ok: true; settings: VenueSettings } | { ok: false; errors: Partial<Record<SettingsField, string>> };

export function validateSettingsForm(f: SettingsForm, base: VenueSettings): SettingsResult {
  const r = venueSettingsSchema.safeParse(formToSettings(f, base));
  if (r.success) return { ok: true, settings: r.data };
  const errors: Partial<Record<SettingsField, string>> = {};
  for (const issue of r.error.issues) {
    const field = fieldForPath(issue.path);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

// ---- messages per language

export const MESSAGE_KEYS = ['welcome', 'collection', 'cancelled', 'afterCollection', 'websiteUrl'] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];
export type MessagesForm = Record<string, Record<MessageKey, string>>;

export function messagesToForm(m: VenueMessages, locales: readonly string[]): MessagesForm {
  return Object.fromEntries(locales.map((l) => [l, Object.fromEntries(MESSAGE_KEYS.map((k) => [k, m[l]?.[k] ?? ''])) as Record<MessageKey, string>]));
}

/** Empty texts are left out, so the customer page falls back to the default wording. */
export function formToMessages(f: MessagesForm): VenueMessages {
  const out: VenueMessages = {};
  for (const [locale, msgs] of Object.entries(f)) {
    const entry: Partial<Record<MessageKey, string>> = {};
    for (const k of MESSAGE_KEYS) {
      const v = msgs[k].trim();
      if (v) entry[k] = v;
    }
    out[locale] = entry;
  }
  return out;
}

export type MessagesResult = { ok: true; messages: VenueMessages } | { ok: false; errors: Record<string, string> };

/** Errors keyed "<locale>.<key>", the same paths the API uses. */
export function validateMessagesForm(f: MessagesForm): MessagesResult {
  const r = venueMessagesSchema.safeParse(formToMessages(f));
  if (r.success) return { ok: true, messages: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.slice(0, 2).join('.');
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

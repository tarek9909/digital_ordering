import { displayPatch, type DisplaySettings } from '@dop/contracts';
import type { DisplayItem } from './types';

// Display edit form ↔ PATCH /displays/:id body (R1.1: counter filter, announcement languages, quiet hours, promo;
// FR-DSP-07). Validated with the same `displayPatch` schema as the API (TR-FE-21).

export const MAX_ANNOUNCE_LANGUAGES = 2;
export const MAX_QUIET_HOURS = 3;

export interface QuietHour {
  from: string;
  to: string;
}

export interface DisplayForm {
  name: string;
  /** true = the display shows every counter (counterIds null). */
  allCounters: boolean;
  counterIds: string[];
  announceEnabled: boolean;
  languages: string[];
  quietHours: QuietHour[];
  promoEnabled: boolean;
  promoText: Record<string, string>;
  promoImageUrl: string;
}

export function displayToForm(d: Pick<DisplayItem, 'name' | 'counterIds' | 'settings'>, locales: readonly string[]): DisplayForm {
  const s = d.settings;
  return {
    name: d.name,
    allCounters: d.counterIds === null || d.counterIds.length === 0,
    counterIds: d.counterIds ?? [],
    announceEnabled: s.announce.enabled,
    languages: [...s.announce.languages],
    quietHours: s.announce.quietHours.map((q) => ({ ...q })),
    promoEnabled: s.promo !== null,
    promoText: Object.fromEntries([...new Set([...locales, ...Object.keys(s.promo?.text ?? {})])].map((l) => [l, s.promo?.text[l] ?? ''])),
    promoImageUrl: s.promo?.imageUrl ?? '',
  };
}

export interface DisplayPatchBody {
  name: string;
  counterIds: string[] | null;
  settings: DisplaySettings;
}

/** Form → PATCH body (not yet validated). Settings the form does not show are kept from `base`. */
export function formToDisplayPatch(f: DisplayForm, base: DisplaySettings): DisplayPatchBody {
  const text: Record<string, string> = {};
  for (const [l, v] of Object.entries(f.promoText)) if (v.trim()) text[l] = v.trim();
  const image = f.promoImageUrl.trim();
  return {
    name: f.name.trim(),
    counterIds: f.allCounters || f.counterIds.length === 0 ? null : [...new Set(f.counterIds)],
    settings: {
      ...base,
      announce: { enabled: f.announceEnabled, languages: [...new Set(f.languages)], quietHours: f.quietHours.map((q) => ({ from: q.from, to: q.to })) },
      promo: f.promoEnabled ? { text, imageUrl: image || null } : null,
    },
  };
}

export type DisplayFormField = 'name' | 'counterIds' | 'languages' | 'quietHours' | 'promoText' | 'promoImageUrl';
export type DisplayFormResult = { ok: true; body: DisplayPatchBody } | { ok: false; errors: Partial<Record<DisplayFormField, string>> };

function fieldFor(path: ReadonlyArray<string | number>): DisplayFormField | null {
  const [a, b, c] = path;
  if (a === 'name') return 'name';
  if (a === 'counterIds') return 'counterIds';
  if (a === 'settings' && b === 'announce') return c === 'quietHours' ? 'quietHours' : 'languages';
  if (a === 'settings' && b === 'promo') return c === 'imageUrl' ? 'promoImageUrl' : 'promoText';
  return null;
}

export function validateDisplayForm(f: DisplayForm, base: DisplaySettings): DisplayFormResult {
  const body = formToDisplayPatch(f, base);
  const errors: Partial<Record<DisplayFormField, string>> = {};
  if (f.quietHours.some((q) => !q.from || !q.to || q.from === q.to)) errors.quietHours = 'invalid';
  if (body.settings.announce.languages.length > MAX_ANNOUNCE_LANGUAGES) errors.languages = 'tooMany';
  const r = displayPatch.safeParse(body);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const field = fieldFor(issue.path);
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body };
}

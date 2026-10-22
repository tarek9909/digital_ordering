import { planLimitsSchema, type PlanLimits } from '@dop/contracts';

// Plan limits JSON editor (FR-SA-10, appendix 30.3): every key required, whole numbers ≥ 0.

export const LIMIT_KEYS = ['maxVenues', 'maxCountersPerVenue', 'maxLanguages', 'maxDisplaysPerVenue', 'maxStaffDevicesPerVenue', 'maxApiKeysPerVenue', 'trialTicketsPerDay'] as const satisfies ReadonlyArray<keyof PlanLimits>;

export const DEFAULT_LIMITS: PlanLimits = {
  maxVenues: 1,
  maxCountersPerVenue: 1,
  maxLanguages: 2,
  maxDisplaysPerVenue: 1,
  maxStaffDevicesPerVenue: 3,
  maxApiKeysPerVenue: 0,
  trialTicketsPerDay: 100,
};

export type LimitsResult = { ok: true; value: PlanLimits } | { ok: false; error: 'syntax'; detail?: string } | { ok: false; error: 'shape'; keys: string[] };

export function parsePlanLimits(text: string): LimitsResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'syntax', detail: e instanceof Error ? e.message : undefined };
  }
  const r = planLimitsSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const keys = [...new Set(r.error.issues.map((i) => (i.path.length ? String(i.path[0]) : i.code === 'unrecognized_keys' ? i.keys.join(', ') : '')).filter(Boolean))];
  return { ok: false, error: 'shape', keys: keys.length ? keys : ['(root)'] };
}

/** Feature list: one per line or comma separated, trimmed, unique. */
export const parseFeatures = (text: string) => [...new Set(text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];

import { uuidSchema } from '@dop/contracts';
import { parseIdList } from './format';

// Announcement target builder (FR-SA-13): all tenants, a list of tenant IDs, or a list of plan codes.

export type TargetMode = 'all' | 'tenants' | 'plans';
export type AnnouncementTarget = { all: true } | { tenantIds: string[] } | { plans: string[] };
export type TargetResult = { ok: true; target: AnnouncementTarget } | { ok: false; error: 'empty' | 'invalidId'; detail?: string };

export function buildTarget(mode: TargetMode, ids: string, plans: readonly string[]): TargetResult {
  if (mode === 'all') return { ok: true, target: { all: true } };
  if (mode === 'plans') {
    const list = [...new Set(plans.map((p) => p.trim()).filter(Boolean))];
    return list.length ? { ok: true, target: { plans: list } } : { ok: false, error: 'empty' };
  }
  const list = [...new Set(parseIdList(ids).map((x) => x.toLowerCase()))];
  if (list.length === 0) return { ok: false, error: 'empty' };
  const bad = list.find((x) => !uuidSchema.safeParse(x).success);
  if (bad) return { ok: false, error: 'invalidId', detail: bad };
  return { ok: true, target: { tenantIds: list } };
}

/** Short human description of a stored target (list view). */
export function describeTarget(target: unknown): { kind: TargetMode; items: string[] } {
  const t = (typeof target === 'string' ? safeJson(target) : target) as { all?: boolean; tenantIds?: string[]; plans?: string[] } | null;
  if (t?.tenantIds) return { kind: 'tenants', items: t.tenantIds };
  if (t?.plans) return { kind: 'plans', items: t.plans };
  return { kind: 'all', items: [] };
}

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

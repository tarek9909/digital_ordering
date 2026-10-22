import { ApiError } from '@dop/client-sdk';
import type { ExcessItem } from './types';

// Plan downgrade blocked (EX-21, FR-BIL-10): the API lists what exceeds the target plan in problem.data.excess.

export const KNOWN_LIMITS = ['maxVenues', 'maxCountersPerVenue', 'maxLanguages', 'maxDisplaysPerVenue', 'maxStaffDevicesPerVenue', 'maxApiKeysPerVenue'] as const;

export interface ExcessLine {
  /** i18n key under admin:billing.excess */
  key: string;
  current: number;
  allowed: number;
  /** How many to remove. */
  count: number;
}

function isExcessItem(v: unknown): v is ExcessItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.limit === 'string' && typeof o.current === 'number' && typeof o.allowed === 'number';
}

/** Excess list from a PLAN_DOWNGRADE_BLOCKED error (empty for other errors or malformed data). */
export function excessFromError(e: unknown): ExcessItem[] {
  if (!(e instanceof ApiError) || e.code !== 'PLAN_DOWNGRADE_BLOCKED') return [];
  const data = e.problem?.data;
  const list = typeof data === 'object' && data !== null ? (data as { excess?: unknown }).excess : undefined;
  return Array.isArray(list) ? list.filter(isExcessItem) : [];
}

export function excessLines(items: readonly ExcessItem[]): ExcessLine[] {
  return items
    .filter((i) => i.current > i.allowed)
    .map((i) => ({
      key: (KNOWN_LIMITS as readonly string[]).includes(i.limit) ? `billing.excess.${i.limit}` : 'billing.excess.other',
      current: i.current,
      allowed: i.allowed,
      count: i.current - i.allowed,
    }));
}

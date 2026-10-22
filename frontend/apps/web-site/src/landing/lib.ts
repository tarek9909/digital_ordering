import type { SitePricing } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../lib/api';

/** A translated list (`returnObjects`), always an array. */
export function useList<T = string>(key: string): T[] {
  const { t } = useTranslation();
  const v = t(key, { returnObjects: true }) as unknown;
  return Array.isArray(v) ? (v as T[]) : [];
}

export interface SiteInfo {
  contact: { email: string | null; whatsapp: string | null; whatsappUrl: string | null };
  /** Absent from an older API; the site then keeps its built-in wording. */
  pricing?: SitePricing;
}

/** Public contact and packages wording set by super admins in the console (settings `site.contact`, `site.pricing`). */
export function useSiteInfo() {
  return useQuery({ queryKey: ['site-info'], queryFn: () => publicApi.get<SiteInfo>('/site'), staleTime: 5 * 60_000, retry: 1 });
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

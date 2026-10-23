import type { SiteLanding, SiteLandingSection, SitePricing } from '@dop/contracts';
import { useTranslation } from '@dop/i18n';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../lib/api';
import { applySiteCopy } from './content';

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
  landing?: SiteLanding;
}

/**
 * Public contact, packages wording and landing page content set by super admins in the console (settings
 * `site.contact`, `site.pricing`, `site.landing`). The landing text is laid over the translations as it arrives.
 */
export function useSiteInfo() {
  return useQuery({
    queryKey: ['site-info'],
    queryFn: async () => {
      const info = await publicApi.get<SiteInfo>('/site');
      applySiteCopy(info.landing?.copy);
      return info;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Whether the console hid a landing section. */
export function useHidden() {
  const hidden = useSiteInfo().data?.landing?.hidden ?? [];
  return (section: SiteLandingSection) => hidden.includes(section);
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

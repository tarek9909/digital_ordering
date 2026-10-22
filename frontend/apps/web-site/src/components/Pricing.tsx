import { formatMoney } from '@dop/client-sdk';
import { useTranslation } from '@dop/i18n';
import type { SitePricing } from '@dop/contracts';
import { Spinner } from '@dop/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useSiteInfo } from '../landing/lib';
import { publicApi, type PublicPlan, type PublicPlansResponse } from '../lib/api';
import { errorText } from '../lib/errors';
import { FormError } from './FormCard';

// Public prices from the plan catalogue (BRD §16, FR-BIL-02, W02): one card per public plan with its monthly price
// per venue, key limits and features. VAT is added at checkout. Super admins set each plan's site name, tagline and the
// one highlighted plan in the console (setting `site.pricing`).

/** Feature flags with a site translation; anything else is not shown. */
export const KNOWN_FEATURES = [
  'display_speech',
  'ratings',
  'reports_trends',
  'counters',
  'remove_powered_by',
  'api_access',
  'webhooks',
  'pos_connectors',
  'named_staff',
  'csv_export',
  'multi_venue',
  'combined_reports',
] as const;

/** Limits shown on the card when above zero, in this order. */
const SHOWN_LIMITS = ['maxVenues', 'maxCountersPerVenue', 'maxLanguages', 'maxApiKeysPerVenue'] as const;

export type BillingPeriod = 'month' | 'quarter' | 'year';
type PlanLook = SitePricing['plans'][string];

/** The price for the period in US dollars (the Lebanese market) when offered, else the first; else any period. */
export function pickPrice(prices: PublicPlan['prices'], preferred = 'USD', period: BillingPeriod = 'month') {
  const inPeriod = prices.filter((p) => p.period === period);
  const pool = inPeriod.length ? inPeriod : prices;
  return pool.find((p) => p.currency === preferred) ?? pool[0] ?? null;
}

export function Pricing({ period = 'month' }: { period?: BillingPeriod } = {}) {
  const { t } = useTranslation();
  const site = useSiteInfo();
  const looks = site.data?.pricing?.plans ?? {};
  const q = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => publicApi.get<PublicPlansResponse>('/plans'),
    staleTime: 5 * 60_000,
  });
  if (q.isPending) return <Spinner label={t('common:loading')} />;
  if (q.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError text={errorText(t, q.error)} />
        <button type="button" onClick={() => void q.refetch()} className="inline-flex min-h-12 items-center rounded-full border border-line px-5 font-semibold">
          {t('pricing.retry')}
        </button>
      </div>
    );
  const days = typeof q.data.trialDays === 'number' ? q.data.trialDays : null;
  if (q.data.items.length === 0) return <p className="text-muted">{t('pricing.none')}</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {q.data.items.map((p) => (
          <PlanCard key={p.code} plan={p} look={looks[p.code]} trialDays={days} period={period} />
        ))}
      </div>
      <p className="text-sm text-muted">{t('pricing.vatNote')}</p>
    </div>
  );
}

function PlanCard({ plan, look, trialDays, period }: { plan: PublicPlan; look?: PlanLook; trialDays: number | null; period: BillingPeriod }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const name = look?.name[lang] || t(`pricing.planNames.${plan.code}`, { defaultValue: plan.name });
  const tagline = look?.tagline[lang];
  const featured = look?.featured === true;
  const locale = i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA';
  const price = pickPrice(plan.prices, 'USD', period);
  const limits = (plan.limits ?? {}) as Record<string, unknown>;
  const shownLimits = SHOWN_LIMITS.filter((k) => typeof limits[k] === 'number' && (limits[k] as number) > 0);
  const features = (Array.isArray(plan.features) ? plan.features : []).filter((f): f is (typeof KNOWN_FEATURES)[number] => (KNOWN_FEATURES as readonly string[]).includes(f));
  const headingId = `plan-${plan.code}`;
  return (
    <article aria-labelledby={headingId} className={`relative flex flex-col gap-3 rounded-[var(--radius-card)] p-6 shadow-card ${featured ? 'bg-ink text-white' : 'border border-line bg-surface'}`}>
      {featured && <span className="absolute -top-3 end-6 rounded-full bg-glow px-3 py-1 text-sm font-semibold text-ink">{t('pricing.featured')}</span>}
      <h3 id={headingId} className="font-display text-xl font-bold">
        {name}
      </h3>
      {tagline && <p className={featured ? 'text-white/75' : 'text-ink-2'}>{tagline}</p>}
      {price && (
        <p className="flex flex-col gap-1">
          <span className="num self-start font-display text-4xl font-bold">{formatMoney(price.amountMinor, price.currency, locale)}</span>
          <span className={`eyebrow ${featured ? 'text-white/60' : ''}`}>{t(`pricing.perVenue.${price.period}`)}</span>
        </p>
      )}
      {shownLimits.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label={t('pricing.limitsLabel')}>
          {shownLimits.map((k) => (
            <li key={k}>{t(`pricing.limits.${k}`, { n: limits[k] as number })}</li>
          ))}
        </ul>
      )}
      {features.length > 0 && (
        <ul className="flex flex-col gap-1 ps-5" style={{ listStyleType: 'disc' }} aria-label={t('pricing.featuresLabel')}>
          {features.map((f) => (
            <li key={f}>{t(`pricing.features.${f}`)}</li>
          ))}
        </ul>
      )}
      <p className="text-sm">{trialDays ? t('pricing.trialNoteDays', { days: trialDays }) : t('pricing.trialNoteGeneric')}</p>
      <Link
        to="/contact"
        className={`mt-auto inline-flex min-h-12 items-center justify-center rounded-full px-4 font-semibold ${featured ? 'bg-white text-ink hover:bg-canvas' : 'bg-ink text-white hover:bg-ink-2'}`}
      >
        {t('nav.getStarted')}
      </Link>
    </article>
  );
}

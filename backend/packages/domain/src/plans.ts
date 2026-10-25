import type { PlanCode, PlanLimits } from '@dop/contracts';

// Seeded plans (TRD appendix 30.3). Features are only listed once their release ships.

export interface SeedPlan {
  code: PlanCode;
  name: string;
  isPublic: boolean;
  limits: PlanLimits;
  features: string[];
  sortOrder: number;
}

const base = { maxDisplaysPerVenue: 20, maxStaffDevicesPerVenue: 50, trialTicketsPerDay: 200 };

export const SEED_PLANS: SeedPlan[] = [
  {
    code: 'trial',
    name: 'Trial',
    isPublic: false,
    limits: { ...base, maxVenues: 1, maxCountersPerVenue: 10, maxLanguages: 10, maxApiKeysPerVenue: 0 },
    features: ['display_speech', 'ratings', 'reports_trends', 'counters', 'remove_powered_by'],
    sortOrder: 0,
  },
  {
    code: 'standard',
    name: 'Standard',
    isPublic: true,
    limits: { ...base, maxVenues: 1, maxCountersPerVenue: 10, maxLanguages: 10, maxApiKeysPerVenue: 5 },
    features: ['display_speech', 'ratings', 'reports_trends', 'counters', 'remove_powered_by', 'api_access', 'webhooks', 'pos_connectors', 'named_staff', 'csv_export'],
    sortOrder: 1,
  },
  {
    code: 'pro',
    name: 'Pro',
    isPublic: true,
    limits: { ...base, maxVenues: 1, maxCountersPerVenue: 10, maxLanguages: 10, maxApiKeysPerVenue: 5 },
    features: ['display_speech', 'ratings', 'reports_trends', 'counters', 'remove_powered_by', 'api_access', 'webhooks', 'pos_connectors', 'named_staff', 'csv_export'],
    sortOrder: 2,
  },
  {
    code: 'multisite',
    name: 'Multi-site',
    isPublic: true,
    limits: { ...base, maxVenues: 100, maxCountersPerVenue: 10, maxLanguages: 10, maxApiKeysPerVenue: 5 },
    features: ['display_speech', 'ratings', 'reports_trends', 'counters', 'remove_powered_by', 'api_access', 'webhooks', 'pos_connectors', 'named_staff', 'csv_export', 'multi_venue', 'combined_reports'],
    sortOrder: 3,
  },
];

export const FEATURE_FLAGS: Array<{ key: string; description: string }> = [
  { key: 'display_speech', description: 'Spoken announcements on displays' },
  { key: 'ratings', description: 'Customer ratings after collection' },
  { key: 'reports_trends', description: 'Trends, heatmap and weekly summary' },
  { key: 'counters', description: 'Several counters with prefixes' },
  { key: 'remove_powered_by', description: 'Hide the "Powered by" line' },
  { key: 'api_access', description: 'Integration API keys' },
  { key: 'webhooks', description: 'Outgoing webhooks' },
  { key: 'pos_connectors', description: 'POS connectors' },
  { key: 'named_staff', description: 'Named staff with personal PINs' },
  { key: 'csv_export', description: 'CSV export of tickets' },
  { key: 'multi_venue', description: 'Several venues per tenant' },
  { key: 'combined_reports', description: 'Reports across venues' },
];

/** Monthly launch price per venue (BRD OI-02): Standard SAR 99, Pro SAR 179; quarterly −10%, yearly −20%; VAT added on invoices. */
const MONTHLY_SAR_MINOR: Partial<Record<PlanCode, number>> = { pro: 17900 };
/** Standard is the single plan, priced in US dollars (launch placeholder, set in the console). */
const STANDARD_USD_MINOR = { month: 2700, quarter: 7290, year: 25920 } as const;
const PERIODS = [
  { period: 'month', months: 1, discount: 0 },
  { period: 'quarter', months: 3, discount: 0.1 },
  { period: 'year', months: 12, discount: 0.2 },
] as const;

export const SEED_PRICES = [
  ...(['month', 'quarter', 'year'] as const).map((period) => ({ plan: 'standard' as PlanCode, period, currency: 'USD', amountMinor: STANDARD_USD_MINOR[period] })),
  ...(Object.entries(MONTHLY_SAR_MINOR) as Array<[PlanCode, number]>).flatMap(([plan, monthly]) =>
  PERIODS.map((p) => ({
    plan,
    period: p.period,
    currency: 'SAR',
    amountMinor: Math.round(monthly * p.months * (1 - p.discount)),
  })),
),
];

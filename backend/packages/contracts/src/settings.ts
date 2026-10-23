import { z } from 'zod';

// Venue settings, messages and display settings (TRD appendix 30.5). Validated on every write (TR-DB-10).

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const venueSettingsSchema = z
  .object({
    ticketFlow: z
      .object({
        startStatus: z.enum(['received', 'preparing']).default('preparing'),
        showReceivedColumn: z.boolean().default(false),
      })
      .strict()
      .default({}),
    wait: z
      .object({
        mode: z.enum(['manual', 'auto', 'off']).default('manual'),
        defaultMinutes: z.number().int().min(0).max(240).default(10),
      })
      .strict()
      .default({}),
    numbering: z
      .object({
        rangeStart: z.number().int().min(1).max(9999).default(1),
        rangeEnd: z.number().int().min(1).max(9999).default(999),
        prefixesEnabled: z.boolean().default(false),
        skipNumbers: z.array(z.number().int().min(1).max(9999)).max(500).default([]),
      })
      .strict()
      .refine((n) => n.rangeEnd > n.rangeStart, { message: 'rangeEnd must be greater than rangeStart' })
      .default({}),
    checkCode: z.enum(['off', 'optional', 'mandatory']).default('off'),
    claims: z
      .object({ mode: z.enum(['off', 'code', 'staff_approval']).default('code') })
      .strict()
      .default({}),
    alerts: z
      .object({
        repeatOffsetsSec: z
          .array(z.number().int().min(30).max(1800))
          .max(5)
          .refine((a) => a.every((v, i) => i === 0 || v > a[i - 1]!), { message: 'Offsets must be ascending' })
          .default([120, 300]),
        maxAutoAlerts: z.number().int().min(1).max(6).default(3),
        chime: z.string().min(1).max(40).default('classic'),
        liveLoopSeconds: z.number().int().min(10).max(300).default(60),
      })
      .strict()
      .default({}),
    staff: z.object({ soundOnApiTicket: z.boolean().default(false) }).strict().default({}),
    customer: z
      .object({
        showPoweredBy: z.boolean().default(true),
        reviewLinkUrl: z.string().url().startsWith('https://').max(500).nullable().default(null),
      })
      .strict()
      .default({}),
  })
  .strict();
export type VenueSettings = z.infer<typeof venueSettingsSchema>;
export const defaultVenueSettings = (): VenueSettings => venueSettingsSchema.parse({});

const message = z.string().max(280);
export const venueLocaleMessagesSchema = z
  .object({
    welcome: message.optional(),
    collection: message.optional(),
    cancelled: message.optional(),
    afterCollection: message.optional(),
    websiteUrl: z.string().url().startsWith('https://').max(500).optional(),
  })
  .strict();
export const venueMessagesSchema = z.record(z.string().min(2).max(10), venueLocaleMessagesSchema);
export type VenueMessages = z.infer<typeof venueMessagesSchema>;

/** Chimes the apps synthesise (no download, works offline); uploaded chimes are MP3 files (FR-SA-12). */
export const BUILTIN_CHIMES = ['classic', 'bell', 'soft'] as const;
export const chimeAudioKey = (code: string) => `chimes/${code}.mp3`;

export const displaySettingsSchema = z
  .object({
    showPreparing: z.boolean().default(true),
    announce: z
      .object({
        enabled: z.boolean().default(true),
        languages: z.array(z.string().min(2).max(10)).max(2).default(['ar']),
        quietHours: z.array(z.object({ from: timeHHMM, to: timeHHMM }).strict()).max(3).default([]),
      })
      .strict()
      .default({}),
    qr: z.object({ show: z.boolean().default(true), rotating: z.boolean().default(false) }).strict().default({}),
    message: z.record(z.string(), message).default({}),
    // Promo slot (R1.1, FR-DSP-07): text per language and an optional image; never covers the Ready list.
    promo: z
      .object({ text: z.record(z.string(), message).default({}), imageUrl: z.string().url().startsWith('https://').max(500).nullable().default(null) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type DisplaySettings = z.infer<typeof displaySettingsSchema>;

// Plan limits (appendix 30.3).
export const planLimitsSchema = z
  .object({
    maxVenues: z.number().int().min(0),
    maxCountersPerVenue: z.number().int().min(0),
    maxLanguages: z.number().int().min(1),
    maxDisplaysPerVenue: z.number().int().min(0),
    maxStaffDevicesPerVenue: z.number().int().min(0),
    maxApiKeysPerVenue: z.number().int().min(0),
    trialTicketsPerDay: z.number().int().min(1),
  })
  .strict();
export type PlanLimits = z.infer<typeof planLimitsSchema>;

// Platform settings (appendix 30.4).
export const tenantDefaultsSchema = z.object({
  timeZone: z.string(),
  locales: z.array(z.string()).min(1),
  currency: z.string().length(3),
  resetTime: timeHHMM,
  autoCloseTime: timeHHMM,
  wait: z.object({ mode: z.enum(['manual', 'auto', 'off']), defaultMinutes: z.number().int() }),
  alerts: z.object({ repeatOffsetsSec: z.array(z.number().int()), maxAutoAlerts: z.number().int() }),
  chime: z.string(),
});
export type TenantDefaults = z.infer<typeof tenantDefaultsSchema>;

/** WhatsApp in international format without spaces, e.g. +966500000000; empty hides the button. */
export const siteContactSchema = z
  .object({
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]),
    whatsapp: z.union([z.literal(''), z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use the international format, e.g. +966500000000')]),
  })
  .strict();
export type SiteContact = z.infer<typeof siteContactSchema>;

/** One text in each site language; empty falls back to the plan's catalogue name or hides the line. */
const siteText = (max: number) => z.object({ ar: z.string().trim().max(max), en: z.string().trim().max(max) }).strict();
const siteList = z.array(z.string().trim().min(1).max(80)).max(12);
export const SITE_PRICING_PERIODS = ['month', 'quarter', 'year'] as const;

/**
 * The packages section on the website, edited by super admins. Prices, limits and features stay in the plan
 * catalogue; this holds the wording around them and how each public plan is presented.
 */
export const sitePricingSchema = z
  .object({
    title: siteText(120),
    included: z.object({ ar: siteList, en: siteList }).strict(),
    note: siteText(160),
    periods: z
      .array(z.enum(SITE_PRICING_PERIODS))
      .min(1)
      .refine((a) => new Set(a).size === a.length, 'Each period once'),
    plans: z
      .record(
        z.string().regex(/^[a-z0-9_-]{1,40}$/),
        z.object({ name: siteText(40), tagline: siteText(140), featured: z.boolean() }).strict(),
      )
      .refine((r) => Object.keys(r).length <= 20, 'At most 20 plans')
      .refine((r) => Object.values(r).filter((p) => p.featured).length <= 1, 'Highlight one plan at most'),
  })
  .strict();
export type SitePricing = z.infer<typeof sitePricingSchema>;

/** Landing page sections a super admin can hide (the hero always shows). */
export const SITE_LANDING_SECTIONS = ['trust', 'marquee', 'steps', 'statement', 'compare', 'brand', 'cashier', 'tv', 'reach', 'pos', 'local', 'pricing', 'faq', 'closing', 'whatsapp'] as const;
export type SiteLandingSection = (typeof SITE_LANDING_SECTIONS)[number];

/** Text overrides keep the shape of the site's translation tree: strings, lists and objects of them. */
export type SiteCopyValue = string | SiteCopyValue[] | { [key: string]: SiteCopyValue };
const copyKey = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/);
const copyValue: z.ZodType<SiteCopyValue> = z.lazy(() => z.union([z.string().max(1000), z.array(copyValue).max(24), z.record(copyKey, copyValue)]));
const depth = (v: unknown): number => (v && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0);
const copyTree = z
  .object({ landing: z.record(copyKey, copyValue).optional(), nav: z.record(copyKey, z.string().max(60)).optional() })
  .strict()
  .refine((v) => depth(v) <= 6, 'Too deeply nested');

/**
 * Landing page content edited by super admins: per-language text overrides over the site's built-in copy (only what
 * changed is stored) and the sections to hide. The packages wording lives in `site.pricing`.
 */
export const siteLandingSchema = z
  .object({
    hidden: z
      .array(z.enum(SITE_LANDING_SECTIONS))
      .refine((a) => new Set(a).size === a.length, 'Each section once'),
    copy: z.object({ ar: copyTree, en: copyTree }).strict(),
  })
  .strict()
  .refine((v) => JSON.stringify(v).length <= 200_000, 'Too much text');
export type SiteLanding = z.infer<typeof siteLandingSchema>;

const isCopyObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The same shape with every text empty: the template for an item added to a list. */
const blankCopy = (v: unknown): unknown =>
  typeof v === 'string' ? '' : Array.isArray(v) ? [] : isCopyObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankCopy(x)])) : v;

/**
 * Built-in site text with a `site.landing` override laid over it. Only keys of the built-in text with the same kind
 * of value are taken, so a stale override never breaks the page; blank text keeps the built-in text; lists are
 * replaced whole (an added item gets missing fields empty); objects are merged key by key.
 */
export function overlaySiteCopy(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (typeof base === 'string') return typeof over === 'string' && over.trim() ? over : base;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return base;
    const sample: unknown = base[0];
    const fits = over.every((x) => (typeof sample === 'string' ? typeof x === 'string' : isCopyObject(sample) && isCopyObject(x)));
    return fits ? over.map((x) => (isCopyObject(sample) ? overlaySiteCopy(blankCopy(sample), x) : x)) : base;
  }
  if (isCopyObject(base)) {
    if (!isCopyObject(over)) return base;
    return Object.fromEntries(Object.keys(base).map((k) => [k, overlaySiteCopy(base[k], over[k])]));
  }
  return base;
}

export const PLATFORM_SETTING_DEFAULTS = {
  'tenant.defaults': {
    timeZone: 'Asia/Riyadh',
    locales: ['ar', 'en'],
    currency: 'SAR',
    resetTime: '04:00',
    autoCloseTime: '04:00',
    wait: { mode: 'manual', defaultMinutes: 10 },
    alerts: { repeatOffsetsSec: [120, 300], maxAutoAlerts: 3 },
    chime: 'classic',
  } satisfies TenantDefaults,
  'trial.days': 14,
  'billing.retryDays': 7,
  'billing.graceDays': 7,
  'billing.suspendedToCancelDays': 30,
  'fairness.perTenantPerSecond': { push: 20, webhook: 5, email: 2 },
  maintenance: { enabled: false, message: {} as Record<string, string>, until: null as string | null },
  'retention.ticketDays': 90,
  'retention.closedTenantDays': 90,
  'support.defaultMinutes': 120,
  'console.ipAllowList': [] as string[],
  'customer.supportedLanguages': ['ar', 'en'],
  'push.ttlSeconds': 600,
  /** Public contact on the sign-up site (email link and WhatsApp button); edited in the console. */
  'site.contact': { email: 'support@tanbeeh.app', whatsapp: '' } as SiteContact,
  /** The packages section on the website (wording, periods, plan names, taglines, highlight); edited in the console. */
  'site.pricing': {
    title: { ar: 'نقّي خطّتك، وكل خطة فيها كل شي بتحتاجو لتبلّش.', en: 'Pick a plan. Every plan has everything you need to start.' },
    included: {
      ar: ['أرقام وتنبيهات بلا حدود', 'لوحة الكاشير على أي جهاز', 'شاشة استلام مع نداء بالصوت', 'ملصقات QR جاهزة للطباعة', 'صفحة بألوانك وشعارك', 'تقارير وتقييمات'],
      en: ['Unlimited numbers and alerts', 'Staff board on any device', 'Pickup screen with announcements', 'QR posters ready to print', 'Page in your colours and logo', 'Reports and ratings'],
    },
    note: { ar: 'عندك كذا فرع أو سلسلة؟ حاكينا ومنتّفق عالسعر.', en: 'Several branches or a chain? Talk to us about a price.' },
    periods: ['month', 'quarter', 'year'],
    plans: {},
  } as SitePricing,
  /** Landing page text overrides and hidden sections; edited in the console. */
  'site.landing': { hidden: [], copy: { ar: {}, en: {} } } as SiteLanding,
} as const;
export type PlatformSettingKey = keyof typeof PLATFORM_SETTING_DEFAULTS;

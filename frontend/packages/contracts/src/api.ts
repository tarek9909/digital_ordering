// GENERATED from backend/packages/contracts/src by `npm run sync:contracts` in backend/. Do not edit.
import { z } from 'zod';
import { CANCEL_REASONS, JOINED_VIA, MEMBER_ROLES, PLATFORM_ROLES, UA_FAMILIES } from './enums.js';
import { displaySettingsSchema, venueMessagesSchema, venueSettingsSchema } from './settings.js';

// Request schemas for every browser API surface (TRD §12). All objects are `.strict()` (TR-SEC-03).

export const tokenParam = z.string().regex(/^[0-9A-Za-z]{22}$/);
export const clientIdSchema = z.string().regex(/^[0-9A-Za-z]{22}$/);
export const uuidSchema = z.string().uuid();
/** A real calendar date `YYYY-MM-DD` (rejects 2026-99-99 and 2026-02-30). */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a calendar date');
/** `from` and `to` dates with `from` ≤ `to`, at most `maxDays` days apart. */
export const dateRange = <T extends z.ZodRawShape>(extra: T, maxDays = 731) =>
  z
    .object({ ...extra, from: calendarDateSchema, to: calendarDateSchema })
    .strict()
    .refine((q) => (q as DateSpan).from <= (q as DateSpan).to, { message: 'from must not be after to', path: ['from'] })
    .refine((q) => (Date.parse((q as DateSpan).to) - Date.parse((q as DateSpan).from)) / 86_400_000 <= maxDays, { message: `At most ${maxDays} days`, path: ['to'] });
type DateSpan = { from: string; to: string };
export const venueCodeParam = z
  .string()
  .regex(/^[A-Za-z0-9]{6}$/)
  .transform((s) => s.toUpperCase());
export const slugSchema = z.string().min(3).max(40);
export const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.trim().toLowerCase());
export const passwordSchema = z.string().min(10).max(128);
export const localeSchema = z.string().min(2).max(10);

// ---- Public API (§12.3)
export const followBody = z
  .object({ clientId: clientIdSchema, joinedVia: z.enum(JOINED_VIA), uaFamily: z.enum(UA_FAMILIES), locale: localeSchema.optional() })
  .strict();
export const clientOnlyBody = z.object({ clientId: clientIdSchema }).strict();
export const pushSubscriptionBody = z
  .object({
    clientId: clientIdSchema,
    subscription: z
      .object({
        endpoint: z.string().url().max(1024),
        expirationTime: z.number().nullable().optional(),
        keys: z.object({ p256dh: z.string().min(16).max(255), auth: z.string().min(8).max(64) }).strict(),
      })
      .strict(),
  })
  .strict();
export const ratingBody = z.object({ clientId: clientIdSchema, stars: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).strict();
export const myTicketsBody = z.object({ clientId: clientIdSchema, tokens: z.array(tokenParam).max(20) }).strict();
export const claimBody = z
  .object({ clientId: clientIdSchema, number: z.string().min(1).max(8), claimCode: z.string().length(4).optional() })
  .strict();

// ---- Auth API (§12.4)
export const signInBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const signInMfaBody = z.object({ mfaToken: z.string().min(16).max(100), code: z.string().regex(/^\d{6}$/) }).strict();
export const emailTokenBody = z.object({ token: z.string().min(16).max(100) }).strict();
/** Change of the sign-in email (FR-ADM-18): confirmed by the current password, completed from the new inbox. */
export const changeEmailBody = z.object({ newEmail: emailSchema, password: z.string().min(1).max(128) }).strict();
/** The signed-in member's own preferences in the current tenant (FR-RPT-05). */
export const memberPreferencesBody = z.object({ weeklySummary: z.boolean() }).strict();
export const forgotPasswordBody = z.object({ email: emailSchema }).strict();
export const resetPasswordBody = z.object({ token: z.string().min(16).max(100), password: passwordSchema }).strict();
export const acceptInvitationBody = z
  .object({ name: z.string().trim().min(1).max(120).optional(), password: passwordSchema.optional() })
  .strict();
export const handoffBody = z.object({ tenantSlug: slugSchema }).strict();
export const handoffExchangeBody = z.object({ code: z.string().min(16).max(100) }).strict();
export const totpConfirmBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
/**
 * Starting an authenticator from a signed-in session (H-5): the account password (accounts without one need a
 * sign-in from the last 15 minutes), and a code from the current authenticator when one is being replaced.
 */
export const totpEnrollBody = z.object({ password: z.string().min(1).max(128).optional(), currentCode: z.string().regex(/^\d{6}$/).optional() }).strict();
/** Turning two-factor sign-in off needs a code from the current authenticator (H-5). */
export const totpRemoveBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

// ---- Staff API (§12.5)
export const staffSessionBody = z
  .object({ staffKey: z.string().regex(/^[0-9A-Za-z]{32}$/), pin: z.string().regex(/^\d{4,6}$/), deviceName: z.string().trim().min(1).max(60) })
  .strict();
export const staffDevicePatch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), mode: z.enum(['board', 'kitchen']).optional() })
  .strict();
export const createTicketBody = z
  .object({
    counterId: uuidSchema.optional(),
    note: z.string().trim().max(280).optional(),
    externalRef: z.string().trim().min(1).max(100).optional(),
    waitMinutes: z.number().int().min(0).max(240).optional(),
    startStatus: z.enum(['received', 'preparing']).optional(),
  })
  .strict();
export type CreateTicketBody = z.infer<typeof createTicketBody>;
export const transitionBody = z
  .object({
    to: z.enum(['received', 'preparing', 'ready', 'collected', 'cancelled']),
    version: z.number().int().min(1),
    checkCode: z.string().length(4).optional(),
    cancelReason: z.enum(CANCEL_REASONS).optional(),
    cancelNote: z.string().trim().max(200).optional(),
  })
  .strict();
export type TransitionBody = z.infer<typeof transitionBody>;
export const editTicketBody = z
  .object({
    version: z.number().int().min(1),
    note: z.string().trim().max(280).nullable().optional(),
    externalRef: z.string().trim().min(1).max(100).nullable().optional(),
    waitDeltaMinutes: z.number().int().min(-240).max(240).optional(),
  })
  .strict();
export type EditTicketBody = z.infer<typeof editTicketBody>;
export const searchQuery = z.object({ q: z.string().trim().min(1).max(100) }).strict();
export const staffVenueQuery = z.object({ venueId: uuidSchema.optional() }).passthrough();

// ---- Display API (§12.6)
export const pairBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

// ---- Tenant admin API (§12.7)
export const tenantPatch = z
  .object({ name: z.string().trim().min(1).max(120).optional(), billingEmail: emailSchema.nullable().optional(), taxId: z.string().max(40).nullable().optional(), defaultLocale: localeSchema.optional() })
  .strict();
export const deletionRequestBody = z.object({ password: z.string().min(1).max(128) }).strict();
export const venuePatch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timeZone: z.string().min(3).max(64).optional(),
    locales: z.array(localeSchema).min(1).max(10).optional(),
    brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    resetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    autoCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    address: z.record(z.string(), z.string().max(200)).nullable().optional(),
  })
  .strict();
export const venueMessagesBody = venueMessagesSchema;
export const venueSettingsBody = venueSettingsSchema;
export const staffPinBody = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).strict();
export const displayCreateBody = z
  .object({ name: z.string().trim().min(1).max(60), counterIds: z.array(uuidSchema).nullable().optional(), settings: displaySettingsSchema.optional() })
  .strict();
export const displayPatch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), counterIds: z.array(uuidSchema).nullable().optional(), settings: displaySettingsSchema.optional() })
  .strict();
export const invitationBody = z.object({ email: emailSchema, role: z.literal('manager') }).strict();
export const memberPatch = z.object({ role: z.enum(MEMBER_ROLES), weeklySummary: z.boolean().optional() }).partial().strict();
export const ownershipTransferBody = z.object({ memberId: uuidSchema, password: z.string().min(1).max(128) }).strict();
export const reportRangeQuery = dateRange({ venueId: uuidSchema.optional() });
export const mePatch = z.object({ name: z.string().trim().min(1).max(120).optional(), locale: localeSchema.optional() }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
/** Any plan code from the catalogue (Standard, Pro, Multi-site and plans created in the console, FR-SA-10). */
export const planCodeSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);

// ---- Console API (§12.8)
export const purposeHeader = z.enum(['support', 'security', 'billing', 'legal', 'operations']);
export const consoleTenantsQuery = z
  .object({ q: z.string().max(100).optional(), status: z.string().max(20).optional(), plan: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() })
  .strict();
export const consoleCreateTenantBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    country: z.string().length(2).toUpperCase(),
    locale: localeSchema,
    ownerEmail: emailSchema,
    complimentary: z.boolean().default(false),
    /** Plan of the new tenant (FR-SA-05); default: Trial, or Standard when complimentary. */
    planCode: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
    /** Trial length in days for a non-complimentary tenant; default: the platform setting. */
    trialDays: z.coerce.number().int().min(1).max(90).optional(),
  })
  .strict()
  .refine((b) => !(b.complimentary && b.planCode === 'trial'), { message: 'A complimentary tenant needs a paid plan', path: ['planCode'] })
  .refine((b) => !(b.complimentary && b.trialDays !== undefined), { message: 'A complimentary tenant has no trial', path: ['trialDays'] });
export const reasonBody = z.object({ reason: z.string().trim().min(3).max(500), confirm: z.string().max(60).optional() }).strict();
export const extendTrialBody = z.object({ days: z.number().int().min(1).max(90) }).strict();
export const complimentaryBody = z.object({ enabled: z.boolean() }).strict();
export const deleteTenantBody = z.object({ confirmSlug: slugSchema }).strict();
export const platformUserCreateBody = z.object({ email: emailSchema, name: z.string().trim().min(1).max(120), role: z.enum(PLATFORM_ROLES) }).strict();
export const platformUserPatch = z.object({ role: z.enum(PLATFORM_ROLES).optional(), status: z.enum(['active', 'disabled']).optional() }).strict();
export const settingPutBody = z.object({ value: z.unknown() }).strict();
export const auditQuery = z
  .object({
    tenantId: uuidSchema.optional(),
    actorId: uuidSchema.optional(),
    action: z.string().max(80).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(40).optional(),
  })
  .strict();

// ---- R1.1 additions
export const counterCreateBody = z
  .object({ name: z.string().trim().min(1).max(60), prefix: z.string().trim().regex(/^[A-Z][A-Z0-9]{0,2}$/).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).optional() })
  .strict();
export const counterPatch = counterCreateBody.partial().strict();
export const claimDecisionBody = z.object({ approve: z.boolean() }).strict();
export const supportRequestBody = z.object({ reason: z.string().trim().min(5).max(500), durationMinutes: z.number().int().min(15).max(480).default(120) }).strict();
export const supportCodeBody = z.object({ code: z.string().regex(/^\d{8}$/) }).strict();
export const noteBody = z.object({ body: z.string().trim().min(1).max(5000) }).strict();
export const announcementBody = z
  .object({
    message: z.record(z.string().min(2).max(10), z.string().min(1).max(500)),
    severity: z.enum(['info', 'warning', 'critical']),
    target: z.union([z.object({ all: z.literal(true) }).strict(), z.object({ tenantIds: z.array(uuidSchema).min(1).max(1000) }).strict(), z.object({ plans: z.array(z.string()).min(1) }).strict()]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict();
export const slugChangeBody = z.object({ slug: slugSchema, password: z.string().min(1).max(128) }).strict();
export const deleteMeBody = z.object({ password: z.string().min(1).max(128) }).strict();
export const changePlanBody = z.object({ planCode: planCodeSchema }).strict();
export const planCreateBody = z
  .object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,38}$/), name: z.string().min(1).max(80), isPublic: z.boolean().default(true), limits: z.record(z.string(), z.number().int().min(0)), features: z.array(z.string().max(60)).max(50), sortOrder: z.number().int().default(10) })
  .strict();
export const planPatch = planCreateBody.omit({ code: true }).partial().strict();
export const priceCreateBody = z.object({ period: z.enum(['month', 'quarter', 'year']), currency: z.string().length(3).toUpperCase(), amountMinor: z.number().int().min(0) }).strict();
/** An offline payment recorded by the platform team; it extends the tenant's paid-until date by `months`. */
export const recordPaymentBody = z
  .object({
    amountMinor: z.number().int().min(0),
    currency: z.string().length(3).toUpperCase(),
    months: z.number().int().min(1).max(24),
    method: z.enum(['cash', 'bank_transfer', 'wallet', 'other']),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
    /** Generated once per payment form: a repeated submit with the same id records the payment once (BW02). */
    requestId: uuidSchema.optional(),
  })
  .strict();
export const freeMonthsBody = z.object({ months: z.number().int().min(1).max(12) }).strict();
export const flagOverrideBody = z.object({ enabled: z.boolean() }).strict();
export const transferOwnershipPlatformBody = z.object({ email: emailSchema, verificationNote: z.string().trim().min(10).max(1000) }).strict();
export const legalDocumentBody = z.object({ kind: z.enum(['terms', 'privacy', 'dpa', 'customer_privacy']), version: z.string().min(1).max(20), locale: z.string().min(2).max(10), html: z.string().min(1).max(500_000) }).strict();
/** Acceptance gate (FR-ADM-16, AS04): the exact document ids shown, in the locale they were shown for. */
export const legalPendingQuery = z.object({ locale: localeSchema.optional() }).strict();
export const legalAcceptBody = z.object({ documentIds: z.array(uuidSchema).min(1).max(5), locale: localeSchema.optional() }).strict();
export const emailTemplateBody = z.object({ subject: z.string().min(1).max(200), blocks: z.array(z.string().max(2000)).min(1).max(10) }).strict();

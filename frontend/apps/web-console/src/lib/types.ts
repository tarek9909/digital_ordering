import type { AuditPurpose, PlatformRole, TenantStatus } from '@dop/contracts';

// Response shapes of the console and auth APIs (backend services/console.ts, auth.ts, reports.ts).

export interface Me {
  platformUser: { id: string; role: PlatformRole; name: string };
  mfaVerifiedAt: string | null;
  csrfToken: string;
  environment: string;
}

export type SignInResponse = { ok: true } | { mfaRequired: boolean; mfaEnrollmentRequired: boolean; mfaToken: string };

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string;
  complimentary: boolean;
  createdAt: string;
  lastActivityAt: string | null;
  trialEndsAt: string | null;
  ticketsThisMonth: number;
  ownerEmail: string | null;
}

export interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
    statusReason: string | null;
    suspendedBy: string | null;
    plan: string;
    complimentary: boolean;
    trialEndsAt: string | null;
    paidUntil: string | null;
    graceEndsAt: string | null;
    deletionRequestedAt: string | null;
    country: string;
    defaultLocale: string;
    createdAt: string;
    lastActivityAt: string | null;
  };
  venues: Array<{ id: string; name: string; venue_code: string; status: string; time_zone: string }>;
  devices: Array<{ id: string; venue_id: string; name: string; last_seen_at: string }>;
  displays: Array<{ id: string; venue_id: string; name: string; last_seen_at: string | null; sound_enabled: boolean | number; paired_at: string | null }>;
  members: Array<{ id: string; role: string; name: string; email: string; verified: boolean }>;
  payments: Payment[];
}

/** An offline payment recorded in the console; it extended the tenant's paid-until date. */
export interface Payment {
  id: string;
  amountMinor: number;
  currency: string;
  months: number;
  method: 'cash' | 'bank_transfer' | 'wallet' | 'other';
  reference: string | null;
  note: string | null;
  coversFrom: string;
  coversUntil: string;
  recordedAt: string;
}

export interface BillingView {
  paidUntil: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  complimentary: boolean;
  payments: Payment[];
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  tenant_id: string | null;
  purpose: AuditPurpose | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip: string | null;
  request_id: string | null;
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  status: 'active' | 'disabled' | 'invited' | string;
  mfa_enrolled_at: string | null;
  last_sign_in_at: string | null;
}

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: string | null;
}

export interface Language {
  code: string;
  name: string;
  direction: 'ltr' | 'rtl';
  customer_enabled: boolean | number;
  tts_lang: string | null;
}

/** GET /chimes row (FR-SA-12, W11). Built-ins are synthesised on devices and have no file. */
export interface Chime {
  id: string;
  code: string;
  name: string;
  active: boolean;
  builtin: boolean;
  durationMs: number;
  url: string | null;
}

export type Reach = Record<'push' | 'live' | 'closed' | 'none', number>;

export interface PilotSummary {
  tickets: number;
  readyTickets: number;
  alertReach: Reach;
  reachPushOrLivePct: number | null;
  acknowledgedPct: number | null;
  prepSecondsP50: number | null;
  prepSecondsP90: number | null;
  pickupSecondsP50: number | null;
  pickupSecondsP90: number | null;
  uncollected: number;
  undoPct: number | null;
}

export interface PilotReport {
  from: string;
  to: string;
  prepLabel: string;
  total: PilotSummary;
  days: Array<PilotSummary & { date: string }>;
}

export interface ConsolePilotItem {
  tenant: { id: string; name: string; slug: string };
  report: PilotReport;
}

// ---- R1.1 (backend services/platform-tools.ts, support.ts)

export interface TenantNote {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  description: string | null;
  defaultOn: boolean;
  override: boolean | number | null;
}

export interface PlanPrice {
  id: string;
  period: 'month' | 'quarter' | 'year';
  currency: string;
  amountMinor: number;
  active: boolean;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  isPublic: boolean;
  limits: unknown;
  features: unknown;
  archived: boolean;
  prices: PlanPrice[];
}

export interface Announcement {
  id: string;
  message: unknown;
  severity: 'info' | 'warning' | 'critical';
  target: unknown;
  starts_at: string;
  ends_at: string;
}

export interface PushKeyStatus {
  configured: boolean;
  publicKeyFingerprint: string | null;
  activeSubscriptions: number;
}

export interface PlatformCohort {
  /** YYYY-MM of sign-up. */
  month: string;
  signups: number;
  converted: number;
  complimentary: number;
  conversionPct: number | null;
}

export interface DeliveryHealth {
  pushSent: number;
  pushFailures: number;
  pushFailurePct: number | null;
  webhookFailures: number;
}

export interface PlatformReportResponse {
  days: Array<Record<string, unknown>>;
  /** Tenants active or past due at the start of the range (churn denominator). */
  activeAtStart: number;
  churnPct: number | null;
  cohorts: PlatformCohort[];
  deliveryHealth: DeliveryHealth;
  /** Alert level at Ready per phone type (operating system/browser family) over the range (BRD §12.2). */
  reachByUa?: Record<string, Record<string, number>>;
  trialDays: unknown;
}

export interface DowngradeExcess {
  limit: string;
  current: number;
  allowed: number;
}

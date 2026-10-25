import type { DisplaySettings, MemberRole, TenantStatus, VenueMessages, VenueSettings } from '@dop/contracts';

// Response shapes of the auth and tenant admin APIs (backend/packages/services).

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  role: MemberRole;
}

export interface Me {
  user: { id: string; email: string; name: string; locale: string; emailVerified: boolean; mfaEnrolled: boolean; pendingEmail?: string | null };
  /** The member's preferences in the current tenant (W06). */
  preferences?: { weeklySummary: boolean } | null;
  memberships: Membership[];
  currentTenantId: string | null;
  currentRole: MemberRole | null;
  csrfToken: string;
  /** Set by the client for a platform support agent inside an approved support session (no user account). */
  support?: boolean;
  /** Support sessions only: the agent's name and the approved session (AS01). */
  agentName?: string;
  supportSessionId?: string;
}

export interface SignInResponse {
  ok?: boolean;
  mfaRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  mfaToken?: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  country: string;
  default_locale: string;
  billing_email: string | null;
  tax_id: string | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  deletion_requested_at: string | null;
  complimentary: boolean;
}

export interface VenueListItem {
  id: string;
  name: string;
  venue_code: string;
  status: string;
}

export interface VenueAdmin {
  id: string;
  name: string;
  venueCode: string;
  venueUrl: string;
  timeZone: string;
  locales: string[];
  logoUrl: string | null;
  brandColor: string;
  messages: VenueMessages;
  settings: VenueSettings;
  resetTime: string;
  autoCloseTime: string;
  pendingResetTime: string | null;
  pendingAutoCloseTime: string | null;
  pendingFromDate: string | null;
  /** Applies from pendingFromDate, like the times (A13). */
  pendingTimeZone?: string | null;
  /** Street address shown to customers and on posters (FR-ADM-03, W10). */
  address?: VenueAddress | null;
  status: string;
}

export const ADDRESS_FIELDS = ['line1', 'line2', 'city', 'region', 'postcode', 'country'] as const;
export type VenueAddress = Partial<Record<(typeof ADDRESS_FIELDS)[number], string>>;

export type Reach = Record<'push' | 'live' | 'closed' | 'none', number>;

export interface TodayReport {
  businessDate: string;
  tickets: number;
  byStatus: Record<string, number>;
  open: number;
  alertReach: Reach;
  reachPushOrLivePct: number | null;
  acknowledgedPct: number | null;
  prepSecondsP50: number | null;
  pickupSecondsP50: number | null;
  /** Open tickets waiting longest, oldest first (FR-RPT-01). Older API responses may omit it. */
  longestWaiting?: WaitingTicket[];
  /** Tickets created in each local hour, index 0–23. Older API responses may omit the next four fields. */
  hourly?: number[];
  /** Preparation time by local hour of creation, only hours with ready tickets. */
  pace?: PaceHour[];
  /** Every open ticket (up to 40), oldest first. */
  openTickets?: WaitingTicket[];
  /** Minutes since local midnight at the venue. */
  localMinutes?: number;
  prepLabel: string;
}

export interface PaceHour {
  hour: number;
  tickets: number;
  p50: number | null;
  p90: number | null;
}

export interface WaitingTicket {
  id: string;
  displayNumber: string;
  status: string;
  createdAt: string;
  waitingSeconds: number;
}

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

export interface StaffAccess {
  link: string;
  keyRotatedAt: string;
  pinChangedAt: string;
}

export interface Device {
  id: string;
  name: string;
  mode: string;
  lastSeenAt: string;
  createdAt: string;
  userAgent: string;
}

export interface DisplayItem {
  id: string;
  name: string;
  /** Address to open on the TV. */
  url: string;
  paired: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  soundEnabled: boolean;
  /** null = all counters (R1.1). */
  counterIds: string[] | null;
  settings: DisplaySettings;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export interface Member {
  id: string;
  role: MemberRole;
  name: string;
  email: string;
  mfa: boolean;
  since: string;
}
export interface Invitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
}
export interface TeamList {
  members: Member[];
  invitations: Invitation[];
}

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
export type Period = 'month' | 'quarter' | 'year';
export interface Billing {
  status: TenantStatus;
  plan: { code: string; name: string };
  complimentary: boolean;
  trialEndsAt: string | null;
  paidUntil: string | null;
  graceEndsAt: string | null;
  payments: Payment[];
  prices: Array<{ plan: string; name: string; period: Period; currency: string; amountMinor: number }>;
  /** Public paid plans in catalogue order (W02). */
  plans?: BillingPlan[];
}

export interface BillingPlan {
  code: string;
  name: string;
  limits: { maxVenues: number; maxCountersPerVenue: number; maxLanguages: number; maxApiKeysPerVenue: number } & Record<string, number>;
  features: string[];
  prices: Array<{ period: Period; currency: string; amountMinor: number }>;
}

export interface ActivityItem {
  id: number;
  occurred_at: string;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
}

export interface InvitationDetails {
  email: string;
  role: MemberRole;
  tenantName: string;
  userExists: boolean;
}

// ---- R1.1

export interface Counter {
  id: string;
  name: string;
  prefix: string | null;
  sortOrder: number;
  archived: boolean;
}

export interface Rating {
  id: string;
  stars: number;
  comment: string | null;
  /** The owner removed the comment; the stars still count (A11). */
  commentDeleted?: boolean;
  createdAt: string;
  displayNumber: string;
  businessDate: string;
  venueId: string;
}

export type SupportStatus = 'requested' | 'active' | 'refused' | 'ended' | 'expired';
export interface SupportSession {
  id: string;
  status: SupportStatus;
  kind: string;
  reason: string;
  agentName: string;
  requestedAt: string;
  expiresAt: string | null;
  endedAt: string | null;
}

export interface TrendSummary {
  tickets: number;
  collected: number;
  cancelled: number;
  uncollected: number;
  reachPushOrLivePct: number | null;
  acknowledgedPct: number | null;
  repeatPct: number | null;
  undoPct: number | null;
  prepSecondsP50: number | null;
  pickupSecondsP50: number | null;
  totalSecondsP50: number | null;
  /** Cancellations by reason (BRD §12.1). */
  cancelReasons?: Record<string, number>;
  ratingAvg: number | null;
  ratingsCount: number;
}
export interface TrendsReport {
  from: string;
  to: string;
  prepLabel: string;
  current: TrendSummary;
  previous: TrendSummary & { from: string; to: string };
  series: Array<TrendSummary & { date: string }>;
}
export interface HeatmapReport {
  from: string;
  to: string;
  /** 7 rows (0 = Sunday) × 24 local hours. */
  grid: number[][];
}

/** A document the user must accept, exactly as recorded on acceptance (AS04): id, version, locale and content. */
export interface LegalPending {
  id: string;
  kind: 'terms' | 'privacy' | 'dpa';
  version: string;
  locale: string;
  publishedAt: string | null;
  html: string | null;
}

/** Average and distribution over every retained rating (`distribution[i]` = ratings of i + 1 stars). */
export interface RatingSummary {
  count: number;
  average: number | null;
  distribution: number[];
}

// ---- R2

export interface Chime {
  id: string;
  code: string;
  name: string;
  builtin: boolean;
  url: string | null;
  active: boolean;
  durationMs: number;
}


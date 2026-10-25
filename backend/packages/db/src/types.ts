import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AlertLevel,
  CancelReason,
  MemberRole,
  PlatformRole,
  TenantStatus,
  TicketActorType,
  TicketStatus,
} from '@dop/contracts';

// Table types for the schema in migrations/0001_initial.sql (TRD §7). Kept by hand until kysely-codegen
// runs against a live database in CI; a CI step diffs the generated file against this one.

type Ts = ColumnType<Date, Date | string | undefined, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T> = ColumnType<T, string, string>;
type JsonNull<T> = ColumnType<T | null, string | null | undefined, string | null>;
type Bool = ColumnType<boolean, boolean | number | undefined, boolean | number>;
type AutoId = Generated<number>;

export interface PlatformUsersTable {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: PlatformRole;
  status: Generated<'invited' | 'active' | 'disabled'>;
  totp_secret_enc: Buffer | null;
  mfa_enrolled_at: TsNull;
  last_sign_in_at: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlatformSessionsTable {
  id: string;
  platform_user_id: string;
  token_hash: string;
  mfa_verified_at: TsNull;
  ip: string;
  user_agent: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  expires_at: Ts;
  revoked_at: TsNull;
}

export interface PlansTable {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_public: Generated<boolean>;
  limits: Json<Record<string, number>>;
  features: Json<string[]>;
  sort_order: Generated<number>;
  archived_at: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlanPricesTable {
  id: string;
  plan_id: string;
  period: 'month' | 'quarter' | 'year';
  currency: string;
  amount_minor: number;
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface FeatureFlagsTable {
  flag_key: string;
  description: string;
  default_on: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface TenantFeatureOverridesTable {
  tenant_id: string;
  flag_key: string;
  enabled: Bool;
  set_by: string;
  set_at: Generated<Date>;
}

export interface PlatformSettingsTable {
  setting_key: string;
  value: Json<unknown>;
  updated_by: string | null;
  updated_at: Generated<Date>;
}

export interface ChimesTable {
  id: string;
  code: string;
  name: string;
  file_key: string;
  duration_ms: number;
  loudness_lufs: string;
  active: Generated<boolean>;
}

export interface LanguagesTable {
  code: string;
  name: string;
  direction: Generated<'ltr' | 'rtl'>;
  customer_enabled: Generated<boolean>;
  tts_lang: string | null;
}

export interface LegalDocumentsTable {
  id: string;
  kind: 'terms' | 'privacy' | 'dpa' | 'customer_privacy';
  version: string;
  locale: string;
  content_key: string;
  /** 'uploading' while the version is reserved and its content is being written (API02). */
  status: Generated<'uploading' | 'ready'>;
  created_at: Generated<Date>;
  published_at: TsNull;
}

export interface LegalAcceptancesTable {
  id: string;
  tenant_id: string;
  user_id: string;
  document_id: string;
  accepted_at: Generated<Date>;
  ip: string;
}

export interface AuditLogTable {
  id: AutoId;
  occurred_at: Generated<Date>;
  actor_type: 'platform_user' | 'user' | 'staff_device' | 'staff_member' | 'api_key' | 'system' | 'support';
  actor_id: string | null;
  tenant_id: string | null;
  support_session_id: string | null;
  purpose: 'support' | 'security' | 'billing' | 'legal' | 'operations' | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: JsonNull<unknown>;
  after_data: JsonNull<unknown>;
  visible_to_tenant: Bool;
  ip: string | null;
  request_id: string | null;
}

export interface TenantNotesTable {
  id: string;
  tenant_id: string;
  author_id: string;
  body: string;
  created_at: Generated<Date>;
}

export interface SupportSessionsTable {
  id: string;
  tenant_id: string;
  platform_user_id: string;
  reason: string;
  kind: Generated<'approved' | 'emergency'>;
  status: 'requested' | 'active' | 'refused' | 'ended' | 'expired' | 'cancelled';
  approval_code_hash: string | null;
  decided_by_user_id: string | null;
  duration_minutes: Generated<number>;
  requested_at: Generated<Date>;
  decided_at: TsNull;
  expires_at: TsNull;
  ended_at: TsNull;
  ended_by: 'platform' | 'tenant' | 'system' | null;
}

export interface TenantsTable {
  id: string;
  name: string;
  slug: string;
  previous_slug: string | null;
  slug_changed_at: TsNull;
  status: Generated<TenantStatus>;
  status_reason: string | null;
  suspended_by: 'billing' | 'platform' | null;
  plan_id: string;
  complimentary: Generated<boolean>;
  trial_ends_at: TsNull;
  paid_until: TsNull;
  plan_starts_at: TsNull;
  past_due_since: TsNull;
  grace_ends_at: TsNull;
  suspended_at: TsNull;
  cancelled_at: TsNull;
  deletion_requested_at: TsNull;
  purge_after: TsNull;
  deleted_at: TsNull;
  country: string;
  default_locale: string;
  billing_email: string | null;
  tax_id: string | null;
  status_before_suspension: 'trial' | 'active' | 'past_due' | null;
  last_activity_at: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: string;
  email: string;
  email_verified_at: TsNull;
  name: string;
  password_hash: string | null;
  locale: Generated<string>;
  totp_secret_enc: Buffer | null;
  mfa_enrolled_at: TsNull;
  disabled_at: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenantMembershipsTable {
  id: string;
  tenant_id: string;
  user_id: string;
  role: MemberRole;
  status: Generated<'active' | 'removed'>;
  weekly_summary: Generated<boolean>;
  owner_key: ColumnType<string | null, never, never>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvitationsTable {
  id: string;
  tenant_id: string;
  email: string;
  role: MemberRole;
  token_hash: string;
  invited_by_type: 'user' | 'platform_user';
  invited_by: string;
  expires_at: Ts;
  accepted_at: TsNull;
  revoked_at: TsNull;
  created_at: Generated<Date>;
}

export interface UserSessionsTable {
  id: string;
  user_id: string;
  tenant_id: string | null;
  host: string;
  token_hash: string;
  mfa_verified_at: TsNull;
  /** When the user last proved who they are; a handoff copies it from the www session (0010). */
  authenticated_at: TsNull;
  ip: string;
  user_agent: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  expires_at: Ts;
  revoked_at: TsNull;
}

export interface EmailTokensTable {
  id: string;
  user_id: string;
  purpose: 'verify_email' | 'reset_password' | 'change_email';
  token_hash: string;
  new_email: string | null;
  expires_at: Ts;
  used_at: TsNull;
  created_at: Generated<Date>;
}

export interface VenuesTable {
  id: string;
  tenant_id: string;
  name: string;
  venue_code: string;
  address: JsonNull<Record<string, string>>;
  time_zone: string;
  locales: Json<string[]>;
  logo_key: string | null;
  brand_color: Generated<string>;
  messages: Json<Record<string, Record<string, string>>>;
  settings: Json<unknown>;
  reset_time: Generated<string>;
  pending_reset_time: string | null;
  pending_auto_close_time: string | null;
  pending_time_zone: string | null;
  pending_from_date: ColumnType<string | null, string | null | undefined, string | null>;
  auto_close_time: Generated<string>;
  next_auto_close_at: Ts;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CountersTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  prefix: string | null;
  sort_order: Generated<number>;
  archived_at: TsNull;
  created_at: Generated<Date>;
}

export interface NumberSequencesTable {
  tenant_id: string;
  venue_id: string;
  sequence_key: string;
  business_date: ColumnType<string, string, string>;
  last_number: Generated<number>;
}

export interface StaffAccessTable {
  venue_id: string;
  tenant_id: string;
  staff_key_enc: Buffer;
  staff_key_hash: string;
  pin_hash: string;
  key_rotated_at: Ts;
  pin_changed_at: Ts;
}

export interface StaffDevicesTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  mode: Generated<'board' | 'kitchen'>;
  session_hash: string;
  user_agent: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  active_until: Ts;
  revoked_at: TsNull;
  revoked_reason: 'removed' | 'link_reset' | 'pin_changed' | 'expired' | 'platform' | null;
}

export interface DisplaysTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  counter_ids: JsonNull<string[]>;
  sound_enabled: boolean | null;
  settings: Json<unknown>;
  session_hash: string | null;
  paired_at: TsNull;
  last_seen_at: TsNull;
  revoked_at: TsNull;
  created_at: Generated<Date>;
}

export interface TicketsTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  counter_id: string | null;
  business_date: ColumnType<string, string, string>;
  number: number;
  display_number: string;
  token: string;
  check_code: string;
  claim_code: string;
  status: TicketStatus;
  version: Generated<number>;
  seq: Generated<number>;
  ready_round: Generated<number>;
  source: 'staff' | 'api' | 'connector';
  note: string | null;
  external_ref: string | null;
  wait_minutes: number | null;
  wait_base_at: TsNull;
  alert_level: Generated<AlertLevel>;
  alert_level_at_ready: AlertLevel | null;
  acknowledged_at: TsNull;
  auto_alerts_sent: Generated<number>;
  manual_alerts_sent: Generated<number>;
  /** Ready round the overdue-flag job marked "call out" (0009, CSD07); current only while it equals ready_round. */
  overdue_round: number | null;
  cancel_reason: CancelReason | null;
  cancel_note: string | null;
  created_at: Generated<Date>;
  received_at: TsNull;
  preparing_at: TsNull;
  ready_at: TsNull;
  first_ready_at: TsNull;
  collected_at: TsNull;
  cancelled_at: TsNull;
  expired_at: TsNull;
  updated_at: Generated<Date>;
  open_number_key: ColumnType<string | null, never, never>;
  open_external_ref: ColumnType<string | null, never, never>;
}

export interface TicketEventsTable {
  id: AutoId;
  tenant_id: string;
  ticket_id: string;
  type:
    | 'created'
    | 'transition'
    | 'acknowledged'
    | 'alert_auto'
    | 'alert_manual'
    | 'wait_changed'
    | 'note_changed'
    | 'follower_joined'
    | 'claim_requested'
    | 'claim_decided'
    | 'alert_level_changed'
    | 'rated';
  from_status: TicketStatus | null;
  to_status: TicketStatus | null;
  actor_type: TicketActorType;
  actor_id: string | null;
  data: JsonNull<Record<string, unknown>>;
  occurred_at: Generated<Date>;
}

export interface PushSubscriptionsTable {
  id: string;
  client_id: string;
  endpoint: string;
  endpoint_hash: string;
  p256dh: string;
  auth: string;
  push_service: 'fcm' | 'apns' | 'mozilla' | 'wns' | 'other';
  ua_family: string;
  created_at: Generated<Date>;
  last_success_at: TsNull;
  failure_count: Generated<number>;
  revoked_at: TsNull;
}

export interface TicketFollowersTable {
  id: string;
  tenant_id: string;
  ticket_id: string;
  client_id: string;
  push_subscription_id: string | null;
  joined_via: 'ticket_qr' | 'link' | 'claim_code' | 'staff_approval' | 'home_screen';
  locale: string;
  ua_family: string;
  alerts_enabled_at: TsNull;
  created_at: Generated<Date>;
}

export interface RatingsTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  ticket_id: string;
  stars: number;
  comment: string | null;
  comment_deleted_at: TsNull;
  created_at: Generated<Date>;
  deleted_at: TsNull;
}

export interface ClaimRequestsTable {
  id: string;
  tenant_id: string;
  ticket_id: string;
  client_id: string;
  status: Generated<'pending' | 'approved' | 'refused' | 'expired'>;
  decided_by: string | null;
  created_at: Generated<Date>;
  decided_at: TsNull;
}

export interface TenantPaymentsTable {
  id: string;
  tenant_id: string;
  amount_minor: number;
  currency: string;
  months: number;
  method: 'cash' | 'bank_transfer' | 'wallet' | 'other';
  reference: string | null;
  note: string | null;
  covers_from: Ts;
  covers_until: Ts;
  recorded_by: string | null;
  /** The console request that recorded it; a repeated request is applied once (0007, BW02). */
  request_id: string | null;
  recorded_at: Generated<Date>;
}

export interface OutboxTable {
  id: AutoId;
  tenant_id: string | null;
  topic: string;
  payload: Json<Record<string, unknown>>;
  created_at: Generated<Date>;
  event_published_at: TsNull;
  published_at: TsNull;
  /** Dead-lettered after OUTBOX_MAX_ATTEMPTS failures (L-18, migration 0005); the relay skips parked rows. */
  parked_at: TsNull;
  attempts: Generated<number>;
  next_attempt_at: TsNull;
  last_error: string | null;
}

export interface AlertAttemptsTable {
  tenant_id: string;
  ticket_id: string;
  round: number;
  attempt: string;
  live_published_at: TsNull;
  created_at: Generated<Date>;
}

export interface AlertDeliveriesTable {
  tenant_id: string;
  ticket_id: string;
  round: number;
  attempt: string;
  subscription_id: string;
  outcome: 'sent' | 'retry' | 'gone';
  tries: Generated<number>;
  status_code: number | null;
  updated_at: Generated<Date>;
}

export interface TenantSlugAliasesTable {
  slug: string;
  tenant_id: string;
  created_at: Generated<Date>;
  expires_at: Ts;
}

export interface DataExportsTable {
  id: string;
  tenant_id: string;
  requested_by: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  file_key: string | null;
  size_bytes: number | null;
  expires_at: TsNull;
  created_at: Generated<Date>;
}

export interface ReportDailyTable {
  tenant_id: string;
  venue_id: string;
  counter_key: string;
  business_date: ColumnType<string, string, string>;
  hour_local: number;
  tickets_created: number;
  tickets_collected: number;
  tickets_cancelled: number;
  tickets_expired: number;
  tickets_expired_uncollected_ready: number;
  prep_seconds_p50: number | null;
  prep_seconds_p90: number | null;
  pickup_seconds_p50: number | null;
  pickup_seconds_p90: number | null;
  total_seconds_p50: number | null;
  reach_push: number;
  reach_live: number;
  reach_closed: number;
  reach_none: number;
  acknowledged: number;
  needed_repeat: number;
  ready_undone: number;
  ratings_count: number;
  ratings_sum: number;
  rating_dist: Json<number[]>;
  prep_hist: Json<number[]>;
  pickup_hist: Json<number[]>;
  total_hist: Json<number[]>;
  cancel_reasons: Json<Record<string, number>>;
  ua_reach: Json<Record<string, Record<string, number>>>;
}


export interface UserIdentitiesTable {
  id: string;
  user_id: string;
  provider: 'google' | 'apple';
  subject: string;
  created_at: Generated<Date>;
}

export interface StaffMembersTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  pin_hash: string;
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface ApiKeysTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  key_prefix: string;
  secret_hash: string;
  created_by: string;
  created_at: Generated<Date>;
  last_used_at: TsNull;
  revoked_at: TsNull;
}

export interface IdempotencyKeysTable {
  tenant_id: string;
  api_key_id: string;
  idem_key: string;
  request_hash: string;
  status_code: number | null;
  response_body: JsonNull<unknown>;
  created_at: Generated<Date>;
}

export interface WebhookEndpointsTable {
  id: string;
  tenant_id: string;
  venue_id: string | null;
  url: string;
  events: Json<string[]>;
  secret_enc: Buffer;
  secret_next_enc: Buffer | null;
  secret_rotated_at: TsNull;
  status: Generated<'active' | 'disabled'>;
  disabled_reason: 'manual' | 'failing' | null;
  failure_streak: Generated<number>;
  /** Re-enabled at: older failures no longer count towards disabling the endpoint (0007, BW01). */
  health_since: TsNull;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WebhookDeliveriesTable {
  id: AutoId;
  tenant_id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  /** true for the fan-out delivery of an event (one per endpoint, uq_original); null for a redelivery (0007, BW09). */
  is_original: Generated<boolean | null>;
  payload: Json<unknown>;
  attempt: Generated<number>;
  status: Generated<'pending' | 'succeeded' | 'failed' | 'abandoned'>;
  response_code: number | null;
  response_ms: number | null;
  error: string | null;
  next_attempt_at: TsNull;
  created_at: Generated<Date>;
}

export interface PosConnectionsTable {
  id: string;
  tenant_id: string;
  venue_id: string;
  provider: string;
  external_location_id: string;
  credentials_enc: Buffer;
  status: 'connected' | 'error' | 'disconnected';
  settings: Json<unknown>;
  last_sync_at: TsNull;
  created_at: Generated<Date>;
}

export interface Database {
  platform_users: PlatformUsersTable;
  platform_sessions: PlatformSessionsTable;
  plans: PlansTable;
  plan_prices: PlanPricesTable;
  feature_flags: FeatureFlagsTable;
  tenant_feature_overrides: TenantFeatureOverridesTable;
  platform_settings: PlatformSettingsTable;
  chimes: ChimesTable;
  languages: LanguagesTable;
  legal_documents: LegalDocumentsTable;
  legal_acceptances: LegalAcceptancesTable;
  audit_log: AuditLogTable;
  tenant_notes: TenantNotesTable;
  support_sessions: SupportSessionsTable;
  tenants: TenantsTable;
  users: UsersTable;
  tenant_memberships: TenantMembershipsTable;
  invitations: InvitationsTable;
  user_sessions: UserSessionsTable;
  email_tokens: EmailTokensTable;
  venues: VenuesTable;
  counters: CountersTable;
  number_sequences: NumberSequencesTable;
  staff_access: StaffAccessTable;
  staff_devices: StaffDevicesTable;
  displays: DisplaysTable;
  tickets: TicketsTable;
  ticket_events: TicketEventsTable;
  push_subscriptions: PushSubscriptionsTable;
  ticket_followers: TicketFollowersTable;
  ratings: RatingsTable;
  claim_requests: ClaimRequestsTable;
  tenant_payments: TenantPaymentsTable;
  outbox: OutboxTable;
  data_exports: DataExportsTable;
  report_daily: ReportDailyTable;
  user_identities: UserIdentitiesTable;
  staff_members: StaffMembersTable;
  api_keys: ApiKeysTable;
  idempotency_keys: IdempotencyKeysTable;
  webhook_endpoints: WebhookEndpointsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  pos_connections: PosConnectionsTable;
  alert_attempts: AlertAttemptsTable;
  alert_deliveries: AlertDeliveriesTable;
  tenant_slug_aliases: TenantSlugAliasesTable;
}

export type Tenant = Selectable<TenantsTable>;
export type Venue = Selectable<VenuesTable>;
export type Ticket = Selectable<TicketsTable>;
export type NewTicket = Insertable<TicketsTable>;
export type TicketUpdate = Updateable<TicketsTable>;
export type User = Selectable<UsersTable>;
export type Membership = Selectable<TenantMembershipsTable>;
export type StaffDevice = Selectable<StaffDevicesTable>;
export type Display = Selectable<DisplaysTable>;
export type PlatformUser = Selectable<PlatformUsersTable>;

import {
  BUILTIN_CHIMES,
  chimeAudioKey,
  displaySettingsSchema,
  venueMessagesSchema,
  venueSettingsSchema,
  type DisplaySettings,
  type DisplayTicket,
  type PublicTicket,
  type StaffTicket,
  type TenantStatus,
  type VenueBranding,
  type VenueMessages,
  type VenueSettings,
} from '@dop/contracts';
import type { Ticket, Venue } from '@dop/db';
import { waitRemaining } from '@dop/domain';
import { urls, type ServiceConfig } from './deps.js';

// Ticket projections (appendix 30.8). Settings JSON is re-validated on read so defaults always apply.

export interface LoadedVenue {
  row: Venue;
  settings: VenueSettings;
  messages: VenueMessages;
  locales: string[];
}

export function loadVenueRow(row: Venue): LoadedVenue {
  return {
    row,
    settings: venueSettingsSchema.parse(row.settings ?? {}),
    messages: venueMessagesSchema.parse(row.messages ?? {}),
    locales: row.locales as unknown as string[],
  };
}

export function branding(c: ServiceConfig, v: LoadedVenue, opts: { removePoweredBy?: boolean } = {}): VenueBranding {
  return {
    name: v.row.name,
    venueCode: v.row.venue_code,
    logoUrl: urls(c).logo(v.row.logo_key),
    brandColor: v.row.brand_color,
    locales: v.locales,
    timeZone: v.row.time_zone,
    messages: v.messages,
    showPoweredBy: opts.removePoweredBy ? v.settings.customer.showPoweredBy : true,
    chime: v.settings.alerts.chime,
    chimeUrl: (BUILTIN_CHIMES as readonly string[]).includes(v.settings.alerts.chime) ? null : `${c.cdnBaseUrl}/${chimeAudioKey(v.settings.alerts.chime)}`,
    liveLoopSeconds: v.settings.alerts.liveLoopSeconds,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function publicTicket(
  c: ServiceConfig,
  t: Ticket,
  v: LoadedVenue,
  extra: { counterName: string | null; tenantStatus: TenantStatus; rated: boolean; now: Date; removePoweredBy?: boolean },
): PublicTicket {
  const w = t.status === 'received' || t.status === 'preparing' ? waitRemaining(t.wait_minutes, t.wait_base_at, extra.now) : { remainingMinutes: null, overdue: false };
  return {
    token: t.token,
    displayNumber: t.display_number,
    status: t.status,
    version: t.version,
    seq: t.seq,
    counterName: extra.counterName,
    waitRemainingMinutes: w.remainingMinutes,
    waitOverdue: w.overdue,
    acknowledged: t.acknowledged_at !== null,
    checkCode: t.status === 'ready' && v.settings.checkCode !== 'off' ? t.check_code : null,
    ratingAllowed: t.status === 'collected' && !extra.rated,
    readyRound: t.ready_round,
    collectedAt: t.status === 'collected' ? (t.collected_at?.toISOString() ?? null) : null,
    cancelReason: t.status === 'cancelled' ? t.cancel_reason : null,
    tenantStatus: extra.tenantStatus,
    reviewLinkUrl: t.status === 'collected' ? v.settings.customer.reviewLinkUrl : null,
    venue: branding(c, v, { removePoweredBy: extra.removePoweredBy }),
  };
}

export function staffTicket(t: Ticket, lastChangedBy: string | null = null): StaffTicket {
  return {
    id: t.id,
    token: t.token,
    displayNumber: t.display_number,
    number: t.number,
    status: t.status,
    version: t.version,
    seq: t.seq,
    counterId: t.counter_id,
    note: t.note,
    externalRef: t.external_ref,
    waitMinutes: t.wait_minutes,
    waitBaseAt: iso(t.wait_base_at),
    alertLevel: t.alert_level,
    acknowledgedAt: iso(t.acknowledged_at),
    checkCode: t.check_code,
    claimCode: t.claim_code,
    readyRound: t.ready_round,
    autoAlertsSent: t.auto_alerts_sent,
    manualAlertsSent: t.manual_alerts_sent,
    overdueRound: t.overdue_round ?? null,
    source: t.source,
    createdAt: t.created_at.toISOString(),
    readyAt: iso(t.ready_at),
    collectedAt: iso(t.collected_at),
    closedAt: iso(t.collected_at ?? t.cancelled_at ?? t.expired_at),
    businessDate: t.business_date,
    cancelReason: t.cancel_reason,
    lastChangedBy,
  };
}

export function displayTicket(t: Ticket): DisplayTicket {
  return { id: t.id, displayNumber: t.display_number, status: t.status, version: t.version, seq: t.seq, counterId: t.counter_id, readyAt: iso(t.ready_at) };
}

export const parseDisplaySettings = (raw: unknown): DisplaySettings => displaySettingsSchema.parse(raw ?? {});

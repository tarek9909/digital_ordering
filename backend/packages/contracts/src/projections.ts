import type { AlertLevel, CancelReason, TenantStatus, TicketStatus } from './enums.js';
import type { DisplaySettings, VenueMessages } from './settings.js';

// Ticket projections (TRD appendix 30.8). The server builds these; clients only render them.

export interface VenueBranding {
  name: string;
  venueCode: string;
  logoUrl: string | null;
  brandColor: string;
  locales: string[];
  timeZone: string;
  messages: VenueMessages;
  showPoweredBy: boolean;
  chime: string;
  /** Audio file of an uploaded chime; null for the built-in chimes, which the apps synthesise (W11). */
  chimeUrl: string | null;
  liveLoopSeconds: number;
}

export interface PublicTicket {
  token: string;
  displayNumber: string;
  status: TicketStatus;
  version: number;
  seq: number;
  counterName: string | null;
  waitRemainingMinutes: number | null;
  waitOverdue: boolean;
  acknowledged: boolean;
  checkCode: string | null;
  ratingAllowed: boolean;
  readyRound: number;
  /** Server time of collection; the 30-minute reopen window counts from it. */
  collectedAt: string | null;
  cancelReason: CancelReason | null;
  tenantStatus: TenantStatus;
  /** Shown after rating, to every rating customer (FR-RPT-09). */
  reviewLinkUrl: string | null;
  venue: VenueBranding;
}

export interface StaffTicket {
  id: string;
  token: string;
  displayNumber: string;
  number: number;
  status: TicketStatus;
  version: number;
  seq: number;
  counterId: string | null;
  note: string | null;
  externalRef: string | null;
  waitMinutes: number | null;
  waitBaseAt: string | null;
  alertLevel: AlertLevel;
  acknowledgedAt: string | null;
  checkCode: string;
  claimCode: string;
  readyRound: number;
  autoAlertsSent: number;
  manualAlertsSent: number;
  source: 'staff' | 'api' | 'connector';
  createdAt: string;
  readyAt: string | null;
  collectedAt: string | null;
  /** When the ticket was collected, cancelled or expired; null while open. */
  closedAt: string | null;
  /** The venue business date the ticket belongs to. */
  businessDate: string;
  cancelReason: CancelReason | null;
  lastChangedBy: string | null;
}

export interface DisplayTicket {
  id: string;
  displayNumber: string;
  status: TicketStatus;
  version: number;
  seq: number;
  counterId: string | null;
  readyAt: string | null;
}

export interface DisplayBoard {
  venue: VenueBranding;
  settings: DisplaySettings;
  counterIds: string[] | null;
  venueUrl: string;
  tenantStatus: TenantStatus;
  ready: DisplayTicket[];
  preparing: DisplayTicket[];
  /** Speech voice per customer language, from the platform's language list (FR-SA-12). */
  voices: Record<string, string>;
  serverTime: string;
}

export interface StaffBoard {
  venue: VenueBranding & { id: string; settings: unknown };
  device: { id: string | null; name: string; mode: 'board' | 'kitchen' } | null;
  counters: Array<{ id: string; name: string; prefix: string | null }>;
  open: StaffTicket[];
  recent: StaffTicket[];
  pendingClaims: Array<{ claimId: string; displayNumber: string; ticketId: string; createdAt: string }>;
  /** Tickets collected on the venue's current business date (FR-STF-01). */
  collectedToday: number;
  businessDate: string;
  tenantStatus: TenantStatus;
  serverTime: string;
}

export interface IntegrationTicket extends Omit<StaffTicket, 'token' | 'checkCode' | 'lastChangedBy' | 'closedAt' | 'businessDate'> {
  ticketUrl: string;
  firstReadyAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

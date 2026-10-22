import type { AlertLevel, CancelReason, TicketActorType, TicketStatus } from '@dop/contracts';
import { normaliseCode } from './codes.js';

// Ticket state machine (TRD §8.1). Front ends use `allowedTargets` only to choose buttons; the server is the authority.

export const REOPEN_WINDOW_MS = 30 * 60_000; // BR-22
export type CheckCodeMode = 'off' | 'optional' | 'mandatory';

type Actor = Exclude<TicketActorType, 'customer'>;
const STAFFLIKE: Actor[] = ['staff_device', 'user', 'support', 'api_key'];

interface Rule {
  from: TicketStatus;
  to: TicketStatus;
  actors: Actor[];
}

export const TICKET_TRANSITIONS: Rule[] = [
  { from: 'received', to: 'preparing', actors: STAFFLIKE },
  { from: 'preparing', to: 'ready', actors: STAFFLIKE },
  { from: 'received', to: 'ready', actors: STAFFLIKE },
  { from: 'ready', to: 'preparing', actors: STAFFLIKE },
  { from: 'ready', to: 'collected', actors: [...STAFFLIKE, 'staff_member'] },
  { from: 'collected', to: 'ready', actors: ['staff_device', 'user', 'support'] },
  { from: 'received', to: 'cancelled', actors: STAFFLIKE },
  { from: 'preparing', to: 'cancelled', actors: STAFFLIKE },
  { from: 'ready', to: 'cancelled', actors: STAFFLIKE },
  { from: 'received', to: 'expired', actors: ['system'] },
  { from: 'preparing', to: 'expired', actors: ['system'] },
  { from: 'ready', to: 'expired', actors: ['system'] },
];

export const isOpen = (s: TicketStatus) => s === 'received' || s === 'preparing' || s === 'ready';

export function allowedTargets(from: TicketStatus, actor: Actor): TicketStatus[] {
  return TICKET_TRANSITIONS.filter((r) => r.from === from && r.actors.includes(actor)).map((r) => r.to);
}

export interface TransitionInput {
  from: TicketStatus;
  to: TicketStatus;
  actor: Actor;
  now: Date;
  collectedAt: Date | null;
  checkCodeMode: CheckCodeMode;
  ticketCheckCode: string;
  suppliedCheckCode?: string;
  cancelReason?: CancelReason;
  /** Requests from the integration API are exempt from mandatory check codes (BR-15). */
  viaIntegrationApi?: boolean;
}

export type TransitionVerdict =
  | { ok: true; idempotent: true }
  | { ok: true; idempotent: false }
  | { ok: false; code: 'INVALID_TRANSITION' | 'REOPEN_WINDOW_PASSED' | 'CHECK_CODE_REQUIRED' | 'CHECK_CODE_INVALID' | 'VALIDATION_FAILED'; detail: string };

export function checkTransition(i: TransitionInput): TransitionVerdict {
  if (i.from === i.to) return { ok: true, idempotent: true }; // TR-TKT-02
  const rule = TICKET_TRANSITIONS.find((r) => r.from === i.from && r.to === i.to);
  if (!rule || !rule.actors.includes(i.actor)) {
    return { ok: false, code: 'INVALID_TRANSITION', detail: `Cannot change ${i.from} to ${i.to}` };
  }
  if (i.to === 'cancelled' && !i.cancelReason) {
    return { ok: false, code: 'VALIDATION_FAILED', detail: 'cancelReason is required' };
  }
  if (i.from === 'collected' && i.to === 'ready') {
    if (!i.collectedAt || i.now.getTime() - i.collectedAt.getTime() > REOPEN_WINDOW_MS) {
      return { ok: false, code: 'REOPEN_WINDOW_PASSED', detail: 'Over 30 minutes since collection' };
    }
  }
  if (i.to === 'collected' && i.checkCodeMode !== 'off' && !i.viaIntegrationApi) {
    if (i.suppliedCheckCode) {
      if (normaliseCode(i.suppliedCheckCode) !== i.ticketCheckCode) {
        return { ok: false, code: 'CHECK_CODE_INVALID', detail: 'Check code does not match' };
      }
    } else if (i.checkCodeMode === 'mandatory') {
      return { ok: false, code: 'CHECK_CODE_REQUIRED', detail: 'Ask the customer for the check code' };
    }
  }
  return { ok: true, idempotent: false };
}

export interface TicketTimes {
  status: TicketStatus;
  readyRound: number;
  preparingAt: Date | null;
  readyAt: Date | null;
  firstReadyAt: Date | null;
  collectedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  acknowledgedAt: Date | null;
  autoAlertsSent: number;
  alertLevel: AlertLevel;
  alertLevelAtReady: AlertLevel | null;
}

export type TransitionKind = 'normal' | 'undo' | 'reopen' | 'cancel' | 'expire';

export interface TransitionEffects {
  patch: Partial<TicketTimes> & { cancelReason?: CancelReason | null; cancelNote?: string | null };
  kind: TransitionKind;
  /** Enqueue the first push and repeat alerts (preparing/received → ready, not on reopen). */
  startAlerts: boolean;
  /** Repeats become no-ops (their round no longer matches or status changed). */
  stopsAlerts: boolean;
  webhook: 'ticket.ready' | 'ticket.collected' | 'ticket.cancelled' | 'ticket.expired' | null;
}

/** Side effects of a valid, non-idempotent transition (§8.1 "Side effects" column). */
export function transitionEffects(
  t: TicketTimes,
  to: TicketStatus,
  now: Date,
  extra?: { cancelReason?: CancelReason; cancelNote?: string },
): TransitionEffects {
  const from = t.status;
  const patch: TransitionEffects['patch'] = { status: to };
  let kind: TransitionKind = 'normal';
  let startAlerts = false;
  let stopsAlerts = false;
  let webhook: TransitionEffects['webhook'] = null;

  if (to === 'preparing') {
    if (from === 'ready') {
      kind = 'undo';
      stopsAlerts = true;
    } else {
      patch.preparingAt = now;
    }
  } else if (to === 'ready') {
    patch.readyAt = now;
    patch.readyRound = t.readyRound + 1;
    patch.autoAlertsSent = 0;
    patch.acknowledgedAt = null;
    patch.alertLevelAtReady = t.alertLevel;
    if (!t.firstReadyAt) patch.firstReadyAt = now;
    if (from === 'collected') {
      kind = 'reopen';
      patch.collectedAt = null;
    } else {
      startAlerts = true;
      webhook = 'ticket.ready';
    }
  } else if (to === 'collected') {
    patch.collectedAt = now;
    stopsAlerts = true;
    webhook = 'ticket.collected';
  } else if (to === 'cancelled') {
    patch.cancelledAt = now;
    patch.cancelReason = extra?.cancelReason ?? null;
    patch.cancelNote = extra?.cancelNote ?? null;
    kind = 'cancel';
    stopsAlerts = true;
    webhook = 'ticket.cancelled';
  } else if (to === 'expired') {
    patch.expiredAt = now;
    kind = 'expire';
    stopsAlerts = true;
    webhook = 'ticket.expired';
  }
  return { patch, kind, startAlerts, stopsAlerts, webhook };
}

/** Customer actions (TR-TKT-03). */
export function canAcknowledge(status: TicketStatus, acknowledgedAt: Date | null): 'ok' | 'idempotent' | 'invalid' {
  if (status !== 'ready') return 'invalid';
  return acknowledgedAt ? 'idempotent' : 'ok';
}

export const canRate = (status: TicketStatus, alreadyRated: boolean) => status === 'collected' && !alreadyRated;

/** Automatic repeat schedule (TR-ALR-19): offsets in seconds, limited to maxAutoAlerts − 1 repeats. */
export function repeatSchedule(offsetsSec: number[], maxAutoAlerts: number): number[] {
  return offsetsSec.slice(0, Math.max(0, maxAutoAlerts - 1));
}

/** Time at which the board marks a ready ticket "not collected — call out" (TR-ALR-21). */
export function overdueAfterSec(offsetsSec: number[], maxAutoAlerts: number): number {
  const s = repeatSchedule(offsetsSec, maxAutoAlerts);
  return (s.length ? s[s.length - 1]! : 0) + 60;
}

export const MANUAL_ALERT_MIN_INTERVAL_MS = 15_000; // TR-ALR-22

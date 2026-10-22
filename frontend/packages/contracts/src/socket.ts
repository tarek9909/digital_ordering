// GENERATED from backend/packages/contracts/src by `npm run sync:contracts` in backend/. Do not edit.
import { z } from 'zod';
import type { TenantStatus } from './enums.js';
import type { DisplayTicket, PublicTicket, StaffTicket } from './projections.js';
import { tokenParam } from './api.js';

// Socket.IO message catalogue (TRD §10.3).

export type TicketChange = 'status' | 'wait' | 'alert_level' | 'ack' | 'note' | 'created' | 'follow';
export type TicketChangeReason = 'undo' | 'reopen' | 'cancel' | 'expire';

export interface ServerToClientEvents {
  'ticket.created': (p: { staff?: StaffTicket; display?: DisplayTicket }) => void;
  'ticket.updated': (p: {
    ticket: PublicTicket | StaffTicket | DisplayTicket;
    change: TicketChange;
    reason?: TicketChangeReason;
    actor?: string | null;
  }) => void;
  'ticket.alert': (p: { token?: string; id?: string; displayNumber?: string; round: number; attempt: number; manual: boolean }) => void;
  'ticket.followed': (p: { id: string }) => void;
  'ticket.overdue': (p: { id: string; round: number }) => void;
  'app.version': (p: { app: string; version: string; mandatory: boolean }) => void;
  'claim.requested': (p: { claimId: string; displayNumber: string; createdAt: string }) => void;
  'claim.decided': (p: { claimId: string; status: 'approved' | 'refused' | 'expired'; ticketToken?: string }) => void;
  'venue.settings_changed': (p: Record<string, unknown>) => void;
  'tenant.status_changed': (p: { status: TenantStatus }) => void;
  'device.revoked': (p: Record<string, never>) => void;
  'support.session': (p: { active: boolean; agentName: string | null; expiresAt: string | null }) => void;
  'resync.required': (p: Record<string, never>) => void;
}

export const presenceHeartbeatPayload = z.object({ tokens: z.array(tokenParam).max(20), visible: z.boolean() }).strict();
export const acknowledgePayload = z.object({ token: tokenParam }).strict();
export const displayHeartbeatPayload = z.object({ soundEnabled: z.boolean() }).strict();

export interface ClientToServerEvents {
  'presence.heartbeat': (p: z.infer<typeof presenceHeartbeatPayload>, ack: (r: { ok: boolean }) => void) => void;
  'ticket.acknowledge': (p: z.infer<typeof acknowledgePayload>, ack: (r: { ok: boolean }) => void) => void;
  'display.heartbeat': (p: z.infer<typeof displayHeartbeatPayload>, ack: (r: { ok: boolean }) => void) => void;
  'alert.delivered': (p: { token: string; round: number; attempt: number }, ack: (r: { ok: boolean }) => void) => void;
}

/** Outbox / event-bus envelope (TR-EVT-01, TR-EVT-02). Payloads carry full projections so fan-out needs no DB read. */
export interface BusEvent {
  outboxId: number;
  topic:
    | 'ticket.created'
    | 'ticket.updated'
    | 'ticket.alert'
    | 'ticket.followed'
    | 'ticket.overdue'
    | 'tenant.status_changed'
    | 'venue.settings_changed'
    | 'device.revoked'
    | 'display.revoked'
    | 'claim.requested'
    | 'claim.decided'
    | 'support.session'
    /** Internal (H-7): re-check board sockets of `payload.userId` / `payload.sessionId`; never sent to clients. */
    | 'user.revalidate';
  tenantId: string | null;
  venueId?: string;
  ticketId?: string;
  token?: string;
  payload: Record<string, unknown>;
}

export const SOCKET_PATH = '/rt/';

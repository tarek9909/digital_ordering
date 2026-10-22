import type { MemberRole, PlatformRole } from '@dop/contracts';

// Request / socket / job context (TR-TEN-01): created by authentication middleware from trusted
// credentials only, frozen, never built from request parameters.

export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string; tenantId: string; role: MemberRole; sessionId: string; mfaVerified: boolean }
  | { kind: 'support'; platformUserId: string; tenantId: string; supportSessionId: string; agentName: string }
  | { kind: 'staff_device'; deviceId: string; tenantId: string; venueId: string; deviceName: string; member?: { id: string; name: string } }
  | { kind: 'display'; displayId: string; tenantId: string; venueId: string }
  | { kind: 'platform'; platformUserId: string; role: PlatformRole; sessionId: string; mfaVerifiedAt: Date | null }
  | { kind: 'api_key'; apiKeyId: string; tenantId: string; venueId: string }
  | { kind: 'system' };

export type TenantActor = Extract<Actor, { tenantId: string }>;

export const tenantOf = (a: Actor): string | null => ('tenantId' in a ? a.tenantId : null);

export const freezeActor = <T extends Actor>(a: T): Readonly<T> => Object.freeze({ ...a });

/** actor_type / actor_id as written to ticket_events and audit_log. */
export function actorRef(a: Actor): { type: 'user' | 'support' | 'staff_device' | 'api_key' | 'system' | 'platform_user'; id: string | null } {
  switch (a.kind) {
    case 'user':
      return { type: 'user', id: a.userId };
    case 'support':
      return { type: 'support', id: a.platformUserId };
    case 'staff_device':
      return { type: 'staff_device', id: a.deviceId };
    case 'api_key':
      return { type: 'api_key', id: a.apiKeyId };
    case 'platform':
      return { type: 'platform_user', id: a.platformUserId };
    default:
      return { type: 'system', id: null };
  }
}

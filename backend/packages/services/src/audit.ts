import type { Actor } from '@dop/auth';
import type { AuditAction, AuditPurpose } from '@dop/contracts';
import { json, type Db, type Tx } from '@dop/db';

// Append-only audit log written in the same transaction as the change (TR-TEN-06, NFR-AUD-01).

export interface AuditEntry {
  actor: Actor;
  action: AuditAction;
  tenantId: string | null;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  visibleToTenant?: boolean;
  purpose?: AuditPurpose | null;
  ip?: string | null;
  requestId?: string | null;
}

function actorColumns(a: Actor) {
  switch (a.kind) {
    case 'platform':
      return { actor_type: 'platform_user' as const, actor_id: a.platformUserId, support_session_id: null };
    case 'support':
      return { actor_type: 'support' as const, actor_id: a.platformUserId, support_session_id: a.supportSessionId };
    case 'user':
      return { actor_type: 'user' as const, actor_id: a.userId, support_session_id: null };
    case 'staff_device':
      return { actor_type: 'staff_device' as const, actor_id: a.deviceId, support_session_id: null };
    case 'api_key':
      return { actor_type: 'api_key' as const, actor_id: a.apiKeyId, support_session_id: null };
    default:
      return { actor_type: 'system' as const, actor_id: null, support_session_id: null };
  }
}

/** `db` must be the transaction that makes the change (audit_log is a platform table; any client works). */
export async function writeAudit(db: Db | Tx, e: AuditEntry): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      ...actorColumns(e.actor),
      tenant_id: e.tenantId,
      purpose: e.purpose ?? null,
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      before_data: e.before === undefined ? null : json(e.before),
      after_data: e.after === undefined ? null : json(e.after),
      visible_to_tenant: e.visibleToTenant ?? e.actor.kind !== 'platform',
      ip: e.ip ?? null,
      request_id: e.requestId ?? null,
    })
    .execute();
}

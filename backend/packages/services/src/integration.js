import { createHash } from 'node:crypto';
import { AppError } from '@dop/contracts';
import { json } from '@dop/db';
import { newApiKey, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { urls } from './deps.js';
import { isEnabled, requireFeature, requireWithinLimit, tenantPlan } from './platform.js';
import { staffTicket } from './projections.js';
// Integration API support (TRD §12.9, R2): API keys (TR-INT-03), idempotency (TR-INT-01), unknown-reference
// logging (TR-INT-06), integration projection (appendix 30.8).
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export async function createApiKey(deps, actor, tenantId, venueId, name) {
    const db = deps.db.forTenant(tenantId);
    if (!(await db.selectFrom('venues').select('id').where('id', '=', venueId).where('status', '=', 'active').executeTakeFirst()))
        throw new AppError('NOT_FOUND');
    await requireFeature(deps, tenantId, 'api_access');
    const id = uuidv7();
    let key = '';
    // The visible prefix is short and globally unique: a rare collision draws a new key (I-12).
    for (let attempt = 0;; attempt++) {
        key = newApiKey(deps.config.appEnv === 'production');
        try {
            await db.transaction().execute(async (tx) => {
                // Counted under a lock on the venue row so parallel requests cannot pass the plan limit together (L-12).
                await tx.selectFrom('venues').select('id').where('id', '=', venueId).forUpdate().executeTakeFirst();
                const n = await tx.selectFrom('api_keys').select((eb) => eb.fn.countAll().as('n')).where('venue_id', '=', venueId).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
                await requireWithinLimit(deps, tenantId, 'maxApiKeysPerVenue', Number(n.n));
                await tx.insertInto('api_keys').values({ id, tenant_id: tenantId, venue_id: venueId, name, key_prefix: key.slice(0, 12), secret_hash: sha256(key), created_by: actor.userId }).execute();
                await writeAudit(tx, { actor, action: 'apikey.created', tenantId, entityType: 'api_key', entityId: id, after: { name, prefix: key.slice(0, 12) } });
            });
            break;
        }
        catch (e) {
            if (e.code !== 'ER_DUP_ENTRY' || attempt >= 4)
                throw e;
        }
    }
    // The full key is shown once (TR-INT-03, NFR-SEC-05).
    return { id, key, prefix: key.slice(0, 12) };
}
export async function listApiKeys(deps, tenantId, venueId) {
    if (!(await deps.db.forTenant(tenantId).selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst()))
        throw new AppError('NOT_FOUND');
    const rows = await deps.db.forTenant(tenantId).selectFrom('api_keys').select(['id', 'name', 'key_prefix', 'created_at', 'last_used_at', 'revoked_at']).where('venue_id', '=', venueId).orderBy('created_at', 'desc').execute();
    return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.key_prefix, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null, revoked: r.revoked_at !== null }));
}
export async function revokeApiKey(deps, actor, tenantId, id) {
    const db = deps.db.forTenant(tenantId);
    await db.transaction().execute(async (tx) => {
        const r = await tx.updateTable('api_keys').set({ revoked_at: deps.now() }).where('id', '=', id).where('revoked_at', 'is', null).executeTakeFirst();
        if (Number(r.numUpdatedRows) === 0)
            throw new AppError('NOT_FOUND');
        await writeAudit(tx, { actor, action: 'apikey.revoked', tenantId, entityType: 'api_key', entityId: id });
    });
}
/** `Authorization: Bearer pk_…` → api_key actor (§6.2). Only the SHA-256 and 12-char prefix are stored. */
export async function resolveApiKey(deps, bearer) {
    if (!/^pk_(live|test)_[0-9A-Za-z]{32}$/.test(bearer))
        return null;
    const k = await deps.db.platform().selectFrom('api_keys').select(['id', 'tenant_id', 'venue_id', 'secret_hash', 'last_used_at', 'created_at']).where('key_prefix', '=', bearer.slice(0, 12)).where('revoked_at', 'is', null).executeTakeFirst();
    if (!k || k.secret_hash !== sha256(bearer))
        return null;
    // The tenant's current plan decides on every request (A05, FR-BIL-10): a key kept after a downgrade, a removed
    // feature or a lower key limit stops working instead of keeping access the plan no longer includes.
    if (!(await isEnabled(deps, k.tenant_id, 'api_access')))
        throw new AppError('FEATURE_NOT_IN_PLAN', 'The API is not part of your plan');
    const { limits } = await tenantPlan(deps, k.tenant_id);
    const older = await deps.db
        .forTenant(k.tenant_id)
        .selectFrom('api_keys')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('venue_id', '=', k.venue_id)
        .where('revoked_at', 'is', null)
        .where('created_at', '<', k.created_at)
        .executeTakeFirstOrThrow();
    if (Number(older.n) >= limits.maxApiKeysPerVenue)
        throw new AppError('PLAN_LIMIT', `Your plan allows ${limits.maxApiKeysPerVenue} API key(s) per venue`, { data: { limit: 'maxApiKeysPerVenue', allowed: limits.maxApiKeysPerVenue } });
    if (!k.last_used_at || deps.now().getTime() - k.last_used_at.getTime() > 60_000) {
        await deps.db.forTenant(k.tenant_id).updateTable('api_keys').set({ last_used_at: deps.now() }).where('id', '=', k.id).execute();
    }
    return { kind: 'api_key', apiKeyId: k.id, tenantId: k.tenant_id, venueId: k.venue_id };
}
// ---- idempotency (TR-INT-01): 24 h; same key + different body → 422; concurrent duplicate → 409.
export async function idempotent(deps, actor, key, request, run) {
    if (!key)
        return { ...(await run()), replayed: false };
    if (key.length > 255)
        throw new AppError('VALIDATION_FAILED', 'Idempotency-Key too long');
    const db = deps.db.forTenant(actor.tenantId);
    const hash = sha256(`${request.method} ${request.path} ${JSON.stringify(request.body ?? null)}`);
    const existing = await db.selectFrom('idempotency_keys').selectAll().where('api_key_id', '=', actor.apiKeyId).where('idem_key', '=', key).executeTakeFirst();
    if (existing && deps.now().getTime() - existing.created_at.getTime() < 24 * 3600_000) {
        if (existing.request_hash !== hash)
            throw new AppError('IDEMPOTENCY_KEY_REUSED');
        if (existing.status_code === null)
            throw new AppError('IDEMPOTENCY_IN_PROGRESS');
        return { status: existing.status_code, body: existing.response_body, replayed: true };
    }
    if (existing)
        await db.deleteFrom('idempotency_keys').where('api_key_id', '=', actor.apiKeyId).where('idem_key', '=', key).execute();
    try {
        await db.insertInto('idempotency_keys').values({ tenant_id: actor.tenantId, api_key_id: actor.apiKeyId, idem_key: key, request_hash: hash, created_at: deps.now() }).execute();
    }
    catch (e) {
        if (e.code === 'ER_DUP_ENTRY')
            throw new AppError('IDEMPOTENCY_IN_PROGRESS');
        throw e;
    }
    try {
        const r = await run();
        await db.updateTable('idempotency_keys').set({ status_code: r.status, response_body: json(r.body) }).where('api_key_id', '=', actor.apiKeyId).where('idem_key', '=', key).execute();
        return { ...r, replayed: false };
    }
    catch (e) {
        await db.deleteFrom('idempotency_keys').where('api_key_id', '=', actor.apiKeyId).where('idem_key', '=', key).execute();
        throw e;
    }
}
/** Unknown tickets or references are logged for the tenant, once per reference per hour (TR-INT-06, EX-12). */
export async function logUnknownReference(deps, actor, ref) {
    if (!(await deps.kv.setNx(`t:${actor.tenantId}:unknownref:${sha256(ref).slice(0, 16)}`, '1', 3600)))
        return;
    await writeAudit(deps.db.platform(), { actor, action: 'tenant.updated', tenantId: actor.tenantId, entityType: 'api.unknown_ticket', entityId: ref.slice(0, 64), visibleToTenant: true });
}
export function integrationTicket(deps, t) {
    const { token: _t, checkCode: _c, lastChangedBy: _l, ...rest } = staffTicket(t);
    return {
        ...rest,
        ticketUrl: urls(deps.config).ticket(t.token),
        firstReadyAt: t.first_ready_at?.toISOString() ?? null,
        cancelledAt: t.cancelled_at?.toISOString() ?? null,
        expiredAt: t.expired_at?.toISOString() ?? null,
    };
}

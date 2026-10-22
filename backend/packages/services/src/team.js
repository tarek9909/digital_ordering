import { AppError } from '@dop/contracts';
import { writeAudit } from './audit.js';
import { revalidateUserSockets, revokeOtherSessions, verifyUserPassword } from './auth.js';
import { sendEmail } from './email.js';
// Team: members, invitations, ownership transfer (FR-ADM-11, BR-20, TR-AUTH-07).
export async function listMembers(deps, tenantId) {
    const db = deps.db.forTenant(tenantId);
    const members = await db
        .selectFrom('tenant_memberships')
        .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
        .select(['tenant_memberships.id', 'tenant_memberships.role', 'tenant_memberships.created_at', 'users.name', 'users.email', 'users.mfa_enrolled_at'])
        .where('tenant_memberships.status', '=', 'active')
        .orderBy('tenant_memberships.created_at')
        .execute();
    const invitations = await db
        .selectFrom('invitations')
        .select(['id', 'email', 'role', 'expires_at', 'created_at'])
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', deps.now())
        .execute();
    return {
        members: members.map((m) => ({ id: m.id, role: m.role, name: m.name, email: m.email, mfa: m.mfa_enrolled_at !== null, since: m.created_at.toISOString() })),
        invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at.toISOString() })),
    };
}
export async function revokeInvitation(deps, tenantId, invitationId) {
    const r = await deps.db.forTenant(tenantId).updateTable('invitations').set({ revoked_at: deps.now() }).where('id', '=', invitationId).where('accepted_at', 'is', null).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0)
        throw new AppError('NOT_FOUND');
}
export async function removeMember(deps, actor, tenantId, membershipId) {
    const db = deps.db.forTenant(tenantId);
    let userId = '';
    await db.transaction().execute(async (tx) => {
        const m = await tx.selectFrom('tenant_memberships').select(['id', 'role', 'user_id']).where('id', '=', membershipId).where('status', '=', 'active').executeTakeFirst();
        if (!m)
            throw new AppError('NOT_FOUND');
        if (m.role === 'owner')
            throw new AppError('FORBIDDEN', 'Transfer ownership before removing the owner');
        userId = m.user_id;
        await tx.updateTable('tenant_memberships').set({ status: 'removed' }).where('id', '=', m.id).execute();
        await tx.updateTable('user_sessions').set({ revoked_at: deps.now() }).where('user_id', '=', m.user_id).where('revoked_at', 'is', null).execute();
        await writeAudit(tx, { actor, action: 'member.removed', tenantId, entityType: 'membership', entityId: m.id });
    });
    // Open board sockets of the removed member close too (H-7).
    await revalidateUserSockets(deps, { userId });
}
/** One active owner at all times (BR-20): the old owner becomes a manager in the same transaction. */
export async function transferOwnership(deps, actor, tenantId, toMembershipId, password) {
    await verifyUserPassword(deps, actor.userId, password);
    const db = deps.db.forTenant(tenantId);
    let emails = [];
    const tenant = await deps.db.platform().selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirstOrThrow();
    let newOwnerUserId = '';
    await db.transaction().execute(async (tx) => {
        const from = await tx.selectFrom('tenant_memberships').select(['id']).where('user_id', '=', actor.userId).where('role', '=', 'owner').where('status', '=', 'active').forUpdate().executeTakeFirst();
        if (!from)
            throw new AppError('FORBIDDEN');
        const to = await tx.selectFrom('tenant_memberships').select(['id', 'user_id']).where('id', '=', toMembershipId).where('status', '=', 'active').forUpdate().executeTakeFirst();
        if (!to || to.id === from.id)
            throw new AppError('NOT_FOUND');
        newOwnerUserId = to.user_id;
        await tx.updateTable('tenant_memberships').set({ role: 'manager' }).where('id', '=', from.id).execute();
        await tx.updateTable('tenant_memberships').set({ role: 'owner' }).where('id', '=', to.id).execute();
        await writeAudit(tx, { actor, action: 'tenant.ownership_transferred', tenantId, entityType: 'membership', entityId: to.id, before: { owner: actor.userId }, after: { owner: to.user_id } });
        emails = await tx.selectFrom('users').select(['email', 'locale']).where('id', 'in', [actor.userId, to.user_id]).execute();
    });
    await revokeOtherSessions(deps, actor.userId, actor.sessionId);
    await revokeOtherSessions(deps, newOwnerUserId);
    for (const e of emails)
        await sendEmail(deps, { template: 'ownership_transferred', to: e.email, locale: e.locale, tenantId, data: { tenantName: tenant.name } });
}

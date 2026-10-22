import { writeAudit } from './audit.js';
// Tenant settings and the signed-in user's own profile (§12.7 Tenant, Account).
export async function getTenantSettings(deps, tenantId) {
    const t = await deps.db
        .platform()
        .selectFrom('tenants')
        .select(['id', 'name', 'slug', 'status', 'country', 'default_locale', 'billing_email', 'tax_id', 'trial_ends_at', 'grace_ends_at', 'deletion_requested_at', 'complimentary'])
        .where('id', '=', tenantId)
        .executeTakeFirstOrThrow();
    return { ...t, complimentary: Boolean(t.complimentary) };
}
export async function patchTenant(deps, actor, tenantId, b, requestId) {
    const patch = {
        ...(b.name && { name: b.name }),
        ...(b.billingEmail !== undefined && { billing_email: b.billingEmail }),
        ...(b.taxId !== undefined && { tax_id: b.taxId }),
        ...(b.defaultLocale && { default_locale: b.defaultLocale }),
    };
    if (Object.keys(patch).length === 0)
        return;
    await deps.db.platform().transaction().execute(async (tx) => {
        await tx.updateTable('tenants').set(patch).where('id', '=', tenantId).execute();
        await writeAudit(tx, { actor, action: 'tenant.updated', tenantId, entityType: 'tenant', entityId: tenantId, after: patch, requestId });
    });
}
export async function updateMe(deps, userId, b) {
    if (!b.name && !b.locale)
        return;
    await deps.db.platform().updateTable('users').set(b).where('id', '=', userId).execute();
}

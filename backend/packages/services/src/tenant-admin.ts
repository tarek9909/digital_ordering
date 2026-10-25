import type { Actor } from '@dop/auth';
import { writeAudit } from './audit.js';
import { urls, type Deps } from './deps.js';

// Tenant settings and the signed-in user's own profile (§12.7 Tenant, Account).

export async function getTenantSettings(deps: Deps, tenantId: string) {
  const t = await deps.db
    .platform()
    .selectFrom('tenants')
    .select(['id', 'name', 'slug', 'status', 'country', 'default_locale', 'billing_email', 'tax_id', 'trial_ends_at', 'paid_until', 'grace_ends_at', 'deletion_requested_at', 'complimentary'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();
  // The restaurant's logo is the first venue's; the admin sidebar shows it.
  const venue = await deps.db.forTenant(tenantId).selectFrom('venues').select('logo_key').where('status', '=', 'active').orderBy('created_at').executeTakeFirst();
  return { ...t, complimentary: Boolean(t.complimentary), logoUrl: urls(deps.config).logo(venue?.logo_key ?? null) };
}

export async function patchTenant(
  deps: Deps,
  actor: Actor,
  tenantId: string,
  b: { name?: string; billingEmail?: string | null; taxId?: string | null; defaultLocale?: string },
  requestId?: string,
) {
  const patch = {
    ...(b.name && { name: b.name }),
    ...(b.billingEmail !== undefined && { billing_email: b.billingEmail }),
    ...(b.taxId !== undefined && { tax_id: b.taxId }),
    ...(b.defaultLocale && { default_locale: b.defaultLocale }),
  };
  if (Object.keys(patch).length === 0) return;
  await deps.db.platform().transaction().execute(async (tx) => {
    await tx.updateTable('tenants').set(patch).where('id', '=', tenantId).execute();
    await writeAudit(tx, { actor, action: 'tenant.updated', tenantId, entityType: 'tenant', entityId: tenantId, after: patch, requestId });
  });
}

export async function updateMe(deps: Deps, userId: string, b: { name?: string; locale?: string }) {
  if (!b.name && !b.locale) return;
  await deps.db.platform().updateTable('users').set(b).where('id', '=', userId).execute();
}

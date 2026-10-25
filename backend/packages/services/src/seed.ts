import { encrypt, hashSecret } from '@dop/auth';
import { MemoryJobs } from '@dop/jobs';
import { uuidv7 } from '@dop/domain';
import type { Deps } from './deps.js';
import { createTenantWithOwner } from './tenant-create.js';
import { changeTenantStatus } from './tenants.js';
import { createTicket, transitionTicket } from './tickets.js';
import { createDisplay, setStaffPin, staffAccessInfo } from './venues.js';

// Development and test data (TR-TST-01): platform users of each role, plans with prices (reference data),
// seven tenants (one per lifecycle status) with owners, managers, venues, displays and tickets in every status.
// Never run against production: the caller checks APP_ENV.

export const SEED_PASSWORD = 'dev-password-123';
export const SEED_PIN = '4821';

export interface SeedOptions {
  /** Password for every seeded account. Defaults to the published SEED_PASSWORD, which is for local use only. */
  password?: string;
  /** Leave platform users without a published TOTP secret; they enrol their own at first sign-in. For a server others can reach. */
  noTotp?: boolean;
}

export interface SeedResult {
  platformUsers: Array<{ email: string; role: string; totpSecret: string }>;
  tenants: Array<{ slug: string; status: string; ownerEmail: string; managerEmail: string | null; staffLink: string; venueId: string }>;
}

export async function seedDemo(deps: Deps, opts: SeedOptions = {}): Promise<SeedResult> {
  const password = opts.password ?? SEED_PASSWORD;
  const pdb = deps.db.platform();
  const out: SeedResult = { platformUsers: [], tenants: [] };

  // Fixed TOTP secrets so developers can add them to an authenticator app (base32).
  const roles = [
    { email: 'super@dop.localhost', name: 'Super Admin', role: 'super_admin' as const, secret: 'JBSWY3DPEHPK3PXP' },
    { email: 'support@dop.localhost', name: 'Support Agent', role: 'support' as const, secret: 'KRSXG5CTMVRXEZLU' },
    { email: 'finance@dop.localhost', name: 'Finance', role: 'finance' as const, secret: 'MFRGGZDFMZTWQ2LK' },
  ];
  for (const r of roles) {
    if (await pdb.selectFrom('platform_users').select('id').where('email', '=', r.email).executeTakeFirst()) continue;
    await pdb
      .insertInto('platform_users')
      .values({
        id: uuidv7(),
        email: r.email,
        name: r.name,
        role: r.role,
        status: 'active',
        password_hash: await hashSecret(password),
        ...(opts.noTotp ? {} : { totp_secret_enc: await encrypt(deps.keys, r.secret), mfa_enrolled_at: deps.now() }),
      })
      .execute();
    out.platformUsers.push({ email: r.email, role: r.role, totpSecret: opts.noTotp ? '' : r.secret });
  }

  const tenants = [
    { slug: 'burger-house', name: 'Burger House', status: 'trial' },
    { slug: 'cafe-aroma', name: 'Café Aroma', status: 'active' },
    { slug: 'food-court-7', name: 'Food Court 7', status: 'suspended' },
    { slug: 'shawarma-king', name: 'Shawarma King', status: 'active' },
    { slug: 'sweet-tooth', name: 'Sweet Tooth', status: 'past_due' },
    { slug: 'green-bowl', name: 'Green Bowl', status: 'cancelled' },
    { slug: 'fresh-juice', name: 'Fresh Juice Bar', status: 'trial_expired' },
  ];
  for (const t of tenants) {
    const exists = await pdb.selectFrom('tenants').select('id').where('slug', '=', t.slug).executeTakeFirst();
    if (exists) continue;
    const email = `owner@${t.slug}.localhost`;
    const r = await createTenantWithOwner(deps, { ownerName: `${t.name} Owner`, email, password, restaurantName: t.name, slug: t.slug, country: 'SA', locale: 'ar' }, { ip: '127.0.0.1' });
    await pdb.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', r.userId).execute();
    // A second team member, so the Team page and the console tenant view have more than an owner.
    const managerEmail = t.slug === 'burger-house' || t.slug === 'cafe-aroma' || t.slug === 'shawarma-king' ? `manager@${t.slug}.localhost` : null;
    if (managerEmail) {
      const managerId = uuidv7();
      await pdb
        .insertInto('users')
        .values({ id: managerId, email: managerEmail, name: `${t.name} Manager`, password_hash: await hashSecret(password), locale: 'ar', email_verified_at: deps.now() })
        .execute();
      await pdb.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: r.tenantId, user_id: managerId, role: 'manager' }).execute();
    }
    await setStaffPin(deps, { kind: 'system' }, r.tenantId, r.venueId, SEED_PIN);
    await createDisplay(deps, { kind: 'system' }, r.tenantId, r.venueId, { name: 'Pickup TV' });
    const actor = { kind: 'user' as const, userId: r.userId, tenantId: r.tenantId, role: 'owner' as const, sessionId: 'seed', mfaVerified: false };
    // Tickets in every status.
    const make = async () => (await createTicket(deps, actor, r.venueId, {})).ticket;
    const a = await make(); // preparing
    const b = await make();
    await transitionTicket(deps, actor, b.id, { to: 'ready', version: b.version });
    const c = await make();
    await transitionTicket(deps, actor, c.id, { to: 'ready', version: c.version });
    await transitionTicket(deps, actor, c.id, { to: 'collected', version: c.version + 1 });
    const d = await make();
    await transitionTicket(deps, actor, d.id, { to: 'cancelled', version: d.version, cancelReason: 'customer_left' });
    const e = await make();
    await transitionTicket(deps, { kind: 'system', tenantId: r.tenantId }, e.id, { to: 'expired' });
    void a;
    const system = { kind: 'system' as const };
    if (t.status === 'active' || t.status === 'past_due' || t.status === 'cancelled') {
      // Cafe Aroma is complimentary; the rest are paid for a month.
      const complimentary = t.slug === 'cafe-aroma';
      await pdb
        .updateTable('tenants')
        .set(complimentary ? { complimentary } : { paid_until: new Date(deps.now().getTime() + 30 * 86_400_000) })
        .where('id', '=', r.tenantId)
        .execute();
      await changeTenantStatus(deps, r.tenantId, { to: 'active', actor: system, reason: 'Seed: active', email: null });
    }
    if (t.status === 'past_due') await changeTenantStatus(deps, r.tenantId, { to: 'past_due', actor: system, reason: 'Seed: payment overdue', email: null });
    if (t.status === 'cancelled') await changeTenantStatus(deps, r.tenantId, { to: 'cancelled', actor: system, reason: 'Seed: cancelled by owner', email: null });
    if (t.status === 'trial_expired') await changeTenantStatus(deps, r.tenantId, { to: 'trial_expired', actor: system, reason: 'Seed: trial ended', email: null });
    if (t.status === 'suspended') {
      await changeTenantStatus(deps, r.tenantId, { to: 'suspended', suspendedBy: 'platform', actor: { kind: 'system' }, reason: 'Seed: suspended example', email: null });
    }
    const link = (await staffAccessInfo(deps, r.tenantId, r.venueId)).link;
    out.tenants.push({ slug: t.slug, status: t.status, ownerEmail: email, managerEmail, staffLink: link, venueId: r.venueId });
  }

  // The flagship demo venue wears the Tanbeeh Ember colour, so demos show the platform identity end to end. Also
  // applied to an already-seeded database, but only while the venue still has the default colour.
  const brand: Record<string, string> = { 'burger-house': '#C2410C' };
  for (const [slug, color] of Object.entries(brand)) {
    const tenant = await pdb.selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!tenant) continue;
    await deps.db.forTenant(tenant.id).updateTable('venues').set({ brand_color: color }).where('brand_color', '=', '#1F6FEB').execute();
  }
  return out;
}

/**
 * Runs the demo seed from the API process when SEED_DEMO_DATA=yes (a demo or staging server fed by a push). It is
 * idempotent, so every start after the first changes nothing. Seeded accounts are never given the published
 * password on a deployed environment: SEED_DEMO_PASSWORD is required there, and platform users enrol their own TOTP. Jobs run
 * in memory so the seed sends no email. Failures are logged and never stop the server.
 */
export async function seedDemoOnStartup(deps: Deps, env: { SEED_DEMO_DATA?: string; SEED_DEMO_PASSWORD?: string }): Promise<void> {
  if (env.SEED_DEMO_DATA !== 'yes') return;
  const deployed = deps.config.appEnv !== 'local' && deps.config.appEnv !== 'test';
  if (deployed && (env.SEED_DEMO_PASSWORD ?? '').length < 12) {
    deps.log.error('SEED_DEMO_DATA=yes on a deployed environment needs SEED_DEMO_PASSWORD (12+ characters); demo data skipped');
    return;
  }
  try {
    const r = await seedDemo({ ...deps, jobs: new MemoryJobs() }, { password: deployed ? env.SEED_DEMO_PASSWORD : undefined, noTotp: deployed });
    deps.log.warn({ platformUsers: r.platformUsers.length, tenants: r.tenants.length }, 'demo data seeded');
  } catch (e) {
    deps.log.error({ err: e }, 'demo seed failed');
  }
}

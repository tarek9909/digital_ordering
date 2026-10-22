import { encrypt, hashSecret } from '@dop/auth';
import { uuidv7 } from '@dop/domain';
import { createTenantWithOwner } from './tenant-create.js';
import { changeTenantStatus } from './tenants.js';
import { createTicket, transitionTicket } from './tickets.js';
import { createDisplay, setStaffPin, staffAccessInfo } from './venues.js';
// Development and test data (TR-TST-01): platform users of each role, plans with prices (reference data),
// three tenants (trial, active, suspended) with venues, devices, displays and tickets in every status.
// Never run against production: the caller checks APP_ENV.
export const SEED_PASSWORD = 'dev-password-123';
export const SEED_PIN = '4821';
export async function seedDemo(deps) {
    const pdb = deps.db.platform();
    const out = { platformUsers: [], tenants: [] };
    // Fixed TOTP secrets so developers can add them to an authenticator app (base32).
    const roles = [
        { email: 'super@dop.localhost', name: 'Super Admin', role: 'super_admin', secret: 'JBSWY3DPEHPK3PXP' },
        { email: 'support@dop.localhost', name: 'Support Agent', role: 'support', secret: 'KRSXG5CTMVRXEZLU' },
        { email: 'finance@dop.localhost', name: 'Finance', role: 'finance', secret: 'MFRGGZDFMZTWQ2LK' },
    ];
    for (const r of roles) {
        if (await pdb.selectFrom('platform_users').select('id').where('email', '=', r.email).executeTakeFirst())
            continue;
        await pdb
            .insertInto('platform_users')
            .values({
            id: uuidv7(),
            email: r.email,
            name: r.name,
            role: r.role,
            status: 'active',
            password_hash: await hashSecret(SEED_PASSWORD),
            totp_secret_enc: await encrypt(deps.keys, r.secret),
            mfa_enrolled_at: deps.now(),
        })
            .execute();
        out.platformUsers.push({ email: r.email, role: r.role, totpSecret: r.secret });
    }
    const tenants = [
        { slug: 'burger-house', name: 'Burger House', status: 'trial' },
        { slug: 'cafe-aroma', name: 'Café Aroma', status: 'active' },
        { slug: 'food-court-7', name: 'Food Court 7', status: 'suspended' },
    ];
    for (const t of tenants) {
        const exists = await pdb.selectFrom('tenants').select('id').where('slug', '=', t.slug).executeTakeFirst();
        if (exists)
            continue;
        const email = `owner@${t.slug}.localhost`;
        const r = await createTenantWithOwner(deps, { ownerName: `${t.name} Owner`, email, password: SEED_PASSWORD, restaurantName: t.name, slug: t.slug, country: 'SA', locale: 'ar' }, { ip: '127.0.0.1' });
        await pdb.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', r.userId).execute();
        await setStaffPin(deps, { kind: 'system' }, r.tenantId, r.venueId, SEED_PIN);
        await createDisplay(deps, { kind: 'system' }, r.tenantId, r.venueId, { name: 'Pickup TV' });
        const actor = { kind: 'user', userId: r.userId, tenantId: r.tenantId, role: 'owner', sessionId: 'seed', mfaVerified: false };
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
        if (t.status === 'active') {
            await pdb.updateTable('tenants').set({ complimentary: true }).where('id', '=', r.tenantId).execute();
            await changeTenantStatus(deps, r.tenantId, { to: 'active', actor: { kind: 'system' }, reason: 'Seed: complimentary', email: null });
        }
        if (t.status === 'suspended') {
            await changeTenantStatus(deps, r.tenantId, { to: 'suspended', suspendedBy: 'platform', actor: { kind: 'system' }, reason: 'Seed: suspended example', email: null });
        }
        const link = (await staffAccessInfo(deps, r.tenantId, r.venueId)).link;
        out.tenants.push({ slug: t.slug, status: t.status, ownerEmail: email, staffLink: link, venueId: r.venueId });
    }
    return out;
}

import { loadEnv } from '@dop/config';
import { createRuntime, issuePairingCode, LOCAL_PORTS, staffAccessInfo, urls } from '@dop/services';

// Local development helper: prints each seeded restaurant's staff link, a fresh display pairing code and the app
// URLs. Run with `npx tsx --env-file=.env tools/dev-links.ts` (never against production).
const env = loadEnv();
if (env.APP_ENV === 'production') throw new Error('dev-links is for local development only');
const rt = await createRuntime(env);
const deps = { ...rt.deps, config: { ...rt.deps.config, localPorts: LOCAL_PORTS } };
const u = urls(deps.config);
const tenants = await deps.db.platform().selectFrom('tenants').select(['id', 'slug', 'name', 'status']).where('status', '!=', 'deleted').orderBy('created_at').execute();
for (const t of tenants) {
  const venue = await deps.db.forTenant(t.id).selectFrom('venues').select(['id', 'venue_code']).where('status', '=', 'active').orderBy('created_at').executeTakeFirst();
  if (!venue) continue;
  const staff = await staffAccessInfo(deps, t.id, venue.id);
  const display = await deps.db.forTenant(t.id).selectFrom('displays').select('id').where('venue_id', '=', venue.id).where('revoked_at', 'is', null).executeTakeFirst();
  const pairing = display ? await issuePairingCode(deps, t.id, display.id) : null;
  console.log(JSON.stringify({ slug: t.slug, name: t.name, status: t.status, admin: u.admin(t.slug), staffLink: staff.link, venuePage: u.venue(venue.venue_code), displayUrl: `${env.INSECURE_COOKIES ? 'http' : 'https'}://${t.slug}.${env.PLATFORM_DOMAIN}:${LOCAL_PORTS.display}/display`, pairingCode: pairing?.code ?? null }));
}
await rt.close();

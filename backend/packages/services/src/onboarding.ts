import { defaultVenueMessages } from '@dop/contracts';
import type { Deps } from './deps.js';

// Setup checklist that ticks itself (FR-ADM-02), ending with a test ticket.

export async function onboarding(deps: Deps, tenantId: string, userId: string) {
  const db = deps.db.forTenant(tenantId);
  const pdb = deps.db.platform();
  const [user, venue, displays, ticket, devices] = await Promise.all([
    pdb.selectFrom('users').select(['email_verified_at']).where('id', '=', userId).executeTakeFirst(),
    db.selectFrom('venues').innerJoin('staff_access', 'staff_access.venue_id', 'venues.id').select(['venues.id', 'venues.logo_key', 'venues.brand_color', 'venues.messages', 'venues.created_at', 'staff_access.pin_changed_at']).where('venues.status', '=', 'active').orderBy('venues.created_at').executeTakeFirst(),
    db.selectFrom('displays').select('id').where('paired_at', 'is not', null).where('revoked_at', 'is', null).limit(1).execute(),
    db.selectFrom('tickets').select('id').limit(1).execute(),
    db.selectFrom('staff_devices').select('id').limit(1).execute(),
  ]);
  const messages = (venue?.messages ?? {}) as Record<string, Record<string, string>>;
  const defaults = defaultVenueMessages(['ar', 'en']);
  const steps = [
    { key: 'verify_email', done: Boolean(user?.email_verified_at) },
    { key: 'branding', done: Boolean(venue && (venue.logo_key || venue.brand_color !== '#1F6FEB')) },
    // New venues start with default wording, so the step ticks once the owner changes any of it.
    { key: 'messages', done: Object.entries(messages).some(([l, m]) => Object.entries(m).some(([k, val]) => Boolean(val) && val !== (defaults[l] as Record<string, string> | undefined)?.[k])) },
    { key: 'staff_pin', done: Boolean(venue && venue.pin_changed_at.getTime() - venue.created_at.getTime() > 1000) },
    { key: 'staff_device', done: devices.length > 0 },
    { key: 'display', done: displays.length > 0 },
    { key: 'posters', done: Boolean(await deps.kv.get(`t:${tenantId}:posters`)) },
    { key: 'test_ticket', done: ticket.length > 0 },
  ];
  return { venueId: venue?.id ?? null, steps, complete: steps.every((s) => s.done) };
}

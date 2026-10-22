import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import type { TenantActor } from '@dop/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveCounter,
  claimStatus,
  claimTicket,
  createCounter,
  createTicket,
  decideClaim,
  deleteRatingComment,
  expireClaims,
  follow,
  listRatings,
  putVenueSettings,
  rateTicket,
  createTenantWithOwner,
  transitionTicket,
} from '../src/index.js';
import { makeTestDeps, type TestDeps } from '../src/testing.js';
import { defaultVenueSettings } from '@dop/contracts';

let t: TestDatabase;
let deps: TestDeps;
beforeAll(async () => {
  t = await startTestDatabase();
  deps = makeTestDeps(t.clients);
});
afterAll(async () => {
  await t?.stop();
});

let n = 0;
async function tenant() {
  n++;
  const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `r${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `R ${n}`, slug: `r11-${n}`, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const actor: TenantActor = { kind: 'staff_device', deviceId: 'd', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' };
  const owner = { kind: 'user' as const, userId: r.userId, tenantId: r.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: false };
  const venueCode = (await t.clients.forTenant(r.tenantId).selectFrom('venues').select('venue_code').where('id', '=', r.venueId).executeTakeFirstOrThrow()).venue_code;
  return { ...r, actor, owner, venueCode };
}
const client = (i: number) => `K${String(i).padStart(21, '0')}`;

describe('counters and prefixes (FR-ADM-07/10)', () => {
  it('numbers each counter separately with its prefix', async () => {
    const x = await tenant(); // trial: Pro features incl. counters
    const food = await createCounter(deps, x.owner, x.tenantId, x.venueId, { name: 'Food', prefix: 'A' });
    const drinks = await createCounter(deps, x.owner, x.tenantId, x.venueId, { name: 'Drinks', prefix: 'B' });
    const s = defaultVenueSettings();
    s.numbering.prefixesEnabled = true;
    await putVenueSettings(deps, x.owner, x.tenantId, x.venueId, s);
    const a1 = (await createTicket(deps, x.actor, x.venueId, { counterId: food.id })).ticket;
    const b1 = (await createTicket(deps, x.actor, x.venueId, { counterId: drinks.id })).ticket;
    const a2 = (await createTicket(deps, x.actor, x.venueId, { counterId: food.id })).ticket;
    expect([a1.display_number, b1.display_number, a2.display_number]).toEqual(['A1', 'B1', 'A2']);
    await expect(createCounter(deps, x.owner, x.tenantId, x.venueId, { name: 'Dup', prefix: 'A' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await archiveCounter(deps, x.owner, x.tenantId, drinks.id);
    await expect(createTicket(deps, x.actor, x.venueId, { counterId: drinks.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('claims (FR-QR-06, FR-STF-15, BR-14)', () => {
  it('joins with the right claim code and refuses wrong ones identically', async () => {
    const x = await tenant();
    const tk = (await createTicket(deps, x.actor, x.venueId, {})).ticket;
    await expect(claimTicket(deps, x.venueCode, { clientId: client(1), number: tk.display_number, claimCode: 'ZZZZ' }, 'other')).rejects.toMatchObject({ code: 'CLAIM_INVALID' });
    await expect(claimTicket(deps, x.venueCode, { clientId: client(1), number: '999', claimCode: tk.claim_code }, 'other')).rejects.toMatchObject({ code: 'CLAIM_INVALID' });
    const ok = await claimTicket(deps, x.venueCode, { clientId: client(1), number: tk.display_number, claimCode: tk.claim_code.toLowerCase() }, 'other');
    expect(ok).toEqual({ token: tk.token });
    const f = await t.clients.forTenant(x.tenantId).selectFrom('ticket_followers').select('joined_via').where('ticket_id', '=', tk.id).executeTakeFirstOrThrow();
    expect(f.joined_via).toBe('claim_code');
  });

  it('runs staff-approved claims and expires stale ones', async () => {
    const x = await tenant();
    const s = defaultVenueSettings();
    s.claims.mode = 'staff_approval';
    await putVenueSettings(deps, x.owner, x.tenantId, x.venueId, s);
    const tk = (await createTicket(deps, x.actor, x.venueId, {})).ticket;
    const r = await claimTicket(deps, x.venueCode, { clientId: client(2), number: tk.display_number }, 'other');
    expect(r).toMatchObject({ status: 'pending' });
    const claimId = (r as { claimId: string }).claimId;
    expect(await decideClaim(deps, x.actor, claimId, true)).toEqual({ status: 'approved' });
    expect(await claimStatus(deps, claimId, client(2))).toMatchObject({ status: 'approved', ticketToken: tk.token });
    await expect(claimStatus(deps, claimId, client(3))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const r2 = (await claimTicket(deps, x.venueCode, { clientId: client(4), number: tk.display_number }, 'other')) as { claimId: string };
    deps.clock.advance(6 * 60_000);
    expect(await expireClaims(deps)).toBeGreaterThan(0);
    expect((await claimStatus(deps, r2.claimId, client(4))).status).toBe('expired');
  });
});

describe('ratings (FR-CUS-10, FR-RPT-08/09)', () => {
  it('rates once after collection, returns the review link and lets the tenant delete comments', async () => {
    const x = await tenant();
    const s = defaultVenueSettings();
    s.customer.reviewLinkUrl = 'https://maps.example.com/review';
    await putVenueSettings(deps, x.owner, x.tenantId, x.venueId, s);
    const tk = (await createTicket(deps, x.actor, x.venueId, {})).ticket;
    await follow(deps, tk.token, { clientId: client(5), joinedVia: 'ticket_qr', uaFamily: 'other' });
    await expect(rateTicket(deps, tk.token, { clientId: client(5), stars: 5 })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await transitionTicket(deps, x.actor, tk.id, { to: 'ready', version: 1 });
    await transitionTicket(deps, x.actor, tk.id, { to: 'collected', version: 2 });
    await expect(rateTicket(deps, tk.token, { clientId: client(6), stars: 5 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Link shown regardless of rating (FR-RPT-09).
    expect(await rateTicket(deps, tk.token, { clientId: client(5), stars: 2, comment: 'cold' })).toEqual({ reviewLinkUrl: 'https://maps.example.com/review' });
    const list = await listRatings(deps, x.tenantId);
    expect(list[0]).toMatchObject({ stars: 2, comment: 'cold', displayNumber: tk.display_number });
    await deleteRatingComment(deps, x.owner, x.tenantId, list[0]!.id);
    // Only the comment goes; the rating and its stars stay (A11, FR-RPT-08).
    expect(await listRatings(deps, x.tenantId)).toEqual([expect.objectContaining({ stars: 2, comment: null, commentDeleted: true })]);
    await expect(deleteRatingComment(deps, x.owner, x.tenantId, list[0]!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

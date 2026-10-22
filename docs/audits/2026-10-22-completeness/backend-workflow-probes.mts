import { writeFile } from 'node:fs/promises';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeTestDeps } from '../../../backend/packages/services/src/testing.ts';
import { uuidv7, zonedToUtc, nextOccurrence } from '../../../backend/packages/domain/src/index.ts';
import * as svc from '../../../backend/packages/services/src/index.ts';
import { JOB_HANDLERS } from '../../../backend/apps/worker/src/handlers.ts';

// Characterization evidence: isolated disposable MySQL, memory queue/KV, fake external providers only.
const t = await startTestDatabase();
const d = makeTestDeps(t.clients, new Date());
const rows: Array<Record<string, unknown>> = [];
const out = (name: string, value: Record<string, unknown>) => { const r = { name, ...value }; rows.push(r); console.log(JSON.stringify(r)); };
let n = 0;
async function tenant(plan: string | null = null) {
  const slug = `workflow-${++n}`;
  const x = await svc.signup(d, { ownerName: 'Audit', email: `${slug}@x.test`, password: 'a-long-unique-passphrase', restaurantName: 'Workflow cafe', slug, country: 'SA', locale: 'en', acceptTerms: true }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: d.now() }).where('id', '=', x.userId).execute();
  if (plan) {
    const p = await t.clients.platform().selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
    await t.clients.platform().updateTable('tenants').set({ status: 'active', plan_id: p.id }).where('id', '=', x.tenantId).execute();
    await d.kv.del(`t:${x.tenantId}:flags`, `t:${x.tenantId}:status`);
  }
  return { ...x, actor: { kind: 'staff_device' as const, tenantId: x.tenantId, venueId: x.venueId, deviceId: 'audit', deviceName: 'Audit device' }, owner: { kind: 'user' as const, userId: x.userId, tenantId: x.tenantId, role: 'owner' as const, sessionId: 'audit', mfaVerified: false } };
}
const storage = { async put() {}, async get() { return null; }, async deletePrefix() { return 0; }, async signedUrl() { return 'https://audit.invalid'; } };
try {
  {
    const x = await tenant();
    const failures = [];
    for (let i = 0; i < 3; i++) try { await svc.createTicket(d, x.actor, x.venueId, { counterId: uuidv7() }); } catch (e) { failures.push((e as { code: string }).code); }
    const tickets = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('id').execute();
    const countKey = (await d.kv.keys(`t:${x.tenantId}:tickets:`))[0];
    out('failed-creates-spend-trial-quota', { failures, persistedTickets: tickets.length, quotaCounter: countKey ? await d.kv.get(countKey) : null });
  }
  {
    const x = await tenant('pro');
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const id = uuidv7();
    const first = await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { test: true }, id);
    const replay = await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { test: true }, id);
    const deliveries = await t.clients.forTenant(x.tenantId).selectFrom('webhook_deliveries').select(['id', 'event_id']).where('endpoint_id', '=', ep.id).execute();
    out('webhook-fanout-replay-duplicates', { first, replay, deliveries });
  }
  {
    const x = await tenant('pro');
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(...await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', {}));
    let postCalls = 0;
    const post = async () => { postCalls++; return { status: 503 }; };
    const first = await svc.deliverWebhook(d, x.tenantId, ids[0]!, post, async () => ['93.184.216.34']);
    const epAfterFirst = await t.clients.forTenant(x.tenantId).selectFrom('webhook_endpoints').select(['status', 'failure_streak', 'disabled_reason']).where('id', '=', ep.id).executeTakeFirstOrThrow();
    for (const id of ids.slice(1)) await svc.deliverWebhook(d, x.tenantId, id, post, async () => ['93.184.216.34']);
    const deliveries = await t.clients.forTenant(x.tenantId).selectFrom('webhook_deliveries').select(['status', 'attempt']).where('endpoint_id', '=', ep.id).execute();
    out('webhook-pending-counts-as-failures', { first, epAfterFirst, postCalls, deliveries });
  }
  {
    const x = await tenant('pro');
    await t.clients.platform().updateTable('tenants').set({ stripe_customer_id: 'cus_audit_replay' }).where('id', '=', x.tenantId).execute();
    const provider = new svc.FakeBillingProvider('secret', 'https://audit.invalid');
    async function event(id: string, type: string, object: Record<string, unknown>) {
      const raw = Buffer.from(JSON.stringify({ id, type, data: { object: { id: `in_${id}`, customer: 'cus_audit_replay', status: type === 'invoice.paid' ? 'paid' : 'open', ...object } } }));
      await svc.receiveBillingWebhook(d, provider, raw, provider.sign(raw.toString()));
      await svc.processBillingEvent(d, provider, id);
    }
    const status = async () => (await t.clients.platform().selectFrom('tenants').select('status').where('id', '=', x.tenantId).executeTakeFirstOrThrow()).status;
    await event('evt_failed_replay', 'invoice.payment_failed', {});
    const afterFailure = await status();
    await event('evt_paid_replay', 'invoice.paid', {});
    const afterPayment = await status();
    await svc.processBillingEvent(d, provider, 'evt_failed_replay');
    out('processed-billing-event-reapplied', { afterFailure, afterPayment, afterOldProcessedJobReplay: await status() });
    await svc.processBillingEvent(d, provider, 'evt_paid_replay');
    await svc.changeTenantStatus(d, x.tenantId, { to: 'cancelled', actor: { kind: 'system' } });
    await svc.processBillingEvent(d, provider, 'evt_paid_replay');
    out('processed-payment-reactivates-cancelled', { afterOldPaidJobReplay: await status() });
  }
  {
    const x = await tenant('pro');
    await t.clients.platform().updateTable('tenants').set({ stripe_customer_id: 'cus_audit_purge' }).where('id', '=', x.tenantId).execute();
    await svc.markDeleted(d, x.tenantId, { kind: 'system' });
    let deleteCustomerCalls = 0;
    const provider = new svc.FakeBillingProvider('secret', 'https://audit.invalid');
    provider.deleteCustomer = async () => { deleteCustomerCalls++; if (deleteCustomerCalls === 1) throw new Error('Injected temporary billing outage'); };
    const wd = { ...d, billing: provider, storage, push: async () => 201, mailer: { async send() {} } };
    let firstError: string | null = null;
    try { await JOB_HANDLERS['tenant.purge'](wd, { tenantId: x.tenantId }); } catch (e) { firstError = (e as Error).message; }
    const tenantAfterFirst = await t.clients.platform().selectFrom('tenants').select('id').where('id', '=', x.tenantId).executeTakeFirst();
    await JOB_HANDLERS['tenant.purge'](wd, { tenantId: x.tenantId });
    const tenantAfterRetry = await t.clients.platform().selectFrom('tenants').select('id').where('id', '=', x.tenantId).executeTakeFirst();
    out('purge-billing-cleanup-recheck', { findingId: 'BW03', firstError, tenantPreservedAfterFailure: !!tenantAfterFirst, tenantRemovedAfterRecovery: !tenantAfterRetry, deleteCustomerCallsAfterTwoRuns: deleteCustomerCalls, resolved: !!firstError && !!tenantAfterFirst && !tenantAfterRetry && deleteCustomerCalls === 2 });
  }
  {
    const x = await tenant('pro');
    const originalClock = d.now();
    d.clock.set('2026-10-01T09:00:00Z');
    const ticket = (await svc.createTicket(d, x.actor, x.venueId, {})).ticket;
    await svc.follow(d, ticket.token, { clientId: 'R'.repeat(22), joinedVia: 'ticket_qr', uaFamily: 'other' });
    await svc.transitionTicket(d, x.actor, ticket.id, { to: 'ready' });
    await svc.transitionTicket(d, x.actor, ticket.id, { to: 'collected' });
    await svc.rollupVenueDay(d, x.tenantId, x.venueId, ticket.business_date);
    d.clock.set('2026-10-10T09:00:00Z');
    const rating = await svc.rateTicket(d, ticket.token, { clientId: 'R'.repeat(22), stars: 5, comment: 'Late review' });
    const targets = (await svc.rollupTargets(d)).filter(r => r.tenantId === x.tenantId);
    for (const target of targets) await svc.rollupVenueDay(d, target.tenantId, target.venueId, target.businessDate);
    const report = await t.clients.forTenant(x.tenantId).selectFrom('report_daily').select(['ratings_count', 'ratings_sum']).where('venue_id', '=', x.venueId).where('business_date', '=', ticket.business_date).where('counter_key', '=', '').where('hour_local', '=', 24).executeTakeFirstOrThrow();
    out('late-rating-never-rolls-up', { ratingAccepted: !!rating, ticketBusinessDate: ticket.business_date, scheduledBusinessDates: targets.map(r => r.businessDate), persistedRatingCount: (await t.clients.forTenant(x.tenantId).selectFrom('ratings').select('id').execute()).length, report });
    d.clock.set(originalClock);
  }
  {
    const x = await tenant('pro');
    const originalClock = d.now();
    d.clock.set('2026-10-22T09:00:00Z'); // Riyadh 12:00
    await t.clients.forTenant(x.tenantId).updateTable('venues').set({ reset_time: '04:00:00', auto_close_time: '22:00:00', next_auto_close_at: new Date('2026-10-22T19:00:00Z') }).where('id', '=', x.venueId).execute();
    const update = await svc.updateVenue(d, x.owner, x.tenantId, x.venueId, { autoCloseTime: '10:00' });
    d.clock.set('2026-10-22T19:00:00Z'); // current business day still closes at 22:00
    await svc.autoCloseVenue(d, x.tenantId, x.venueId);
    d.clock.set('2026-10-23T06:00:00Z'); // next business day, 09:00 local
    const ticket = (await svc.createTicket(d, x.actor, x.venueId, {})).ticket;
    d.clock.set('2026-10-23T09:00:00Z'); // 12:00 local; requested 10:00 passed
    const due = (await svc.venuesDueForAutoClose(d)).some(v => v.id === x.venueId);
    const schedule = await t.clients.forTenant(x.tenantId).selectFrom('venues').select(['auto_close_time', 'pending_auto_close_time', 'pending_from_date', 'next_auto_close_at']).where('id', '=', x.venueId).executeTakeFirstOrThrow();
    out('changed-autoclose-misses-first-effective-day', { advertisedEffectiveBusinessDate: update.pendingFromDate, observedNow: d.now().toISOString(), ticketBusinessDate: ticket.business_date, due, schedule });
    d.clock.set(originalClock);
  }
  {
    const x = await tenant('multisite');
    const p = await t.clients.platform().selectFrom('plans').select('id').where('code', '=', 'multisite').executeTakeFirstOrThrow();
    await t.clients.forTenant(x.tenantId).insertInto('subscriptions').values({ id: uuidv7(), tenant_id: x.tenantId, stripe_subscription_id: 'sub_quantity', plan_id: p.id, period: 'month', venue_quantity: 1, stripe_status: 'active', current_period_start: d.now(), current_period_end: new Date(d.now().getTime() + 30 * 86400000), amount_minor: 1000, currency: 'SAR' }).execute();
    const provider = new svc.FakeBillingProvider('secret', 'https://audit.invalid');
    let providerCalls = 0;
    provider.setQuantity = async () => { providerCalls++; throw new Error('Injected temporary billing outage'); };
    let createError: string | null = null;
    try { await svc.createVenue(d, provider, x.owner, x.tenantId, 'New branch'); } catch (e) { createError = (e as Error).message; }
    const afterFailedCreate = await t.clients.forTenant(x.tenantId).selectFrom('venues').select(['id', 'name']).where('status', '=', 'active').execute();
    const subscriptionAfterFailedCreate = await t.clients.forTenant(x.tenantId).selectFrom('subscriptions').select('venue_quantity').executeTakeFirstOrThrow();
    provider.setQuantity = async (id, quantity) => { providerCalls++; provider.calls.push({ op: 'setQuantity', args: { id, quantity } }); };
    await svc.createVenue(d, provider, x.owner, x.tenantId, 'New branch');
    const afterRetry = await t.clients.forTenant(x.tenantId).selectFrom('venues').select(['id', 'name']).where('status', '=', 'active').execute();
    out('venue-create-provider-outage-partial-commit', { createError, activeVenuesAfterFailedCreate: afterFailedCreate.length, subscriptionAfterFailedCreate, activeVenuesAfterRetry: afterRetry.length, namesAfterRetry: afterRetry.map(v => v.name), providerCalls });
    provider.setQuantity = async () => { providerCalls++; throw new Error('Injected temporary billing outage'); };
    let archiveError: string | null = null;
    try { await svc.archiveVenue(d, provider, x.owner, x.tenantId, afterRetry[1]!.id); } catch (e) { archiveError = (e as Error).message; }
    let archiveRetryCode: string | null = null;
    try { await svc.archiveVenue(d, provider, x.owner, x.tenantId, afterRetry[1]!.id); } catch (e) { archiveRetryCode = (e as {code?: string}).code ?? (e as Error).message; }
    const qty = await t.clients.forTenant(x.tenantId).selectFrom('subscriptions').select('venue_quantity').executeTakeFirstOrThrow();
    const active = await t.clients.forTenant(x.tenantId).selectFrom('venues').select('id').where('status', '=', 'active').execute();
    out('venue-archive-provider-outage-no-retry', { archiveError, archiveRetryCode, activeVenues: active.length, subscription: qty });
  }
  out('dst-overlap-chooses-earlier-instant', { localTime: '2026-11-01 01:30 America/New_York', actual: zonedToUtc('2026-11-01', '01:30', 'America/New_York').toISOString(), requiredLater: '2026-11-01T06:30:00.000Z', afterFirstOccurrence: '2026-11-01T05:45:00.000Z', next: nextOccurrence(new Date('2026-11-01T05:45:00Z'), 'America/New_York', '01:30').toISOString() });
} finally {
  await writeFile(new URL('./backend-workflow-results.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
  await t.stop();
}

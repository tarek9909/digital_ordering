# Backend business workflows and async wiring

Audit date: 22 October 2026. This is a new source review and isolated runtime investigation after reading the previous audit and its repair ledger. It does not repeat A01–A31 or W01–W17 as outstanding findings. No application source was changed by this investigation. Other work was changing security-related application files during the audit; the probes were rerun against the available source, most recently after those changes had appeared. BW03 was fixed by that concurrent work and is retained below only as a resolved recheck.

Evidence: [workflow reproduction script](backend-workflow-probes.mts), [workflow results](backend-workflow-results.json), [support realtime probe](support-realtime-probe.mts), [support realtime results](support-realtime-results.json), [final source SHA-256 snapshot](backend-source-snapshot.json). The latest workflow and support runs both completed with exit code 0. The workflow run produced 11 observations covering eight outstanding defects and one repaired case (BW03). The separate support probe confirms the shared cross-layer finding **CSD10**; it must be counted once with the frontend agent's CSD10, not again as a backend finding. These are characterization probes: the JSON records observed behavior, and exit code 0 means the investigation completed, not that all application behavior was correct.

The script creates and destroys its own MySQL database through `startTestDatabase()`, uses the real services and worker purge handler, and substitutes only clock/KV/queue/storage/push/mailer/billing-provider boundaries. It does not send email, make provider requests, charge a card, or modify a shared tenant. Run from `backend/`:

```powershell
npx tsx ../docs/audits/2026-10-22-completeness/backend-workflow-probes.mts
npx tsx ../docs/audits/2026-10-22-completeness/support-realtime-probe.mts
```

## Confirmed current defects

### BW01 · P1 · One failing webhook can disable an endpoint and abandon unattempted events

**Source:** `backend/packages/services/src/webhooks.ts:204` counts all delivery rows in the last day; `:210` disables when the count is at least 10 and no row succeeded. Rows still `pending` are counted as failures. At `:162`, a disabled endpoint causes the other deliveries to become abandoned before any request.

**Reproduce:** create an endpoint and queue 10 events; execute only the first delivery with a 503 fake receiver. The endpoint immediately becomes `disabled`, `failure_streak:1`. Executing the other nine delivery jobs makes all nine `abandoned`, `attempt:0`. The receiver was called once in total.

**Impact:** an ordinary burst of events plus one temporary receiver failure cuts off the integration and discards orders that were never attempted. This violates TR-WH-03's requirement that at least 10 deliveries failed.

**Fix direction:** evaluate actual attempted failure outcomes and pending/in-flight work separately, with concurrency-safe endpoint health state. A pending delivery is not evidence of failure. Regression: 10 queued rows, one 503, nine not yet attempted must leave the endpoint active and all retryable work eligible for delivery.

**Evidence observation:** `webhook-pending-counts-as-failures`.

### BW02 · P1 · Re-executing a completed billing job can reverse later payment/cancellation state

**Source:** `backend/packages/services/src/billing.ts:277` fetches and applies an event without checking/claiming `stripe_events.processed_at`; `:335` applies `invoice.paid`, `:339` applies `invoice.payment_failed`, and only `:355` writes completion. `backend/packages/services/src/tenants.ts:140` allows a paid invoice to reactivate a cancelled tenant. The intake's duplicate check protects new HTTP intake, but not a billing job already enqueued or concurrently replayed.

**Reproduce:** process failure event A, then successful payment event B. State is `past_due → active`. Re-execute the already completed job for A: state returns to `past_due`. Separately, cancel the tenant and re-execute the old completed B: tenant becomes `active` again without any new payment or subscription.

**Impact:** queue retries/replays can reimpose debt after payment or restore paid access after cancellation. The handler's “safe to run twice” guarantee is false when another event was processed between runs.

**Fix direction:** claim and complete an event atomically with its local state changes, return immediately for completed events, and serialize/reconcile relevant subscription/invoice state so delayed distinct events cannot overwrite the current subscription. A check alone without transaction/lock would still race. Regression: A failure, B paid, replay A must stay active; cancellation, replay old B must stay cancelled.

**Evidence observations:** `processed-billing-event-reapplied`, `processed-payment-reactivates-cancelled`. This probe verifies replay of the same completed event; it does not claim full provider event-order coverage.

### BW03 · Resolved during audit · Tenant purge now retries failed billing-provider cleanup

**Original observation:** the worker caught `deleteCustomer` failure and purged the tenant anyway. The original isolated probe resolved the handler, removed the tenant and made only one provider call across two runs. This was initially a P1 finding because it could strand a provider customer/subscription after local deletion.

**Current source and recheck:** concurrent security work changed `backend/apps/worker/src/handlers.ts:84` to pass the billing provider into `purgeTenant`. `backend/packages/services/src/privacy.ts:153` now lets a temporary provider failure throw before local deletion. The adapted latest probe fails the first provider call, checks that the tenant survives, recovers the provider, and retries the same real worker handler. The tenant is removed only after the second provider call succeeds. See `purge-billing-cleanup-recheck`, with `resolved:true`.

**Status:** resolved by concurrent application changes; excluded from outstanding counts. No actual provider customer was used, so live provider acceptance remains outstanding.

### BW04 · P1 · Venue changes return errors after commit and leave billing quantity permanently inconsistent

**Source:** `backend/packages/services/src/r2.ts:18` synchronizes provider quantity only inline; creation commits its transaction before `:47`, and archiving commits before `:67`. There is no queued reconciliation for a failed quantity update. Archiving retries fail the active-venue lookup at `:54`.

**Reproduce:** use a paid multisite tenant with one branch/quantity one. Make provider `setQuantity` fail, then create a branch. The service throws, but active venue count is now two and subscription quantity is one. Retry after provider recovery: it creates a second identically named branch, so active count and charged quantity become three. Then inject the same outage while archiving a branch: active venue count becomes two, quantity remains three; retry returns `NOT_FOUND` and cannot repair the quantity.

**Impact:** user-visible 500-class provider errors hide successful local writes, retrying creates duplicates, and archived branches can continue being charged. This is an application transaction/workflow defect rather than a deployment issue.

**Fix direction:** record quantity reconciliation durably with the venue transaction, retry against the current active count, and make the operation outcome/retry behavior explicit and idempotent. Regression must verify provider recovery after both create and archive failures without duplicate branches or retained overbilling.

**Evidence observations:** `venue-create-provider-outage-partial-commit`, `venue-archive-provider-outage-no-retry`.

### BW05 · P2 · An earlier auto-close time is missed on its advertised first effective day

**Source:** `backend/packages/services/src/venues.ts:166` computes the next run from the current auto-close time even when a new one is scheduled. `backend/packages/services/src/tickets.ts:811` promotes pending times only when that old scheduled sweep runs in the new business date; `:826` then calculates the next occurrence strictly after that run.

**Reproduce:** venue in Riyadh, reset 04:00, current auto-close 22:00. At noon on 22 October, save auto-close 10:00. The response advertises `pendingFromDate:2026-10-23`. Run the old 22:00 sweep on 22 October. On 23 October create a ticket at 09:00; at noon the venue is not due, still has old auto-close 22:00, and `next_auto_close_at` is 19:00 UTC/22:00 local. The promised 10:00 expiry has already been missed.

**Impact:** tickets remain open for an extra 12 hours on the effective day; the same mechanism also delays scheduled timezone/reset promotion. Requirements BR-27, EX-18, TR-ALG-10/16.

**Fix direction:** schedule the first effective pending occurrence when saving and when advancing the old day's schedule. Keep effective reset/zone and auto-close selection consistent, including cases on each side of reset. Regression: changing 22:00 to 10:00 must expire the new day's 09:00 ticket at 10:00.

**Evidence observation:** `changed-autoclose-misses-first-effective-day`.

### BW06 · P2 · Invalid creation requests spend the trial's real-ticket quota

**Source:** `backend/packages/services/src/tickets.ts:192` increments Redis, and `:262` calls it before counter validation at `:265`, open-ticket limits, numbering allocation, or the ticket transaction. Failed requests never release the reservation.

**Reproduce:** on a verified trial tenant, issue three creates referencing a syntactically valid but nonexistent counter UUID. All return `NOT_FOUND`. No ticket rows exist, but `t:{tenantId}:tickets:{businessDate}` contains `3`.

**Impact:** validation/transient failures can exhaust the daily limit while fewer than 200 real tickets exist; staff are blocked until the next business date. TR-ALG-14 describes a ticket-creation quota, not an attempted-request quota.

**Fix direction:** reserve after validation and release failed reservations, or account for committed creates with concurrency-safe admission. Regression must include failed validation, transaction failure, and concurrent successful creates without overspending or bypassing the limit.

**Evidence observation:** `failed-creates-spend-trial-quota`.

### BW07 · P2 · Accepted ratings on older tickets never reach historical reports

**Source:** `backend/packages/services/src/venue-features.ts:218` accepts a rating on any retained collected ticket, with no age cutoff or targeted rollup enqueue. `backend/packages/services/src/reports.ts:262` only revisits today/yesterday; worker `handlers.ts:144` uses exactly those targets.

**Reproduce:** collect and roll up a ticket on 1 October; submit a five-star rating on 10 October. The rating is accepted and persisted. Run every scheduled rollup target for that venue: only 9/10 October are rebuilt, and the 1 October whole-day report still has `ratings_count:0`, `ratings_sum:0`.

**Impact:** ratings lists and exported source data disagree permanently with trends/averages until a manual rebuild. Although TR-RPT-02 only promises routine +1-day reopen corrections, the rating endpoint remains open for the retained ticket and needs its own historical refresh policy.

**Fix direction:** enqueue the ticket's business-date rollup after rating writes, or define/enforce a consistent rating window. Regression: an accepted late rating must appear in that ticket day's report.

**Evidence observation:** `late-rating-never-rolls-up`.

### BW08 · P2 · Autumn DST overlap chooses the earlier instant and can skip today's scheduled run

**Source:** `backend/packages/domain/src/time.ts:52` obtains offsets at `:56–57` that can both be on the same side of an autumn transition. Sorting those duplicate candidates cannot discover the later overlap instant. `nextOccurrence` then advances the date when that early candidate is past.

**Reproduce:** `zonedToUtc('2026-11-01','01:30','America/New_York')` returns `05:30Z`, while TR-ALG-01 requires the later valid `06:30Z`. At `05:45Z`, `nextOccurrence(...,'01:30')` skips the still-upcoming `06:30Z` occurrence and returns `2026-11-02T06:30Z`.

**Impact:** accepted DST zones can auto-close an hour early or miss a day's close when saving/recomputing during an overlap. Saudi Arabia itself does not use DST, so this is most relevant to the supported configurable-zone scope. The existing domain test covers the spring gap, not this overlap.

**Fix direction:** use a timezone conversion implementation with explicit later disambiguation, or enumerate offsets on both sides of the transition and validate all round-tripping candidates. Regression: both gap and overlap, including `after` between the two repeated wall times.

**Evidence observation:** `dst-overlap-chooses-earlier-instant`. Both expected and actual UTC instants round-trip through the local Intl timezone database; no external timezone service was used.

### BW09 · P2 · Replaying fanout creates duplicate deliveries despite its deterministic event ID

**Source:** `backend/apps/worker/src/handlers.ts:89` describes stable fanout event IDs as preventing duplicate events, but `backend/packages/services/src/webhooks.ts:146` inserts a fresh row every call. `backend/packages/db/migrations/0001_initial.sql:609` has no event/endpoint dedupe constraint.

**Reproduce:** invoke `fanOutWebhook` twice with the same tenant, venue, event ID and subscribed endpoint. The database contains delivery IDs 1 and 2 with the same event ID. Both are eligible to send. A worker retry after creating rows but before all delivery jobs are queued follows this path.

**Impact:** partial fanout retries multiply outbound work, attempt counters and endpoint-failure counts. Receivers should already deduplicate at-least-once webhook delivery by event ID, so this observation alone does not demonstrate duplicate business effects in a correctly implemented receiver.

**Fix direction:** make original fanout idempotent per event/endpoint while preserving the intentional explicit redelivery path. Regression should fail after one target row is inserted/queued, retry, and verify only one original delivery per subscribed endpoint.

**Evidence observation:** `webhook-fanout-replay-duplicates`.

### CSD10 · P1 · Approved support can load the staff board over HTTP but cannot authenticate its realtime connection

**Source:** the HTTP actor resolver at `backend/apps/api/src/http/middleware.ts:100` resolves the support cookie on staff routes. Realtime `backend/apps/realtime/src/server.ts:93` only checks device (`:94`) and user-session (`:104`) cookies before rejecting the staff handshake at `:113`; it never resolves `dop_sup` / `__Host-sup`. The staff frontend sets socket state false on connection errors at `frontend/apps/web-staff/src/board/boardData.ts:106`, and `frontend/apps/web-staff/src/lib/store.ts:85` treats that as offline, disabling board actions.

**Reproduce:** create an ordinary support-role platform user, request access through `requestSupport`, have the tenant owner approve it, and complete `enterSupport` plus `exchangeSupportHandoff`. The resulting cookie resolves to an active `support` actor and `GET /api/staff/v1/board?venueId=…` returns **200** with its ticket. Present the same cookie/tenant host/origin to the actual realtime server with `{app:'staff',venueId}`: the handshake returns **UNAUTHENTICATED**. Controls: no cookie gets HTTP **401** and socket **UNAUTHENTICATED**; an owner session on the same host gets HTTP **200**, connects, and receives an actual Ready transition over the socket.

**Impact:** the approved support agent can see the initial board snapshot, but the board reports offline, receives no live events and disables actions. The HTTP support workflow and realtime authentication policy are incomplete across layers.

**Fix direction:** authenticate approved support sessions in realtime with the same tenant/venue scope, expiry/revocation checks and permission policy as HTTP. Ensure active sockets are disconnected or rechecked when the support session ends. Regression must use the actual support handoff cookie against both HTTP and socket paths, with owner/no-cookie/cross-tenant/expired-session controls.

**Evidence:** [support realtime results](support-realtime-results.json). The probe uses a real local Socket.IO server/client, not mocked socket callbacks. The frontend's disabled-action consequence is traced from source; this backend probe does not render the frontend.

## Coverage and limits

| Area | Examined/exercised here | What remains unproved |
| --- | --- | --- |
| Ticket lifecycle | Creation/ready/collected/follow/rating, trial admission, transitions/outbox source, scheduling and number allocation source | All role/check-code/concurrency combinations; parent audit owns route sweep and general integration suite |
| Alerts/queues | First/repeat/reconcile/recipient tracking source; deterministic ID/outbox repair source; worker dispatch and schedules traced | Actual VAPID/device delivery; queue loss/deadletter acceptance; no repeat of prior repaired A08/A31 probes |
| Realtime | Handshake/rooms/fanout/revocation/presence source inspected; actual approved-support HTTP/socket comparison, owner/no-cookie controls, live Ready event | Display/customer reconnect/expiry matrix; parent/existing integration suite owns the broader realtime testing |
| Billing | Real intake/processor with fake signed events, processed-event replay, deletion-provider failure, create/archive quantity failures; checkout/plan-change/grace/trial checks source reviewed | Stripe sandbox checkout/tax/proration/portal/schedules; provider-specific payload certification; no actual cards/customer deletion |
| Signup/provisioning | Isolated signups used for every scenario, verification gate, tenant-core transaction and outbox/source traced | Actual verification/welcome SMTP, invitation/browser OAuth flow acceptance |
| Privacy/retention | Actual worker purge with failed external cleanup and successful provider recovery; BW03 now resolved; purge order/export/retention source traced | Full legal retention policy, backup erasure, storage implementation acceptance, large-memory export bounds |
| Reports | Real MySQL report rollup, late rating, scheduled targets, pending time change and DST conversion | Every timezone/report filter, replica lag, load/large-range behavior, all platform-report financial formulas |
| Integrations | Actual fanout/delivery/failure-disable behavior with fake receiver; API idempotency/key and POS connect/webhook source inspected | Foodics partner payload/OAuth certification, real receiving systems/network outages, second POS connector |

Passing baseline suites, successful route rendering, and these focused probes do not establish 100% application completeness. Required external-provider/device/browser/accessibility/load acceptance remains a separate coverage gap, as already documented in the prior repair ledger.


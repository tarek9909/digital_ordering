# Tanbeeh application completeness audit

> **Update:** the findings below were repaired after this audit. See [REPAIRS.md](REPAIRS.md) for the fix, validation and remaining dependency of each item. The audit probes in this folder now assert the corrected behaviour.

Audit date: 22 October 2026. Scope: the six frontend applications, backend APIs, business rules, database interactions, realtime delivery, worker jobs, and BRD/TRD workflow completion. DevOps and the explicitly deferred backlog are excluded.

**The application is not complete or ready for a completeness sign-off.** Its main ticket journey works in the local stack, and the existing suites pass, but production queue wiring breaks core workflows. Independent probes also reproduce authorization, billing, notification, reporting, and error-handling defects. Application source was left unchanged; the files in this directory are audit evidence and reproduction tools.

## Most urgent findings

| ID | Priority | Failure | Observed result |
| --- | --- | --- | --- |
| A01 | P1 | Application job IDs are rejected by the installed BullMQ adapter | Signup and exports return 500; ticket changes return success without any realtime publication; billing events become stranded |
| A02 | P1 | Trial owners can enable Pro without checkout | Plan changes to Pro, API access becomes enabled, and an API key is issued with zero billing-provider calls |
| A03 | P1 | Google login skips an enrolled application second factor | A user who must enter TOTP for password login can manage a single-venue tenant after Google login without application TOTP |
| A04 | P1 | Completed MFA is lost during tenant handoff | Successful www password plus TOTP login becomes `401 MFA_REQUIRED` after choosing a multi-venue tenant |
| A05 | P1 | API keys remain usable after a prohibited downgrade | Standard allows zero keys, but a retained key still creates tickets with 201 |
| A06 | P1 | Deactivated named staff keep valid personal tokens | The cached token still identifies the deactivated member and refreshes its sliding lifetime |
| A07 | P1 | A second ticket falsely reports that background alerts are enabled | An existing browser subscription is detected but never linked to the new ticket follower |
| A08 | P1 | Notification retries can be consumed before successful delivery | A failed repeat is marked sent; retry skips the sender entirely |
| A09 | P1 | Billing receipt is marked duplicate before successful enqueue | Retry acknowledges an event whose `processed_at` is still null |
| A30 | P1 | Tenant purge cannot resume after a temporary storage failure | The tenant is removed first; retries report done while objects and tenant KV data remain |
| A31 | P1 | A failing push recipient gets no retry when other followers exist | With one 201 and one 503, the job resolves successfully and creates zero retry jobs |

P1 means fix before release. P2 means a functional defect or missing required workflow that must be resolved before claiming the relevant release scope complete. Source-only gaps are identified separately from executable reproductions.

## Verification results

| Check | Result | What the result establishes |
| --- | --- | --- |
| Backend strict typecheck, lint, production build, contract synchronization | Pass | Static/build consistency |
| Backend unit tests | 53 pass | Existing domain, auth, tenant-scope and contract assertions |
| Backend integration tests | 48 pass across 8 files | Existing MySQL HTTP/service/realtime scenarios; most use in-memory queues and fake providers |
| Frontend typecheck and production builds | All six pass | All six apps compile and bundle |
| Frontend existing tests | 107 pass across 13 files | Existing frontend assertions |
| Frontend bundle budgets | All pass | Configured compressed JavaScript budgets |
| Shared contracts and translation keys | Match | Generated contracts match backend; English/Arabic keys align |
| Existing browser journeys, desktop Chromium and mobile Chromium | Latest full run: 4 pass | Ticket create → follow → Ready → acknowledge → Collected; Undo Ready |
| Earlier desktop journey run | 1 pass, 1 fail | Undo returned to preparing but omitted its customer notice; subsequent targeted test reproduces the sequence-gap failure |
| Added frontend characterization tests | 12 pass | These deliberately assert current defects; passing reproduces the defects, plus confirms display counter filtering |
| Browser render crawl | 57 views captured across all six apps; no uncaught JavaScript exceptions | Route rendering, selected tabs, API failures and screenshots; not every form submission or realtime behavior |
| API boundary sweep | All 193 registered routes exercised anonymously; no unexpected 500 or protected-route success | Route/auth/error boundaries only; not successful execution of every API workflow |
| Focused backend and requirements probes | Confirmed failures recorded in JSON/JSONL | Real MySQL, real HTTP/service code, actual BullJobs adapter validation, and injected provider failures |

The anonymous sweep observed 2 responses with 200, 1 with 204, 22 with 400, 158 with 401, 8 with 404, and 2 with 410. Expected public responses and validation/authentication failures are not defects. The route registry includes webhook and connector routes; health/readiness/internal routes sit outside that registry.

Tests ran with Node 24.11.1 on Windows. The repository specifies Node 22 or newer. Queue probes used installed BullMQ 5.81.5 and local Redis 3.0.504 with its version check disabled only to reach JavaScript option validation. The job-ID rejection occurs before executing Redis job scripts; these probes do not establish Redis 7 worker acceptance.

## Runtime confirmed backend defects

### A01 Background job identifiers break core application wiring

`backend/packages/jobs/src/bull.ts:25` forwards application job IDs unchanged. Installed BullMQ rejects the generated IDs for email, first push, repeats, export, purge, Stripe events, and webhook fanout with `Custom Id cannot contain :`. Examples include `email:<hash>`, `push:<ticket>:1:1`, and `whf:<outboxId>`. Their generators include `services/src/email.ts:45`, `outbox.ts:45`, `outbox.ts:48`, `outbox.ts:67`, `billing.ts:173`, and `privacy.ts:169`.

The actual adapter/HTTP probe produced:

- Signup returned **500**, while the tenant and owner remained persisted. A retry therefore encounters an account that was partially created.
- Ticket creation returned **201** and Ready returned **200**, but **zero bus events** were published and both outbox rows stayed pending. Fanout scheduling runs before publication, so invalid job IDs also block the realtime event.
- Export returned **500**, leaving a `queued` export row.
- A Stripe event could not enqueue; its next receipt returned `duplicate:true` with `processed_at:null`.

The test queue implementation accepts these IDs, explaining why the existing integration suite passes. Use deterministic IDs accepted by the actual queue adapter, preserve deduplication, and add contract tests against that adapter. Recovery must also handle already-persisted pending rows rather than only changing future IDs.

Evidence: [adapter results](backend-job-ids.jsonl), [actual HTTP results](backend-real-queue-flow.jsonl), and their adjacent `.mts` reproduction scripts.

### A02 Trial users can enable paid entitlements without checkout

At `backend/packages/services/src/platform-tools.ts:197`, `changePlan` updates the tenant immediately when no subscription exists. An ordinary trial owner can POST `/api/admin/v1/billing/change-plan` with `{"planCode":"pro","period":"month"}`. The probe received **200**, `api_access` changed from false to true, and API-key creation returned **201**, with **zero provider calls**. This enables Pro features during the trial without the intended checkout path. Require a valid commercial transition before assigning paid entitlements.

### A03 Google sign in skips enrolled application TOTP

`backend/packages/services/src/account.ts:126` creates the OAuth session without applying the enrolled-TOTP challenge used by password sign-in. For the same account, password login required MFA, while the Google callback returned 302 and tenant management returned **200** without application TOTP. The probe stubbed Google's identity verification and exercised real account/session/handoff code. Preserve the user's application second-factor policy across authentication methods; this finding does not claim Google identity verification itself was bypassed.

### A04 Tenant handoff discards completed MFA

`backend/packages/services/src/auth.ts:275` stores no session assurance in the handoff; line 286 always creates the tenant session with MFA false. Direct tenant login plus TOTP allowed management (**200**), but successful www login plus TOTP followed by tenant selection produced **401 MFA_REQUIRED**. The already-enrolled UI then asks the user to sign in again. Carry verified assurance through the single-use handoff. Requirements: TR-AUTH-06, TR-AUTH-11.

### A05 Downgrade checks ignore existing API keys

`backend/packages/services/src/platform-tools.ts:193` hardcodes API-key usage to zero. The resolver at `services/src/integration.ts:47` also does not enforce current-plan API entitlement. A downgrade to Standard succeeded despite one active key and a zero-key target limit; that key still returned **200** from `/v1/me` and **201** from `/v1/tickets`. Count actual usage, block disallowed downgrades, and enforce the effective entitlement on continued use. Requirement: FR-BIL-10.

### A06 Deactivated named staff retain personal tokens

`backend/packages/services/src/r2.ts:98` deactivates a staff member, but `staffMemberFor` at line 121 trusts cached member data and refreshes its lifetime without checking active status. A token still resolved after deactivation. Invalidate outstanding personal sessions and recheck active membership when authorizing actions.

### A08 A transient failure permanently consumes an automatic repeat

`backend/packages/services/src/alerts.ts:114` advances `auto_alerts_sent` before the send succeeds. A repeat's first send returned 503; retry returned `{"skipped":true}`. The sender was called only once, while `auto_alerts_sent` was already 2. The early throw also prevents that attempt's live/display alert publication. Track delivery attempts separately from successfully completed repeats, with retry-safe side effects.

### A09 A queue failure can permanently strand a Stripe event

`backend/packages/services/src/billing.ts:166` inserts the event before enqueueing and treats any existing row as a duplicate. The actual queue probe failed the first enqueue, then received `duplicate:true` on retry while `processed_at` remained null. This durability defect also applies to a transient queue outage after job IDs are fixed. Retry unfinished events or enqueue them through a durable outbox.

### A10 Ordinary authenticated API inputs produce unhandled 500 responses

All cases below were reproduced using real MySQL and actual HTTP handlers. They should produce a validation/conflict response or a documented no-op.

| Request | Input | Current response | Source |
| --- | --- | --- | --- |
| PATCH `/api/admin/v1/counters/:id` | Change prefix B to an existing active prefix A | 500 INTERNAL_ERROR | `services/src/venue-features.ts:44` lacks creation's duplicate-key mapping |
| PATCH `/api/admin/v1/counters/:id` | `{}` | 500 INTERNAL_ERROR | `venue-features.ts:49`, empty SQL update |
| PATCH `/api/admin/v1/venues/:id` | `{}` | 500 INTERNAL_ERROR | `venues.ts:163`, empty SQL update |
| PATCH `/api/admin/v1/displays/:id` | `{}` | 500 INTERNAL_ERROR | `venues.ts:401`, empty SQL update |
| GET `/api/staff/v1/board?venueId=bad` | Invalid UUID | 500 INTERNAL_ERROR | `apps/api/src/routes/staff.ts:47`, unmapped Zod exception inside handler |
| GET `/api/admin/v1/reports/trends` | `from=2026-99-99&to=2026-99-99` | 500 INTERNAL_ERROR | `admin-r11.ts:24`, format-only date validation |
| GET `/api/admin/v1/reports/heatmap` | Same impossible dates | 500 INTERNAL_ERROR | Same date schema |

These are separate from the queue-induced signup/export 500s and the intentionally injected customer-page 500 used to test its UI.

### A11 Deleting a rating comment removes its stars from reports

`backend/packages/services/src/venue-features.ts:224` sets `deleted_at`, while `reports.ts:117` excludes deleted ratings from rollups. Removing only the comment and rebuilding changed rating count **1 → 0** and average **5 → null**. Retain the star contribution. Requirement: FR-RPT-08.

### A12 Closed tickets retain pending claims

`backend/packages/services/src/venue-features.ts:171` expires requests by age but omits the closed-ticket condition. Claim → collect ticket → run claim expiry still returned `pending`. Expire claims when their ticket closes and keep customer/staff projections consistent.

### A13 Timezone changes apply before their advertised effective date

`backend/packages/services/src/venues.ts:160` writes `time_zone` immediately while advertising `pendingFromDate` tomorrow. The probe changed Asia/Riyadh to UTC immediately on 22 October while returning an effective date of 23 October. This can change business dates, schedules and reports mid-day. Defer the timezone change consistently with reset/auto-close changes. Requirement: TR-ALG-16.

### A14 A disabled report feature remains accessible

After setting `reports_trends:false`, the trends endpoint still returned **200**. `backend/packages/services/src/reports-r11.ts:56` and route `admin-r11.ts:109` have no entitlement gate. Source searches also show no service consumers for `display_speech` and `combined_reports`; those two overrides were not runtime-probed. Requirement: FR-SA-11.

### A15 Tenant search cannot find an owner email

`backend/packages/services/src/console.ts:26` filters name/slug only, fetching owner emails after filtering/pagination. Slug search returned one tenant; that owner's exact email returned zero. Include owner email in the query. Requirement: FR-SA-04.

### A16 A second slug rename releases an unexpired old address

`backend/packages/services/src/account.ts:22` overwrites a single `previous_slug`; line 31 can only resolve that value. Rename A → B → C within minutes: A first redirected to B, then its redirect disappeared and A became available to another tenant. Keep all unexpired aliases/reservations for the promised 180 days. Requirement: TR-URL-03.

### A17 Catalogue price changes rewrite reported existing MRR

`backend/packages/services/src/platform-tools.ts:327` joins subscriptions to the current active catalogue price by plan/period. Adding a price changed existing-subscription MRR from **17,900 to 29,900 minor units**, with zero subscription-provider changes. Aggregate each subscription's actual contracted price/currency rather than the current catalogue. Requirement: FR-RPT-07.

Backend evidence for A02, A04–A06, A08, A10–A13 is in [backend-probes.jsonl](backend-probes.jsonl). Independent evidence for A03–A05 and A11, A14–A17 is in [requirements-probe-results.json](requirements-probe-results.json).

### A30 Tenant deletion cannot resume after a storage failure

`backend/packages/services/src/privacy.ts:130` deletes the tenant row before object cleanup at lines 132–133. A retry exits immediately at line 108 when the tenant is absent. Injecting a temporary storage failure left **two stored objects and tenant KV data**. After storage recovered, retry returned `{"done":true,"deleted":0}` without calling cleanup again. Keep resumable deletion progress until every required store is cleaned. Requirements: TR-PRV-08, TR-PRV-12. Evidence: [final-fault-probes.jsonl](final-fault-probes.jsonl).

### A31 Multiple push followers suppress retries for a failing recipient

`backend/packages/services/src/alerts.ts:95` throws on a retryable push result only when there is exactly one subscription. With two followers receiving **201 and 503**, the job resolved `{"sent":1,"failed":1}`, each recipient had one attempt, and **zero retry jobs** were added. The queue therefore considers the alert completed despite the retryable recipient failure. Retry per recipient without unnecessarily redelivering successful recipients. Requirement: TR-ALR-09. Evidence: [final-fault-probes.jsonl](final-fault-probes.jsonl).

## Runtime confirmed frontend defects

Unless stated otherwise, the reproductions below are preserved in [customer characterization tests](frontend-customer-characterization.test.tsx) and [display characterization tests](frontend-display-characterization.test.tsx). They run actual components/hooks with controlled network, clock, socket and audio dependencies.

| ID | Priority | Failure and reproduction | Source and required correction |
| --- | --- | --- | --- |
| A07 | P1 | Open ticket B with an existing browser PushSubscription. B says “Alerts are on,” but no subscription PUT links it to B's follower. | `web-customer/src/pages/TicketPage.tsx:60`; backend `services/src/tickets.ts:651,704`. Link the subscription for each ticket before reporting successful activation. |
| A18 | P1 | Fail the initial `/follow`, restore connectivity, then receive a new projection. Follow is never retried. | `TicketPage.tsx:60`. The ref is set before success and the error is swallowed. Retry registration and surface failures; later push activation depends on a follower existing. |
| A19 | P1 | Initial realtime connection failure has no error handler, and `resync.required` has no listener. The page can remain apparently connected with stale data. | `TicketPage.tsx:36,121`. Handle connection errors and explicit resync, with snapshot recovery. |
| A20 | P2 | Submit a rating with HTTP 500/network failure. The form disappears and says “Thank you for your feedback!” | `web-customer/src/components/RatingForm.tsx:27`. Show the error and retain the draft for retry. |
| A21 | P2 | Receive an Undo event across a sequence gap. Snapshot becomes preparing, but the explanatory notice never appears. | `TicketPage.tsx:133`. Early stale/gap returns bypass reason handling. Existing browser journey 3 failed this way once; a subsequent full rerun passed, and the focused test reproduces the missed notice deterministically. |
| A22 | P2 | Load “About 5 min” and advance an idle hour. The page still says five minutes and does not become overdue. | `TicketPage.tsx:29,281`. Age the estimate from a deadline or refresh it; current heartbeat does not refresh ticket data. |
| A23 | P2 | Leave a Ready page while its alert audio runs. The old loop is not stopped on unmount. | `TicketPage.tsx:45,78,107`. Add audio-loop cleanup on leaving/changing the ticket. |
| A24 | P2 | Collection closes the customer's socket. Staff reopen while the unpushed customer page stays open; there is no socket or polling to deliver the reopened state. | `TicketPage.tsx:115`. Preserve a suitable resync strategy for the reopen window. |
| A25 | P2 | Select Arabic on an English-browser ticket page; the next ticket update changes it back to English. | `TicketPage.tsx:50`. Apply venue/browser defaults once and preserve explicit language choice. |
| A26 | P2 | Direct internal A → B token navigation reuses A's refs. B is never followed or remembered. | `TicketPage.tsx:43,60`. Reset per-ticket state or key the component by token. Normal navigation via `/tickets` generally unmounts it and does not reproduce this exact path. |
| A27 | P2 | Ready → Undo inside the display's three-second announcement merge window. The ticket leaves Ready, then speech still says it is ready. | `web-display/src/useDisplayBoard.ts:155`; `lib/announce.ts:83,109`. Queue ticket identities and cancel/revalidate pending speech on state change. |
| A28 | P2 | Initial ticket API responds 500 three times. The customer page remains only “Loading…” without a failure message or retry control. | `TicketPage.tsx:202`. Browser failure injection confirmed this. Render non-404 error states explicitly. |
| A29 | P2 | Customer icon requests return HTML instead of images. | `/icon-192.png`, `/icon-512.png`, `/badge-72.png` all returned 200 `text/html`; no corresponding assets exist in the repository. Supply valid assets and verify the built manifest/service worker on devices. |

Display counter filtering was checked and works in the UI: unrelated-counter updates do not enter the displayed list or speech queue. Whole-venue socket payload delivery is not classified here as a visible filter defect.

## Required workflows that remain incomplete

These are verified source omissions or disconnected controls, not claims that a live external provider was tested.

| ID | Priority | Gap | Evidence and requirement |
| --- | --- | --- | --- |
| W01 | P1 for R2 completion | Foodics/POS connect, callback and disconnect workflow is missing | Only GET `/pos/connections` is mounted (`backend/apps/api/src/routes/admin-r2.ts:122`). `web-admin/src/pages/Integrations.tsx:364` permanently disables Connect; connector URL/exchange/save/remove services have no route consumers. Credentials alone cannot complete setup. FR-INT-09. |
| W02 | P1 for commercial completion | Multi-site/custom plans cannot be selected through checkout/change-plan HTTP contracts; initial Pro checkout is still blocked | `backend/packages/contracts/src/api.ts:148,204` limits codes to Standard/Pro; `services/src/billing.ts:321,326` hides/rejects Pro initial checkout. Site `components/Pricing.tsx:9,32` hardcodes SAR99/“coming soon.” Existing paid Standard → Pro change code does exist. FR-BIL-02, FR-SA-10. |
| W03 | P2 | Counter-filtered report exports all counters | `web-admin/src/lib/reports.ts:24` omits `counterId`; strict export schema `admin-r2.ts:155` rejects that field; `services/src/r2.ts:164` has no counter predicate. FR-RPT-04. |
| W04 | P2 | Console create-tenant has no plan/trial-length selection | `web-console/src/pages/CreateTenant.tsx:15,24`; backend contract `api.ts:155`; `services/src/signup.ts:40,57,59` always chooses Trial/global duration. FR-SA-05. |
| W05 | P2 | Account email cannot be changed and reverified | Account email is read-only (`web-admin/src/pages/Account.tsx:34`); profile contract/service permit only name/locale; no change-email workflow is mounted. FR-ADM-18. |
| W06 | P2 | Weekly-summary opt-out has no application control | Scheduler reads `tenant_memberships.weekly_summary` (`reports-r11.ts:105`), but no mounted route/UI writes it. `memberPatch` declares a preference but is unused. FR-RPT-05. |
| W07 | P2 | Many required owner notifications fall back to English | `services/src/emails.ts:44,61,65` has 10 Arabic built-ins for 26 template names. Weekly summary content is built in English (`reports-r11.ts:108`). FR-ADM-19, TR-EML-01. |
| W08 | P2 | Age-based retention is incomplete | `services/src/alerts.ts:274` does not clean expired idempotency keys, old webhook deliveries, or the required historical audit/support records. Reusing/deleting a key or deleting an endpoint is not an age-based retention job. TRD section 18, TR-PRV-06. |
| W09 | P2 | Platform cohort and delivery-health reporting is incomplete | `platform-tools.ts:322` counts conversions by transition date rather than signup cohort; line 346 stores literal zero push/webhook failures. The console only displays aggregate counts. FR-RPT-07, BRD section 12.2. |
| W10 | P2 | Venue address cannot be edited through venue setup | Backend accepts address, but `web-admin/src/components/venue/GeneralForm.tsx:13` excludes it and `lib/types.ts:53` omits it. The separate “Restaurant address” setting changes the tenant slug, not the venue's physical address. FR-ADM-03. |
| W11 | P2 | Chime selection and library management are disconnected | `web-admin/src/lib/settingsForm.ts:5,109` preserves hidden chime settings; console `Settings.tsx:175` lists chimes only. Customer `lib/audio.ts:23` and display `lib/sound.ts:49` synthesize fixed tones without honoring the selected chime; display language mappings are hardcoded. FR-ADM-08, FR-SA-12. |
| W12 | P2 | Published customer privacy content is never consumed | Console can publish `customer_privacy`, but customer `pages/PrivacyPage.tsx:9` renders only a static translation. Site `pages/LegalPage.tsx:48` renders published HTML as escaped text. FR-SA-12 publishing workflow. |
| W13 | P2 | Closed ticket screens have no venue return link | `web-customer/src/pages/TicketPage.tsx:259` and `components/VenueChrome.tsx:38` show final state/footer without the required venue-page return path. FR-CUS-11. |
| W14 | P2 | Ticket manifest is missing/stale after SPA navigation | `web-customer/index.html:13` adds the ticket manifest once at initial document load. `/tickets` → ticket never adds one; direct A → B retains A's manifest. TR-ALR-02. |
| W15 | P2 | Closed-ticket local storage can evade the 24-hour prune | Only TicketPage records `closedAt`; fetching closed tickets on MyTickets does not (`MyTicketsPage.tsx:14`, `lib/storage.ts:39,59`). Closing the ticket tab before collection can retain its entry indefinitely. TR-FE-09. |
| W16 | P2 | Staff recent lists and collected totals change incorrectly over time | `web-staff/src/lib/ticketState.ts:13,85` appends live closed tickets without time pruning; `board/BoardPage.tsx:105,192` calculates/displays counts from that list, while line 265 supplies the Recent drawer. Reload switches to a different recent window rather than today's collection total. FR-STF-01, FR-STF-05. |
| W17 | P2 | Staff PIN lock has no in-page recovery after its duration | `web-staff/src/pages/SignInPage.tsx:58,91,98,110` permanently disables input after PIN_LOCKED until reload, with no timed reset/countdown. FR-ACC-06. |

The more detailed requirement mapping is retained in [requirements-findings.md](requirements-findings.md).

## Workflow coverage and remaining acceptance

| Area | What was inspected or exercised | Remaining acceptance |
| --- | --- | --- |
| Signup, email verification, reset and invitations | Source/routes, existing HTTP tests, site form screens, actual queue signup failure | Real SMTP delivery; browser completion of every token/invitation edge case; queue durability repair |
| Sign-in, MFA, tenant choice, account | Console/user HTTP login, TOTP, OAuth callback stub, handoff probes, account screens | Real Google client redirect/cookie behavior; all role/session-expiry combinations |
| Venue/admin setup | All admin routes rendered; settings, counters, access, devices, displays, posters, team inspected; focused update errors | Every successful save/upload/error combination; non-Latin PDF and print-device acceptance |
| Staff/customer ticket lifecycle | Desktop/mobile journey; real DB state-machine/integration tests; all seeded ticket states; focused customer failure tests | Browser journeys for all claims/cancellation/reopen/multi-counter/named-staff permutations |
| Display and announcements | Pairing and board REST views; realtime suite; speech hook/counter-filter tests | Physical-TV full screen, sound/voice quality, quiet-hour behavior across devices |
| Notifications and jobs | Actual queue adapter rejection; repeat failure injection; subscription wiring; service worker/source tracing | VAPID/provider delivery, device suspension/background behavior, real iOS/Android install/push/volume behavior |
| Billing, plans and tax | Fake-provider tests, actual route/entitlement probes, billing/plan screens | Stripe test-mode checkout/portal/tax/proration/cancellation/webhook replay with actual provider |
| Reports, ratings and exports | Report screens, MySQL rollups, rating deletion, MRR and feature probes, export queue failure | Real object-storage download links, full date/filter/timezone matrix, large-data limits |
| Console and support | All console primary screens, selected tenant tabs, lifecycle/support source and existing tests | Every role/purpose/MFA-freshness branch; complete support grant/revoke/emergency browser journeys |
| Integration API and webhooks | Declared endpoints, existing signature/idempotency/retry tests, post-downgrade key write | Real outgoing receiver/network failures and Foodics partner payload certification; missing POS lifecycle |
| Privacy and retention | Export/deletion/purge source and existing tests; storage-failure purge reproduction; age-based cleanup review | Repair resumable purge; proof of all retention windows and physical-device storage cleanup |

The render crawl used an isolated MySQL API with in-memory jobs and forwarded browser REST calls to it. Its staff/display sockets still pointed to the existing local realtime service, so offline indicators in those crawl screenshots are a harness limitation, not an additional application finding. Realtime acceptance came from the independent integration suite and live existing journeys. The local stack's Redis is older than the runtime queue threshold, so its successful live journey does not validate the BullMQ path.

The seeded audit database had no published terms/privacy/DPA documents; the site correctly displayed “not yet published” and received 404 for those content requests. Publishing actual content remains an environment/content acceptance step, separate from the disconnected customer-privacy workflow above. Real provider credentials/devices were not available for live acceptance. Firefox/WebKit, full-app accessibility, and load/capacity testing were not executed; the existing Chromium journeys include accessibility assertions on their staff/customer views. No percentage of completeness is asserted from counts of passing tests or rendered screens.

## Repair order and completion gates

1. Repair queue IDs and durable enqueue/retry boundaries. Prove signup, reset/invitation email, ticket publication, first/repeat alerts, billing replay, export and purge through the actual queue implementation.
2. Repair authentication assurance and entitlement enforcement: OAuth TOTP, tenant handoff, deactivated staff sessions, paid-plan transitions and API-key downgrade behavior.
3. Repair customer follow/subscription/reconnect logic, alert cleanup, error recovery and display speech cancellation. Turn the characterization cases into tests of the correct outcomes.
4. Eliminate the reproduced 500 cases and repair report/claim/timezone/slug consistency.
5. Complete the required commercial, POS, settings, notification-language, privacy and retention workflows for the declared release scope.
6. Expand browser journeys beyond the two currently implemented journeys. Complete provider sandbox and physical-device acceptance before a completeness sign-off.

## Evidence and rerunning checks

- [193-route registry](backend-route-registry.json) and [anonymous boundary results](api-boundary-results.json).
- [Browser screen observations](browser-crawl.json); full screenshots and five contact sheets are under `frontend/test-results/application-audit-crawl/` (ignored test artifacts).
- [Backend HTTP/service probes](backend-probes.mts) and [results](backend-probes.jsonl).
- [Actual queue adapter validation](backend-job-ids.mts) and [results](backend-job-ids.jsonl).
- [Actual queue HTTP flows](backend-real-queue-flow.mts) and [results](backend-real-queue-flow.jsonl).
- [Requirements probes](requirements-probe.mts) and [results](requirements-probe-results.json).
- [Purge and multi-recipient push failure probes](final-fault-probes.mts) and [results](final-fault-probes.jsonl).
- [Customer tests](frontend-customer-characterization.test.tsx), [display tests](frontend-display-characterization.test.tsx), and [their configuration](frontend-characterization.config.mts).
- Initial failing browser trace: `frontend/test-results/application-audit/journeys-journey-3-Undo-Re-e86cb-ustomer-sees-not-ready-yet--chromium/trace.zip`.

From `backend/`:

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run check:contracts
npx tsx ../docs/audits/2026-10-22/backend-probes.mts
npx tsx ../docs/audits/2026-10-22/requirements-probe.mts
npx tsx ../docs/audits/2026-10-22/backend-job-ids.mts
npx tsx ../docs/audits/2026-10-22/backend-real-queue-flow.mts
npx tsx ../docs/audits/2026-10-22/final-fault-probes.mts
```

The queue scripts use localhost Redis and create randomly named audit queues, cleaning only their own keys. MySQL probes create and remove their own databases. Read the scripts before pointing them at any shared service.

From `frontend/`:

```powershell
npm run typecheck
npm test
npm run build
node tools/check-budgets.mjs
npx vitest run --config ../docs/audits/2026-10-22/frontend-characterization.config.mts
npx playwright test -c e2e --workers=1 --output=test-results/application-audit-full
```

The existing browser journeys create tickets in the configured seeded local tenant. To repeat only the isolated render/boundary checks, start `runtime-server.mts` from `backend/`, start the six normal Vite servers, then run `browser-crawl.mjs` and `api-boundary-sweep.mjs` from the repository root. Stop the isolated runtime afterward so it removes its temporary database.

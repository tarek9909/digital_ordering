# Tanbeeh application completeness audit

22 October 2026. Scope: all six frontend applications, backend HTTP APIs, shared contracts, database-backed business logic, realtime, worker jobs and required MVP/R1.1/R2 workflows. DevOps, deployment and infrastructure hardening are excluded.

**The application is not ready for a 100% completeness sign-off. This audit identifies 31 outstanding functional findings: 10 P1 and 21 P2.** The main ticket journey works, but important failure/retry branches, support access, notification delivery, billing state, account setup and reporting remain incomplete or incorrect.

P1 means resolve before release because a core workflow is blocked, customers miss Ready orders, or financial/legal state becomes unreliable. P2 means a concrete functional defect or required workflow gap that must be resolved before the relevant scope is called complete. These are grouped root causes, not a count of every affected endpoint or missing metric.

No application source was changed by this audit. New reports, controlled reproduction scripts, test evidence and screenshots were added. Existing user work was preserved. The working tree was being changed concurrently by separate security work; findings were rechecked, resolved observations were removed from the active count, and source hashes were saved. Test and probe results describe their recorded snapshots, not an immutable commit.

## Priority findings

| ID | Priority | Failure | Evidence and impact |
| --- | --- | --- | --- |
| AS01 | P1 | Approved support entry crashes tenant admin | The real `/auth/me` support shape has an object in `support` and no `user`; banners treat it as an ordinary user and throw. Component reproduction. |
| AS11 | P1 | MFA setup and removal UI omit newly required proof | Account and mandatory two-factor screens send no password; removal sends no authenticator code. Current UI payload gets 401 while a valid-password API control gets 200. Multi-venue setup cannot complete. |
| CSD01 | P1 | Failed push setup is presented as successful | Rejected subscription setup reaches “You're all set” and `onClose(true)`; the customer is told alerts are enabled without working background delivery. |
| CSD03 | P1 | TV silently clips Ready numbers | Latest 1080p Chromium rendering with Preparing shows only 9 of 24 Ready cards fully. Portrait shows only 3 of 24; no way to access the clipped orders. |
| CSD04 | P1 | Display can remain stale while appearing connected | Fail snapshot resync, restore API, advance 120 seconds: no further retry, `connected:true`. Collected orders can remain or Ready orders disappear. |
| CSD10 | P1 | Approved support cannot authenticate the staff socket | Actual support lifecycle produces HTTP board 200 but realtime `UNAUTHENTICATED`; owner control connects and receives a real Ready update. Staff actions remain disabled. |
| BW01 | P1 | One failed webhook disables an endpoint with nine unattempted deliveries | Ten queued rows plus one 503 causes immediate disable; the other nine are abandoned at attempt zero. |
| BW02 | P1 | Replayed completed billing jobs overwrite newer state | Failure → payment → replay old failure becomes Past due again. Replay an old paid event after cancellation reactivates access. |
| BW04 | P1 | Venue writes and billed quantities diverge after provider errors | Creation throws after committing; retry creates a duplicate branch. Archive throws after committing and retry cannot reconcile overbilling. Real service/provider-failure injection. |
| API02 | P1 | Rejected duplicate legal version replaces published text | Storage is overwritten before the unique DB insert fails. The original published ID/version now serves the rejected replacement HTML. |

## Remaining functional defects and gaps

| ID | Priority | Finding | Evidence boundary |
| --- | --- | --- | --- |
| API01 | P2 | Empty PATCH returns 500 for webhooks, plans, platform users and languages | Actual authenticated HTTP/MySQL; valid CSRF and existing resources. |
| AS02 | P2 | Google registration has no usable tenant-creation completion | New verified Google identity reaches a zero-tenant chooser; suggested ordinary signup returns 409 EMAIL_TAKEN. Public site also lacks the Google entry. HTTP/MySQL + component. |
| AS03 | P2 | Rejected password consumes its reset link | Weak password gets 400; correction using the same link gets 410. Actual HTTP/MySQL. |
| AS04 | P2 | Displayed legal version differs from recorded acceptance | English `english-v1` is shown while newer Arabic `arabic-v2` is recorded accepted. Actual HTTP/MySQL. |
| AS05 | P2 | Signup records DPA consent without including DPA in the consent checkbox | Actual form + persistence source; a footer link does not describe the checkbox's acceptance. |
| AS06 | P2 | Required legal gate disappears on API/network error | Error becomes an empty pending list, leaving ordinary app content accessible. Actual component/query behavior. |
| AS07 | P2 | Cold Reports load loses the sole venue's counter filter | Initial `all` selection survives delayed venue resolution; venue picker is hidden for one venue, leaving no way to select its counters. Actual deferred-response component. |
| AS08 | P2 | Required reporting outputs remain absent | Pilot p90s are omitted from screens despite API data; longest-waiting tickets, total wait/cancellation breakdowns, rating distribution and platform phone/browser reach are missing in their required views. Pilot component + source-confirmed omissions. |
| AS09 | P2 | Coupon creation/listing workflow is missing | Only applying an existing provider coupon exists; documented create/list API and management UI are absent. Source-confirmed requirement gap. |
| AS10 | P2 | Tenant plan filter ignores newly created custom plans | Console filter uses four fixed codes despite catalogue-driven creation/assignment. Actual component + backend wiring. |
| CSD02 | P2 | Owner/manager staff search builds a malformed query string | SDK appends a second `?` after `venueId`; actual HTTP rejects the malformed URI with 400. |
| CSD05 | P2 | Filtered display drops Ready announcements during resync | Ticket event waits for fresh state, alert is checked against old state and discarded. Actual hook/announcer boundary. |
| CSD06 | P2 | Staff/display do not recover a server-refused socket handshake | An inactive refused socket is never explicitly reconnected; staff remains offline. Staff hook reproduced; display parity source-confirmed. |
| CSD07 | P2 | Reloaded staff board loses overdue call-out warnings | Warning depends on a prior ephemeral event rather than sufficient snapshot state. Actual card rule + snapshot/store source. |
| CSD08 | P2 | Ticket-list API failures appear as genuine empty lists | Saved-ticket and venue-list failures hide errors/retry and tell the customer no orders exist. Actual components with failed queries. |
| CSD09 | P2 | Ready collection instruction ignores selected language | English UI renders the first venue locale's Arabic instruction. Actual ReadyScreen. |
| BW05 | P2 | Earlier auto-close misses its advertised first effective day | 22:00 → 10:00 change effective tomorrow still schedules tomorrow's 22:00; the 10:00 close is missed. Real services/clock. |
| BW06 | P2 | Invalid creates consume trial ticket quota | Three rejected counter IDs persist zero tickets but increment daily ticket quota by three. Real services/MySQL/KV. |
| BW07 | P2 | Late accepted ratings never enter historical rollups | Accepted rating for an older ticket persists, while scheduled rebuilds revisit only today/yesterday. Real services/MySQL/rollups. |
| BW08 | P2 | Autumn DST overlap selects the wrong occurrence | New York 01:30 chooses the earlier UTC instant; recomputation between repeated times skips that day's later occurrence. Actual time helpers/Intl, against the TRD's later-occurrence rule. |
| BW09 | P2 | Fanout retry duplicates original webhook deliveries | Same event/endpoint creates two delivery rows. Real MySQL; does not by itself prove duplicate effects in a receiver that deduplicates event IDs. |

## Detailed findings and reproduction evidence

Each linked report includes exact source locations, trigger, observed result, practical impact, repair direction and its coverage limitations.

| Area | Detailed report | Executable evidence |
| --- | --- | --- |
| Customer, staff, display | [CSD01–CSD10](customer-staff-display-findings.md) | `customer-staff-display-*.test.tsx`, [geometry](customer-staff-display-layout-results.json), [support HTTP/socket control](support-realtime-results.json) |
| Admin, console, public site | [AS01–AS11](admin-console-site-findings.md) | [component results](admin-console-site-test-results.json), [HTTP/MySQL results](admin-site-backend-results.json) |
| Backend business logic and jobs | [BW01–BW09](backend-workflow-findings.md) | [workflow results](backend-workflow-results.json), [reproduction](backend-workflow-probes.mts) |
| Authenticated API validation and legal storage | [API01–API02](api-findings.md) | [HTTP results](api-runtime-results.json), [reproduction](api-runtime-probes.mts) |

BW03 is retained in the backend history as **resolved during this audit**, and is excluded from the 31 findings. The latest probe verifies a processor deletion failure preserves the tenant and a recovered retry calls the processor again before completing. This is the same processor-erasure boundary tracked as M-19 in the existing security assessment; it is not a new outstanding finding here. CSD10 appears in both frontend/backend supporting reports but is counted once.

Earlier A01–A31/W01–W17 repairs were read and exercised through the existing suites. The new findings concern additional paths; they do not simply reinstate the old list. For example, the existing-subscription push repair works but new-subscription activation still reports false success; single-ticket error UI works but list failures are concealed; Undo cancellation works but resync can drop a valid display announcement.

## Executed checks

| Check | Recorded result | What it establishes |
| --- | --- | --- |
| Frontend existing tests | 206 passed, 36 files | Existing frontend assertions, rerun after the concurrent UI changes. [Final JSON](frontend-tests-final.json) |
| Backend initial suite | 136 passed, three real-queue tests initially skipped | Initial source baseline; later real-queue run passed all three. |
| Backend final complete suite with Redis 7 | 245 passed, two failed, 247 total | Both fail at MFA enrollment: the old helper sends no proof and receives 401; the actual UI has the same missing-proof problem (AS11). [Final JSON](backend-tests-final.json). An earlier intermediate run recorded 224 passed/two failed with 500 while route wiring was still being edited. |
| New focused frontend defect probes | 9 customer/staff/display + 10 admin/console/site | These deliberately reproduce defects. Passing characterization assertions do **not** mean the app passes acceptance. |
| Actual desktop/mobile Chromium journeys | 14 passed | Staff sign-in/named PIN, create → follow → Ready → acknowledgement → Collected, Undo, reopen, SPA manifest, icons, legal fallback and individual-ticket 500 recovery. [JSON](browser-journey-results.json) |
| Automated accessibility within browser journeys | Staff board and customer waiting screens passed configured axe WCAG checks | A limited automated scan; no full-app accessibility sign-off. |
| Browser route/render crawl | 58 captured views across six apps, plus tenant tabs and asset checks; no uncaught JS errors in ordinary fixture views | Rendering/authenticated reads, screenshots and selected tabs; support failures separately characterized. [Crawl](browser-crawl.json) |
| Display geometry | Six actual Chromium layouts | 720p/1080p/portrait, Ready-only and Preparing+Ready, with exact rectangles and screenshots. |
| Anonymous route sweep | All 207 registered definitions in the probed snapshot exercised; no unexpected 500/protected success | Authentication/validation boundaries only. Later source additions require another sweep. [Per-route JSON](api-anonymous-boundaries.json) |
| Authenticated read sweep | All 71 GET definitions exercised: 56 return 200; no 500 | Remaining responses are logged validation/auth/missing-fixture cases, not successful workflows. [Per-route JSON](api-authenticated-reads.json) |
| Focused backend/API failures | Four empty-PATCH 500s; controlled retry, billing, scheduling, quota, reporting, legal and identity probes | Real code/database with controlled external boundaries. |
| Frontend typecheck, six builds, bundle budgets | Pass at the recorded runs | Compile/build consistency. [Latest statuses](frontend-static-checks-final.json) |
| Backend final static/build checks | Typecheck, lint and esbuild pass; contract synchronization fails | Frontend contracts differ from backend `api.ts`, `audit.ts` and `socket.ts` at this run. [Final statuses](backend-static-checks-final.json), [drift log](backend-final-check-contracts.log). Earlier typecheck/lint failures during edits were corrected. |

The exact counts and latest static status are in the linked machine-readable files. New routes/tests were added by the concurrent work during the audit; the initial and later counts intentionally differ. Intermediate MFA 500s were traced to routes calling changed service signatures; those routes were then rewired, and the later valid-password control returned 200. The remaining user-visible contract failure is AS11.

Screenshots for the route crawl are under `frontend/test-results/application-completeness-crawl/`; the six portable display-layout reproductions are adjacent to this report. Seven representative crawl/layout screenshots were inspected visually in addition to automated geometry and text/error capture. The browser stack used its own disposable API/database, in-memory jobs/KV and fake billing; the separate real-queue tests used isolated Redis 7.4.11. No real emails, card charges or provider deletions were performed.

## Scope coverage and acceptance gaps

The detailed reports contain per-route/per-feature matrices. All six frontend route trees and their matching API/service calls were reviewed, including signup/account/MFA/invitations, setup/settings/branding/messages, ticket/claim/rating flows, staff/device/display access, billing/ownership/support, reports/exports/erasure, platform catalogue/content/flags and POS/webhooks. Review coverage and executed success coverage are different: the evidence does not claim every form, role, state and retry permutation was executed.

| Still required for acceptance | Current evidence and limitation |
| --- | --- |
| Stripe sandbox checkout, portal, invoice tax, proration, downgrades and webhook ordering | Fake provider + real state processing/fault injection. No real Stripe end-to-end acceptance. |
| Google OAuth and Foodics | Fake verified identity/POS providers and source/API tests. Real client credentials, callback behavior and partner payload certification remain unverified. |
| SMTP and actual Android/iOS Web Push | Controlled mail/push boundaries and service-worker source/tests. Device permission, background delivery, PWA install and physical alert behavior remain unverified. |
| Physical TV/audio/speech and printed QR posters | Chromium screenshots, geometry, code/audio tests and API wiring. Actual TV voice availability, loudness, autoplay, screen wake and physical scan/print quality remain unverified. |
| Firefox/WebKit and full accessibility | Current project-version browser install contains Chromium; older unrelated Firefox/WebKit installations are not current-project acceptance evidence. Full browser/assistive-technology runs were not completed. |
| Performance and large-data/fault acceptance | Existing concurrency/latency checks and builds pass their tested scenarios. The 1,000-venue target, sustained throughput, large exports/reports, queue-loss and long outage behavior need dedicated acceptance runs. |
| Every successful write/role/status combination | Existing integration tests plus targeted mutations cover representative paths. The 207-route anonymous sweep cannot certify all authenticated mutations. |
| Stable final release verification | Separate work kept changing source, contracts, tests and dependencies. Freeze a candidate and rerun checks and the bug regressions before sign-off. |

The existing [security assessment](../../security/2026-10-22/SECURITY-AUDIT.md) remains separate. This functional audit does not certify its remaining security findings resolved, and it does not include the excluded DevOps work.

## Repair order and verification criteria

1. Restore coherent account/support contracts: AS01, AS11 and CSD10. Test complete approved-support handoff/admin/staff entry and mandatory multi-venue MFA enrollment through actual forms, with revocation controls preserved.
2. Repair customer delivery: CSD01, CSD03–CSD06 and CSD07. A failed subscription must never say push is enabled; an online stale display must recover; every shown order must fit or have an explicit overflow policy; resync must preserve valid announcements.
3. Make financial and outbound work retry-safe: BW01, BW02, BW04 and BW09. Inject failures before/after commits, replay completed jobs after later events, and verify recovery without duplicate branches, false debt, lost delivery or retained excess quantity.
4. Preserve legal/version and recovery correctness: API02, AS02–AS06. Rejected duplicates must not alter published bytes, consent must name the exact displayed documents, and a recoverable validation error must leave a usable correction path.
5. Finish the remaining API, report, filter, localization, quota and scheduling findings. Each should have a regression that asserts repaired behavior rather than the current defect.
6. Run all existing and repaired regression suites on one stable source snapshot, then complete the provider/device/browser/data-volume acceptance above. Passing these local checks is necessary but does not establish 100% completeness by itself.

Reproduction commands and prerequisites are in each linked report. `source-snapshot-before.json`, `source-snapshot-after.json`, `source-snapshot-final.json` and `backend-source-snapshot.json` retain hashes to distinguish observations from subsequent edits. Do not merge the defect-characterization tests into a release gate unchanged: convert/supplement them with assertions requiring the corrected behavior.

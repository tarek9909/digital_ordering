# Repairs for the 2026-10-22 audit

This file tracks every finding in [REPORT.md](REPORT.md), A01–A31 and W01–W17. For each one it gives the fix, how it was validated, and what is still needed before live acceptance. The validation runs against isolated test databases, fake providers and stub providers. **No live provider, real device or production account was used.** Passing these tests does not prove that Stripe, Web Push, Google, Foodics, SMTP or a physical TV or phone works.

Main regression suites:

- **Backend, HTTP and service regressions:** `backend/apps/api/test/audit-repairs.int.test.ts`. It is referred to as *AR* below. It has 29 tests, one or more per finding.
- **Real queue:** `backend/apps/worker/test/queue.int.test.ts`. It is referred to as *RQ* below. It runs BullMQ on Redis ≥ 5 through the worker's own processor.
- **Converted audit probes:** in this folder. They now assert the corrected outcome and fail if a defect returns.
- **Frontend:** app tests plus the converted `frontend-*-characterization.test.tsx`. 19 of their 21 original cases failed on the pre-fix code; the other 2 are control cases.

## Findings A01–A31

| ID | Fix | Validation | Remaining dependency |
| --- | --- | --- | --- |
| A01 | **Job IDs:** IDs are built with `jobId()` from `.` separated parts, and `assertValidJobId` applies BullMQ's own rules in `BullJobs` and `MemoryJobs`. **Durable enqueue:** every enqueue goes through the outbox (`enqueueJobs`). Bus events and jobs are separate stages (`event_published_at`, then `published_at`), each with its own retry backoff. Relay rows already pending are processed with the new IDs. **Signup** creates the user and the tenant in one transaction. **Recovery sweeps** were added: `billing.replay`, `webhooks.sweep` and `tenants.purge-resume`. | RQ: signup, email, events, first push, export, billing and purge all run on Redis 7.4.11. AR: a queue outage still gives signup 201, events are published, and the jobs enqueue later. `backend-job-ids.mts` and `backend-real-queue-flow.mts` both pass. | CI runs RQ on `redis:7` (`TEST_REDIS_URL`). It was not run against the production Redis. |
| A02 | A tenant can change plan only through its paid subscription. Without one it gets 403 `TENANT_INACTIVE {checkout:true}`. Platform users may still assign any plan. | AR, `r11-platform` test, `backend-probes` | – |
| A03 | Google sign-in for a user with an authenticator returns an MFA challenge (`#mfa=` fragment). No session exists before the code is entered. | AR (stub Google), `requirements-probe` | A real Google OAuth client |
| A04 | The handoff carries the www session's `mfa_verified_at`. An admin step-up endpoint (`POST /auth/v1/mfa/verify`) replaces "sign out and in again". | AR, `requirements-probe` | – |
| A05 | `usageOf` counts real API keys. Each API request re-checks the current plan's `api_access` and its per-venue key limit. | AR, `requirements-probe` | – |
| A06 | A personal-PIN token is re-checked against `staff_members.active` and the venue, and is deleted when the member is inactive. | AR | – |
| A07 | The customer page links an existing browser subscription to each ticket (PUT) before saying alerts are on. If that fails it shows an error. | Customer and audit tests | Real push on Android and iOS |
| A08 | A repeat records its claim once; a retried job continues the same attempt. Each recipient's outcome is stored (`alert_deliveries`). | AR, RQ | – |
| A09 | The Stripe event and its job are stored in one transaction. A redelivered event that has not been processed is enqueued again. An event for an unknown tenant is recorded as processed. | AR, RQ | Stripe test-mode replay |
| A10 | Validation errors use 400 with `parseInput`. Dates are real calendar dates with a range check (`dateRange`). Empty PATCH bodies do nothing. A duplicate prefix on update is rejected with 400. | AR (all 7 cases), `backend-probes` | – |
| A11 | Deleting a comment sets `comment_deleted_at`; the stars stay in lists and reports. The migration repairs rows deleted earlier. The admin app shows "Comment removed". | AR, `r11` test, admin tests | – |
| A12 | The claim sweep also expires claims on closed tickets and publishes `claim.decided`. The staff list and `claimStatus` read them as expired straight away. | AR | – |
| A13 | `pending_time_zone` applies from the next business date, like the reset and auto-close times (domain `businessDate` and `effectiveTimeZone`). The admin app shows the scheduled zone. | AR, admin tests | – |
| A14 | Trends, heatmap and the weekly email need `reports_trends`. Reports across venues need `combined_reports`. Without `display_speech` the display gets an empty language list, so it chimes without speaking. | AR, display hook test | – |
| A15 | Tenant search also matches active members' emails, before paging. | AR, `requirements-probe` | – |
| A16 | Old slugs are kept in `tenant_slug_aliases` for 180 days. The migration backfills them. The TLS allow-list uses the aliases. | AR, `requirements-probe` | – |
| A17 | `subscriptions.amount_minor` and `currency` record the contracted price; MRR uses them. | AR, `requirements-probe` | Stripe test-mode subscription events |
| A18 | Following is a state machine with backoff and a visible warning. | Customer and audit tests | – |
| A19 | `connect_error` and `resync.required` handlers trigger a refetch, and the page polls while the connection is offline. | Customer and audit tests | – |
| A20 | A failed rating shows an error and keeps the draft. | Customer and audit tests | – |
| A21 | The Undo notice is decided before the sequence-gap check. | Customer and audit tests, e2e journey 3 | – |
| A22 | The wait estimate counts down from a deadline and turns overdue. | Customer and audit tests | – |
| A23 | The alert audio is stopped on unmount; the page is keyed by ticket token. | Customer and audit tests | Audio on real devices |
| A24 | The socket stays open for 30 minutes after collection, measured from server `collectedAt`. | Customer and audit tests, e2e | – |
| A25 | An explicit language choice is kept; the default is applied once. | Customer and audit tests | – |
| A26 | Per-ticket state resets between tickets. | Customer and audit tests | – |
| A27 | The announcer tracks ticket IDs, cancels on Undo and re-checks before speaking. | Display and audit tests | Speech on a real TV |
| A28 | An error screen with retry replaces "Loading…". | Customer and audit tests, e2e | – |
| A29 | Generated PNG icons, served as `image/png`. | Asset test, e2e | Install on real devices |
| A30 | The purge removes storage and cache first and the tenant row last; the deletion email is queued in the same transaction. Retries resume, and an hourly sweep re-queues stuck purges. | AR, `final-fault-probes` | – |
| A31 | Only the recipient that got a retryable error is resent; the job throws `RetryablePushError` so the queue retries it. | AR, RQ, `final-fault-probes` | – |

## Workflows W01–W17

| ID | Fix | Validation | Remaining dependency |
| --- | --- | --- | --- |
| W01 | Adds a provider list, connect (single-use state, 10 minutes), the OAuth callback on the API host, and disconnect. A POS location cannot be taken over by another tenant. The admin app shows connect, result banners and disconnect, or says that no provider is configured. | AR (stub provider), admin tests, cross-tenant suite | Foodics partner credentials, field-mapping confirmation, certification |
| W02 | The catalogue is served at `GET /public/v1/plans`. Checkout and change-plan accept any public plan code, subject to usage limits. Plan pickers were added in admin billing, site pricing and console change-plan. | AR, admin, site and console tests | Stripe test-mode checkout |
| W04 | The console's create-tenant form has plan and trial-length fields. | AR, console tests | – |
| W03 | The CSV export accepts `counterId`; the admin app sends it. | AR, admin lib test | – |
| W05 | Email change confirmed with the password, a link to the new address, a notice to the old one, and other sessions signed out. The site has a `/confirm-email` page. | AR, admin and site tests | Real SMTP delivery |
| W06 | A weekly-summary opt-out (`PUT /admin/v1/me/preferences`) with a toggle on the admin account page. | AR, admin tests | – |
| W07 | Every email template is in Arabic and right-to-left; completeness is enforced by the type system. The weekly summary is built from figures in the reader's language. | `services/test/content.test.ts` | Proof-reading by a native speaker |
| W08 | `retention.misc` removes idempotency keys older than 24 hours, webhook deliveries older than 30 days, alert records older than 7 days, audit and support records older than 2 years, and export files. | AR | – |
| W09 | The platform report adds sign-up cohorts, delivery health (from real push and webhook outcomes) and churn against tenants active at the start of the range. | Console tests; rollup covered by AR (A17) | – |
| W10 | The venue address is part of the admin general form. | Admin tests | – |
| W11 | A chime library: built-in chimes plus MP3 upload in the console, a picker in admin, playback of the chosen chime on the customer page and the display, and voices from the platform language list. | AR, client-sdk, customer, display and console tests | Real phones and TVs, and CDN CORS for chime files |
| W12 | Legal HTML is sanitised against a strict allow-list when stored and again when served (`html`). The customer privacy page and the site legal pages render it. | `content.test.ts`, AR, customer and site tests, e2e | Counsel-approved texts |
| W13 | Closed tickets have a "Back to venue" link. | Customer tests, e2e | – |
| W14 | The ticket manifest is managed on every navigation. | Customer tests, e2e | Home-screen install |
| W15 | Closed tickets are recorded on My Tickets, and old entries are pruned. | Customer tests | – |
| W16 | "Collected today" comes from the server, by venue business date; Recent ages from `closedAt`. | AR, staff tests | – |
| W17 | `PIN_LOCKED` carries `retryAfterSeconds`; the sign-in and member PIN pads count down and unlock themselves. | AR, staff tests | – |

Migration `backend/packages/db/migrations/0003_audit_repairs.sql` adds the outbox stages, `alert_attempts`, `alert_deliveries`, `tenant_slug_aliases`, `venues.pending_time_zone`, `subscriptions.amount_minor` and `currency`, and `ratings.comment_deleted_at`. It also backfills aliases, contracted prices and deleted comments.

## Reproduce and accept

From `backend/`. The real-queue suite needs Redis 5 or later. Without it the suite is skipped and prints a warning.

```bash
npm run typecheck && npm run lint && npm run check:contracts && npm run build
TEST_REDIS_URL=redis://127.0.0.1:6390 npm test          # 139 tests incl. RQ and AR
REDIS_URL=redis://127.0.0.1:6390 npx tsx ../docs/audits/2026-10-22/backend-job-ids.mts
REDIS_URL=redis://127.0.0.1:6390 npx tsx ../docs/audits/2026-10-22/backend-real-queue-flow.mts
npx tsx ../docs/audits/2026-10-22/final-fault-probes.mts
npx tsx ../docs/audits/2026-10-22/requirements-probe.mts
npx tsx ../docs/audits/2026-10-22/backend-probes.mts      # log of corrected outcomes
```

From `frontend/`:

```bash
npm run typecheck && npm test && npm run build && node tools/check-budgets.mjs
npx vitest run --config ../docs/audits/2026-10-22/frontend-characterization.config.mts
npx playwright test -c e2e --workers=1   # needs the local API (:4000), realtime (:4001) and Vite servers
```

Local runs used a portable Redis 7.4.11 for Windows on port 6390, started only for these tests. The local development stack still has Redis 3, so its API uses the in-memory queue. The browser journeys therefore do not exercise BullMQ; the real-queue suite does.

**Still needed for acceptance:**

- Stripe test-mode checkout, portal, tax, proration and webhook replay.
- VAPID keys and real Android and iOS push devices.
- A Google OAuth client.
- Foodics partner access and certification.
- An SMTP provider.
- A physical TV for sound, voices and full-screen behaviour.
- Firefox and WebKit browser runs.
- An accessibility review of the whole app.
- Load tests.

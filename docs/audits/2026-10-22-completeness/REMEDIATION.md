# Application completeness remediation — 2026-10-22/23

Repairs for the 31 active findings in [REPORT.md](REPORT.md): AS01–AS11, CSD01–CSD10, BW01, BW02, BW04–BW09, API01, API02. BW03 is not counted. It was resolved during the audit, and its processor-deletion retry is preserved. CSD10 is counted once. Nothing was deployed or published, and no real email, charge, provider call or push was made. The audit's original evidence (probes, JSON, screenshots) is unchanged. Post-repair evidence is under [`after/`](after/) and [`after-browser/`](after-browser/).

**Scope changed during the work.** On the user's instruction, separate work removed Stripe billing and public self-signup. Venues are now onboarded from the console and pay offline; the platform team records payments (migration `0006_manual_billing.sql`). Six findings were therefore re-assessed against the new model rather than repaired as written: AS02, AS05, AS09, BW02 and BW04 are re-scoped, and the C-1 Stripe webhook no longer exists. Each re-scoped finding still has a regression that proves the current behaviour.

Status legend:
- **Repaired:** reproduced on current source, fixed, and covered by a regression that asserts the repaired behaviour.
- **Re-scoped:** the original code path no longer exists. The replacement was checked, new defects found there were fixed, and the result is covered by a regression.
- **Scope decision:** a choice that needs the user's confirmation.

| Status | Count | IDs |
| --- | --- | --- |
| Repaired | 26 | AS01, AS03, AS04, AS06, AS07, AS08, AS10, AS11, CSD01–CSD10, BW01, BW05, BW06, BW07, BW08, BW09, API01, API02 |
| Re-scoped and repaired | 4 | AS02, AS05, BW02, BW04 |
| Re-scoped, scope decision | 1 | AS09 |
| **Total** | **31** | |

## Verification on the final tree

| Check | Result | Audit's last baseline |
| --- | --- | --- |
| Backend typecheck, lint, `check:contracts` | clean / clean / in sync | contract sync failed |
| Backend unit | **175 passed** | — |
| Backend integration with **real Redis 7.4.11** (`TEST_REDIS_URL`) | **198 passed, 0 skipped**, including the real-BullMQ suites (`queue.int.test.ts`, `webhook-fanout-queue.int.test.ts`) | 245 passed / 2 failed (combined) |
| Backend `npm run build`, `npm audit` (all + production) | ok, 0 / 0 | — |
| OpenAPI (`npm run openapi`) | regenerated; integration v1 spec unchanged | — |
| Frontend typecheck (6 apps), `npm test` | clean, **295 passed** (56 files) | 206 passed |
| Frontend `npm run build`, bundle budgets, `npm audit` | ok, all within budget (web-display 142.4/150 KB, web-site 194.1/200 KB), 0 | — |
| Browser journeys, Chromium desktop + mobile | **16/16 passed**: the audit's 14 journey/recovery checks plus 2 new repaired-flow journeys | 14 passed |
| Browser journeys, Firefox (Playwright 1.64 build) | **9/9 passed** | not run |
| Browser journeys, WebKit (Playwright 1.64 build) | **8/9 passed**. A28 cannot be exercised: Playwright's WebKit route interception does not see the service worker's request, so the page reached the real API and correctly showed "Ticket not found". The A28 error/retry UI passes in Chromium, Firefox and unit tests | not run |
| TV geometry in Chromium (`frontend/tools/display-layout-check.mjs`) | **16/16 scenarios** at 1280×720, 1920×1080 and 1080×1920, with/without Preparing, three promo cases and prefixed numbers. Every rendered tile fits, overflow is indicated, and rotation reaches all 24 (or 30) numbers. Screenshots inspected | 9 of 24 fully visible at 1080p with Preparing |
| Audit's characterization probes (unchanged; they assert the defects) | Customer/staff/display: 8 of 9 now **fail**, meaning the defects no longer reproduce. The CSD07 probe still "passes" because its fixture has no server overdue flag, so not showing red is now correct. The admin/console/site probe file no longer loads: it imports the deleted `SignUpPage` | 9 + 10 reproduced |

Environment:
- Disposable MySQL 8.4 per test file, via `mysql-memory-server`.
- Real BullMQ on Redis 7.4.11. This is the redis-windows community build, downloaded from its GitHub release with the published SHA-256 `EC629971…A2A9` verified, bound to 127.0.0.1:6479 with protected mode on and no persistence.
- Browser journeys ran on an isolated stack (`after-browser/stack.mts`: API 4400, realtime 4401, Vite 5273–5278) with its own database, seeded demo data and no providers. The developer stack on 4000/4001 and 5173–5178 was not touched.
- Firefox and WebKit were installed with `npx playwright install`.

## Findings

### Account, support and MFA

| ID | Status | Repair | Evidence |
| --- | --- | --- | --- |
| **AS01** Support entry crashed admin | Repaired | `web-admin/src/lib/me.ts`: `normalizeMe()` turns the server's support response (`support: {agentName, supportSessionId}`, no `user`) into one client identity with `support: true`, and sets or clears the support-mode flag. `useTenant()` waits for `/me`, so a support agent's first render never calls the owner-only `/tenant`. That was a second bug found while testing. `lib/types.ts` gains `agentName` and `supportSessionId`. Allowed data calls traced: every support-visible screen calls only support-permitted routes. | `web-admin/src/pages/securityFlows.test.tsx` (normalisation; Banners render with no `/tenant` or `/announcements` call). Browser: `after-browser/repaired-journeys.spec.ts` › AS01 + CSD10 in Chromium, Firefox and WebKit: real handoff, admin banner, no page errors |
| **AS11** MFA forms lacked proof | Repaired | Ordinary and mandatory enrolment both send the password (Google-only accounts: a sign-in within 15 minutes). Removal sends a current code. A wrong password or code is shown on its field; the multi-venue refusal and the "sign in again" requirement have clear en/ar messages. **Browser-only bug fixed:** the admin client treated any 401 from a mutation as an ended session and redirected to sign-in, so a wrong password logged the user out of the form. Credential-check mutations now opt out (`meta.credentialCheck`) and re-read `/me`, so a really ended session still redirects. Files: `pages/Account.tsx`, `lib/api.ts`, en/ar `admin.json`. | `securityFlows.test.tsx` (enrol sends password; wrong password then retry; mandatory screen sends password; removal sends code; multi-venue refusal). Browser: AS11 journey in all three engines: wrong password → field error → retry → QR → confirm → on; wrong code → field error; right code → off |
| **CSD10** Support could not open the staff socket | Repaired | `services/src/support.ts` `resolveBoardSupport()`: the same rule as the HTTP staff API (cookie on its tenant's host, active session, agent still allowed (H-6), tenant staff access, venue of that tenant). The realtime handshake accepts it; the socket joins a `support:<id>` room and is re-checked every minute. Ending, leaving, expiring or agent changes publish `user.revalidate {supportSessionId}`, which closes it on every instance. | `apps/realtime/test/security-realtime.int.test.ts` › CSD10 (real lifecycle: connect, live Ready update, closed on end, refused after; no cookie / other tenant host / other venue refused; open socket closed on expiry). Browser journey: live ticket on the board, then offline after the agent ends the session; kept cookie gives 401 on `/me` and the board |
| **AS02** Google registration dead end | Re-scoped and repaired | There is no self-signup any more, so a Google sign-in for an unknown address now creates **no** user or identity and redirects to `/sign-in?google=no-account`. The site explains that restaurants are set up by the Tanbeeh team. The public site has a "Continue with Google" entry. Invited owners link Google through the existing password-proof link step (M-1 preserved). The chooser's zero-tenant state already points to Contact. Files: `services/src/account.ts`, `routes/auth-r11.ts`, site `SignInForms.tsx`, `SignInPage.tsx`, en/ar `site.json`. | `apps/api/test/completeness-auth.int.test.ts` › AS02 (no rows created, no session; invited owner links then sees their tenant). `web-site/src/pages/SignInPage.test.tsx`. The security M-17 test now uses an existing account |
| **AS03** Rejected reset password spent the link | Repaired | `resetPassword` checks the new password (breached list, length, email) before touching the link, then consumes the link and updates the password in one transaction with a conditional update. | `completeness-auth.int.test.ts` › AS03 (`password123` → 400, the same link then works, a third use → 410; concurrent resets: one 204, one 410) |

### Customer, staff and display

| ID | Status | Repair | Evidence |
| --- | --- | --- | --- |
| **CSD01** Failed push reported as success | Repaired | The activation sheet reports one of none / live-only / push / blocked / failed. Push counts only after the PUT succeeds, after waiting for this ticket's follow registration (a shared promise, which removes the race). Failure stays visible with a retry. "Alerts are on" appears only for push or live-only, each with its own wording. | `web-customer/src/components/ActivationSheet.test.tsx` (5), `pages/TicketPage.delivery.test.tsx` (2) |
| **CSD02** Malformed staff search URL | Repaired | The SDK's `withQuery()` merges query parameters through one `URLSearchParams` path for every request; staff `vq()` uses it. Backward compatible. | `client-sdk/src/http.test.ts` (3), `web-staff/src/lib/api.search.test.ts` (2) |
| **CSD03** TV clipped Ready numbers | Repaired | Capacity is measured from the live layout (re-measured on resize, font load and column changes). Overflowing lists rotate every 8 s with page dots, "Page x of y" and "+N more", in fair ready-time order, with the newest highlight pinned. Preparing is capped to whole tiles with "+N more". Grid rows size to content; tiles use `vmin` (portrait gets 2 columns); long numbers widen columns; the promo strip is planned for the whole list. | `web-display/src/lib/board.paging.test.ts` (10, including a busy-venue fairness simulation), `components/BoardView.test.tsx` (3). Chromium script: 16/16 scenarios, screenshots in [`after/`](after/) (inspected: 1080p 3×3 grid "Page 1 of 3 · +15 more", portrait 2×4 grid "Page 1 of 4 · +16 more", nothing clipped) |
| **CSD04** Stale display after a failed snapshot | Repaired | A `stale` flag stays set until a snapshot succeeds; retries back off 2–60 s while online and fire again on `online`; the "Reconnecting" badge stays visible and the last data stays on screen; a 401 goes to pairing. | `web-display/src/useDisplayBoard.resync.test.tsx` |
| **CSD05** Ready announcement lost during resync | Repaired | `ticket.alert` is queued with ticket events during reload and checked against the fresh board's counter filter. Alerts more than 60 s old are dropped; the next round covers them. | `useDisplayBoard.resync.test.tsx` (chimed, spoken and highlighted; other counter still filtered) |
| **CSD06** Refused handshake never retried | Repaired | Shared `client-sdk/src/reconnect.ts`: inactive sockets are re-checked over HTTP and retried with jittered back-off. HTTP 401 is terminal (staff signed out / display pairing). UNAUTHENTICATED while HTTP still works retries 5 times, then staff shows "live updates refused" and the display polls every 30 s. RATE_LIMITED and other refusals keep retrying; going online retries at once. | `client-sdk/src/reconnect.test.ts` (5), `web-staff/src/board/boardData.socket.test.tsx` (4), display tests (2) |
| **CSD07** Overdue call-out lost on reload | Repaired | The `alert.overdue-flag` job and the reconciliation store the flagged round in `tickets.overdue_round` (migration 0009). It is written only while the ticket is still Ready in that round and does not change seq or version. The staff projection exposes `overdueRound`, and the card computes the call-out from it; the live event still speeds this up. | `services/test/overdue-projection.int.test.ts` (3), `web-staff/src/lib/ticketState.overdue.test.ts` (3) |
| **CSD08** List failures shown as empty | Repaired | My Tickets: loading / empty / partial failure (loaded tickets kept, retry for the rest; a ticket is forgotten only on 404) / unavailable. Venue page: not-found only for a 404; a failed my-tickets call shows an alert with a retry. | `web-customer/src/pages/listErrors.test.tsx` (6) |
| **CSD09** Ready instruction ignored the language | Repaired | Selected language first, then the venue's default. | `components/ReadyScreen.test.tsx` (2) |

### Integrations, billing and venues

| ID | Status | Repair | Evidence |
| --- | --- | --- | --- |
| **BW01** One failure disabled an endpoint | Repaired | The outcome is recorded under `FOR UPDATE` on the endpoint row, and the streak increment is atomic. Only attempted deliveries (`attempt > 0`) since `max(24 h ago, health_since)` count. The disable is conditional (one owner email); re-enabling sets `health_since`. | `apps/api/test/workflow-repairs.int.test.ts` (1×503 among 10 queued stays active and the other 9 deliver; 10 real failures disable it, 9 do not; re-enable resets; 10 parallel failures → streak 10, one disable; a concurrent success prevents the disable) |
| **BW09** Fanout retry duplicated deliveries | Repaired | `webhook_deliveries.is_original` plus `UNIQUE (tenant_id, endpoint_id, event_id, is_original)` (migration 0007). The backfill keeps the oldest row per event and endpoint as the original; nothing is deleted. A retried fanout reuses the pending original row; admin redeliver inserts `is_original = NULL`. | `workflow-repairs.int.test.ts`; **real BullMQ** `apps/worker/test/webhook-fanout-queue.int.test.ts`: a failed second enqueue, BullMQ retry → 3 originals, each receiver called once |
| **BW02** Replayed billing work overwrote newer state | Re-scoped and repaired | Stripe event processing is gone; new races were found and fixed in its replacement. Status sweeps (lapse → past due, grace → suspension, trial expiry) apply only if their condition still holds on the locked row (`StatusChange.onlyIf`). `markPaid` is guarded and recomputes. A crash between payment and `markPaid` is reconciled by `graceCheck`; cancellations are never undone. `recordPayment` takes the tenant lock, replays an identical `requestId`, and refuses a duplicate `reference`. Free months are idempotent per `requestId`. The console payment and free-months forms send one id per opened form. | `workflow-repairs.int.test.ts` (row-lock interleavings for the three sweeps, which fail with the guard disabled; concurrent and replayed payments; duplicate reference; lost-`markPaid` reconciliation; cancellation kept; HTTP route); `completeness-auth.int.test.ts` › free months once per request id |
| **BW04** Venue writes and billing diverged | Re-scoped and repaired | Provider quantity sync is gone. `createVenue` is one transaction under the tenant lock and refuses a duplicate active name, so a retry after a timeout gets `VALIDATION_FAILED` with the existing `venueId` instead of a second branch. `archiveVenue` is one locked transaction; a repeat archive is a no-op. Ticket creation takes a shared lock on the venue, so nothing lands in a venue being archived. | `workflow-repairs.int.test.ts` (retry, 3 parallel creates → 1, archive retry, parallel archives, ticket in an archived venue → 404) |

### Scheduling, quota, ratings and API

| ID | Status | Repair | Evidence |
| --- | --- | --- | --- |
| **BW05** First effective auto-close missed | Repaired | `nextScheduledOccurrence` (`domain/time.ts`): an occurrence belongs to the new schedule once its business date is on or after `pendingFromDate`; the earliest valid occurrence wins. Used when saving and when auto-close runs (under the venue lock). | `workflow-repairs.int.test.ts` (22:00 → 10:00: the 09:00 ticket expires at 10:00 next day; zone change); `packages/domain/test/time-schedule.test.ts` |
| **BW06** Failed creates spent trial quota | Repaired | The quota is reserved after validation and released when the create does not commit (failure, over-limit refusal, idempotent replay). | `workflow-repairs.int.test.ts` (3 invalid creates and an injected transaction failure cost nothing; exact limit; 8 concurrent creates never pass 3, counter equals committed tickets) |
| **BW07** Late ratings missing from history | Repaired | `rateTicket` rebuilds that ticket's business-date rollup at once (best effort). `rollupTargets` also includes days of tickets rated in the last 26 h, so the hourly job repairs a failed rebuild. Index on `ratings.created_at` (migration 0008). | `services/test/completeness.int.test.ts` › BW07 |
| **BW08** DST overlap took the earlier instant | Repaired | `zonedToUtc` checks offsets on both sides of the day and returns the latest instant showing that wall time; the spring gap is unchanged. `nextOccurrence` starts one local day earlier. | `time-schedule.test.ts` (New York 01:30 → 06:30Z; from 05:45Z → same-day 06:30Z; spring gap 02:30 → 07:30Z; Berlin unchanged) |
| **API01** Empty PATCH returned 500 | Repaired | Empty PATCH on webhooks (including `rotateSecret:false`), plans, platform users and languages is a documented no-op after an existence check (404 when missing), as A10 already does elsewhere. | `workflow-repairs.int.test.ts` (real HTTP routes: no-op, 404, real changes still applied) |
| **AS07** Cold Reports lost the counter filter | Repaired | An untouched venue filter follows the current venue once venues load; deliberate choices (including All venues) are kept. | `web-admin/src/pages/completeness.test.tsx` |
| **AS08** Report outputs missing | Repaired | Pilot prep and pickup p90 (admin daily and console pilot), Today's 5 longest-waiting tickets, trends' median total wait plus cancellation count and reasons, rating distribution over all retained ratings, and platform alert reach by phone type. en/ar labels. | `services/test/completeness.int.test.ts` (figures checked against seeded events), `apps/api/test/completeness.int.test.ts` (`/ratings` summary), admin and console `completeness.test.tsx` |
| **AS10** Plan filter ignored custom plans | Repaired | `GET /console/v1/plan-options` (`console.tenants.read`: code, name, archived; prices stay behind `console.settings`). The Tenants filter is built from it, falling back to built-in codes. | `apps/api/test/completeness.int.test.ts` (support, finance and super admin get 200; support and finance are refused `/plans`), console `completeness.test.tsx` |

### Legal

| ID | Status | Repair | Evidence |
| --- | --- | --- | --- |
| **API02** Rejected duplicate overwrote published text | Repaired | The version is reserved first (a unique `uploading` row); content goes to a fresh key `legal/<kind>/<docId>.html` and the row is then marked `ready`. On failure only that attempt is removed, never an existing object; reservations abandoned for over 10 minutes are reclaimed. Only `ready` rows are published or served. Migration 0008 (`status` defaults to `ready` for existing rows, whose keys are kept). | `services/test/completeness.int.test.ts` (rejected duplicate leaves bytes unchanged; concurrent create has one winner; storage failure; failure after write; stale reclaim) |
| **AS04** Displayed and accepted versions differed | Repaired | A written policy: for each of terms, privacy and DPA, accept the newest published version in the viewer's language, or the newest in any language if none exists in theirs. One shared rule (`currentLegalDocument`) serves the public page and the gate. The gate shows the exact content and records the exact ids; a stale or partial list is refused (400) with nothing recorded. The public page takes `?document=<id>`. | `services/test/completeness.int.test.ts`, `apps/api/test/completeness.int.test.ts`, site `LegalPage.test.tsx` |
| **AS05** Consent did not name the DPA | Re-scoped and repaired | The signup form is gone, so owners consent in the admin legal gate after their console invitation. It shows all three documents with an explicit checkbox naming Terms, Privacy and the DPA and records only the ids shown. Seeded or test-created tenants no longer record acceptances nobody was shown. | as AS04, plus admin `completeness.test.tsx` |
| **AS06** Legal gate failed open | Repaired | It fails closed and recoverably: a blocking "checking" state, a blocking error with Retry after one automatic retry, and a refetch when stale. | admin `completeness.test.tsx` |
| **AS09** Coupon management absent | Re-scoped, **scope decision** | Coupons were Stripe-only and were removed with Stripe; no coupon UI, API or contract remains (the historical audit label is kept so old rows display). Under offline billing, a discount is expressed as the amount recorded with the payment. **The user should confirm this reduced FR-SA-10 scope, or ask for a discount feature.** | source check; no dangling routes |

## Migrations and operator steps

- **New migrations, applied in order:**
  - `0007_webhook_dedupe_payment_requests.sql`: webhook originals plus backfill, endpoint health window, payment `request_id`.
  - `0008_legal_versions_reports.sql`: legal document status/created_at, `ratings.created_at` index.
  - `0009_ticket_overdue_round.sql`.
  - `0010_session_authenticated_at.sql`, from the concurrent security work.
- **Order matters:** the Kysely migrator refuses out-of-order files, so a persistent database that ever applied a later file before an earlier one needs attention. Disposable and test databases are fine.
- **Existing data is kept:**
  - Legal rows become `ready` with their current keys.
  - Webhook rows are backfilled without deleting anything; old duplicates cannot be told from deliberate redeliveries.
  - Already-overdue tickets are flagged by reconciliation within about a minute.
  - Recorded legal acceptances are kept. Users are prompted again only where their language's current version differs.
- **Visible changes after deploy:**
  - The admin legal gate briefly shows "Checking for updated terms…" on load and on language change.
  - TVs rotate pages when Ready numbers overflow.
  - A Google sign-in for an unknown address no longer creates an account.

## Remaining limitations and external acceptance

- **Not verified with real providers or devices:**
  - Web Push delivery and permission prompts on real Android/iOS.
  - Physical TV audio, speech, autoplay and old TV browsers (geometry was checked only in headless Chromium with a fixed snapshot).
  - Real Google OAuth and Foodics.
  - SMTP deliverability.
  - Assistive technology beyond the journeys' automated axe checks.
  - Load and large-data behaviour.

  All provider behaviour was tested with controlled fakes.
- **WebKit A28:** not exercisable through Playwright's route interception (service-worker request); covered in the other engines and unit tests.
- **Known minor items:**
  - The integration API response still includes staff-only fields at runtime (`overdueRound`, `closedAt`, `businessDate`); they are the tenant's own data and absent from the typed contract and OpenAPI.
  - The highlighted TV tile's 600 ms pop briefly overshoots by about 4%.
  - Late-rating rebuilds add one venue-day rollup to the rating request.
  - The console Content page can show Publish on a row for the instant it is still uploading; the server refuses it.
- **Evidence harness:** the audit's `admin-console-site-characterization.test.tsx` imports the deleted `SignUpPage` and no longer loads. It is kept unchanged as historical evidence.
- **Freeze before sign-off:** several sessions edited this tree concurrently (the Stripe/self-signup removal, a security review that added `authenticated_at`, the password re-check budget and sealed email links, and a frontend restyle on a separate branch). The verification above is of the tree at 2026-10-23 ~03:30 local; freeze a release candidate and rerun the same commands before release. Passing these checks does not by itself establish 100% completeness.

## Rerun

From `backend/`:

```sh
npm run typecheck && npm run lint && npm run check:contracts
npm run test:unit
TEST_REDIS_URL=redis://127.0.0.1:6479 npm run test:integration
```

`TEST_REDIS_URL` must point at Redis 5 or newer. The temporary Redis 7.4.11 used here was deleted afterwards; to get it back, download it again from the redis-windows GitHub release and check its SHA-256, or point at any Redis 7. Without it, the real-BullMQ suites skip themselves.

From `frontend/`:

```sh
npm run typecheck && npm test && npm run build && node tools/check-budgets.mjs
node tools/display-layout-check.mjs
```

Browser, isolated stack: start `after-browser/stack.mts` from `backend/` (with `STACK_INFO=<private file>`), then the six Vite apps with `DOP_API=http://127.0.0.1:4400 DOP_RT=http://127.0.0.1:4401` on ports 5273–5278. Then run `npx playwright test -c ../docs/audits/2026-10-22-completeness/after-browser/playwright.config.ts`, adding `E2E_ALL_BROWSERS=1 --project=firefox` or `--project=webkit` for those engines. Restart the stack between engines: its sign-in and MFA lock-outs are real and carry over.

# Implement the application completeness repairs

You are working in `C:\Projects\digital order` on Tanbeeh. Implement and verify the functional repairs in:

- `docs/audits/2026-10-22-completeness/REPORT.md` — consolidated audit and the authoritative finding IDs.
- Its four supporting reports: `customer-staff-display-findings.md`, `admin-console-site-findings.md`, `backend-workflow-findings.md`, and `api-findings.md`.
- The adjacent reproduction scripts, JSON evidence, screenshots and coverage matrices.

This is an implementation request. Fix the frontend, backend, contracts, database logic and asynchronous wiring required by all 31 active findings. Do not stop after another audit, a plan, the P1 findings, or backend-only repairs. DevOps, deployment and unrelated redesign are outside this task.

## Establish the current state

Read repository instructions, the BRD/TRD and the current implementation before editing. The audit was taken while other work was changing security code, UI, dependencies and tests. Its line numbers and test totals are historical evidence, not a frozen checkout. Reproduce each finding against current source; if it is already repaired, prove that with an appropriate regression and record its disposition.

Preserve all existing user changes, including untracked application code, current visual styling and security repairs. Do not reset, clean, overwrite unrelated work or revert newer code to the audit snapshot. Coordinate overlapping changes if another agent is active. Keep edits focused on the functional requirements.

The active scope is AS01–AS11, CSD01–CSD10, BW01, BW02, BW04–BW09, API01 and API02: **31 findings**. BW03 was repaired during the audit and is excluded; preserve its verified processor-deletion retry behavior. CSD10 is described in two supporting reports but is one finding. Earlier A01–A31/W01–W17 repairs are context and regression obligations, not an extra outstanding list.

Read the existing security audit and any remediation ledger where your changes overlap authentication, support, billing, legal content or erasure. Preserve required MFA, fresh proof, browser-bound OAuth, revocation, CSRF, tenant isolation, plan restrictions and other current security boundaries. Restore functional wiring without weakening those requirements. This task does not authorize unrelated security/DevOps changes.

## Implement the repairs

Prioritize release blockers, then finish every remaining finding. The detailed reports define triggers and acceptance evidence; the following is a working checklist, not a replacement for them.

1. **AS01, AS11, CSD10 — account and support wiring.** Make the real support identity response work throughout tenant admin, including handoff, layout, banners and allowed data calls. Support staff realtime must enforce the same approved-session policy as HTTP and lose access on expiry/revocation. Wire password/current-factor proof and removal codes into account and mandatory MFA forms, backend schemas and services. Verify error recovery and Google-only account behavior under the current policy. Fix the actual UI and update obsolete test helpers; do not merely change expected statuses or bypass proof requirements.

2. **CSD01–CSD09 — customer, staff and display behavior.** Report push enabled only after the ticket's subscription is actually linked; show honest live-only, blocked and operational-failure states with usable recovery. Fix query construction for owner/manager staff search in the appropriate shared/client layer. Make Ready orders fit or provide an explicit usable overflow/rotation policy across landscape, portrait, Preparing and promo layouts. Retry failed snapshots while retaining visible stale state; preserve eligible Ready announcements during resync. Recover transient refused socket handshakes without endlessly retrying terminal authentication failures. Restore overdue call-out state from authoritative snapshot/deadline data. Distinguish empty ticket lists from partial/server/network failures and provide retry. Honor the selected language for Ready collection instructions.

3. **BW01, BW02, BW04, BW09 — retry-safe integrations and billing.** Count attempted webhook failures rather than pending work before disabling an endpoint. Make completed billing-event processing idempotent under replay and concurrency, and protect newer subscription/payment/cancellation state from stale work. Make venue create/archive and provider quantity synchronization durable and recoverable without duplicate branches or retained overbilling. Deduplicate original webhook fanout per event/endpoint while preserving deliberate redelivery. Use transactions, locking, idempotency and durable reconciliation where needed; an in-memory flag or an unlocked preflight check is insufficient. Include recovery for already-stranded state where the necessary identifiers remain.

4. **API02, AS02–AS06 — legal integrity, signup and recovery.** Rejected duplicate legal versions must leave published bytes and acceptance meaning unchanged, including concurrent creation and storage/DB failure. Complete Google registration for authenticated users without a tenant, including restaurant details, slug, country and explicit legal consent, and expose the public entry point. Preserve deliberate identity-linking and OAuth security policy. Validate a reset password before consuming its link, then atomically consume/update on successful reset. Tie consent to the exact displayed immutable document versions/locales, include the DPA in signup consent, and make the pending-legal gate recoverable on API failure instead of silently disappearing. Keep account/recovery paths deliberately usable.

5. **API01, BW05–BW08, AS07–AS10 — remaining completeness.** Handle empty PATCH requests consistently for webhooks, plans, platform users and languages with a documented no-op or validation response, never an unhandled 500. Apply pending reset/zone/auto-close settings at the correct first effective occurrence. Count committed tickets for trial quotas with correct concurrency/failure accounting. Rebuild the relevant historical report after an accepted late rating. Correct DST overlap disambiguation and next-occurrence scheduling while preserving spring-gap behavior. Fix cold-load report venue/counter selection. Implement every missing AS08 reporting output identified in its table, not only the pilot p90s, and verify the figures against source events. Implement the documented coupon create/list/management API, provider wiring and console UI. Populate tenant plan filters from the actual catalogue with appropriate role access.

For each repair, trace the full path: UI action → client/contract → HTTP authorization/validation → service/transaction → jobs/realtime → displayed result. Cover reload, reconnect, retry, empty/error states and relevant owner/manager/staff/support/platform roles. Preserve English/Arabic behavior, accessibility and the current design. Add deliberate data migrations and recovery steps when required; do not silently discard existing records or legal acceptances.

## Test the repaired behavior

The audit's new characterization tests deliberately assert defects. A passing characterization test means the defect reproduced; it is not a post-fix acceptance result. Preserve the historical assessment and evidence. Add or convert appropriate release regressions so they require correct behavior, and document any evidence harness that intentionally retains old assertions. Do not falsify old JSON/screenshots or remove tests merely to obtain green output.

Use disposable MySQL databases, an isolated supported Redis for real BullMQ tests, and controlled mail/push/billing/storage/POS boundaries. Do not use the user's shared development data for destructive scenarios. Do not send real messages, charge cards, delete real provider customers, deploy or publish. Never print or commit secrets or browser authentication state.

At minimum verify:

- Complete support approval → handoff → admin → staff board, successful realtime updates, and expiry/revocation rejection; owner and unauthenticated controls.
- Ordinary and mandatory MFA enrollment, invalid proof retry, confirmation, removal and policy refusal through actual forms.
- Failed push subscription persistence never produces a success claim; per-ticket registration remains correct.
- TV geometry at 1280×720, 1920×1080 and 1080×1920, with enough Ready orders to overflow, Preparing and relevant promo settings; inspect screenshots visually.
- Failed snapshot recovery, refused-handshake recovery and Ready events/alerts arriving during resync; overdue state after a fresh board load.
- Webhook pending/failing mixtures, replayed fanout and explicit redelivery; billing event replay/concurrency and provider failures before/after local commits.
- Duplicate legal versions, exact displayed/accepted locale/version, DPA consent, legal API failure/retry, Google no-tenant completion and correcting a rejected reset password.
- Empty PATCH handling, malformed staff search, failed ticket-list reads, selected-language messages, failed/concurrent quota reservations, late ratings, pending time changes and DST gaps/overlaps.
- Cold report loading, all AS08 metrics, custom-plan filtering and complete coupon creation/list/application using a controlled provider.

Run the relevant tests while implementing, then run the complete backend/frontend suites, strict type checks, backend lint, contract synchronization check, production builds, bundle budgets and available browser journeys. Exercise the real BullMQ adapter, not only MemoryJobs. Check successful authenticated workflows as well as anonymous route boundaries. Generate OpenAPI/contracts through their established tooling when APIs change; do not hand-edit copied frontend contracts.

The audit's last recorded baseline was 206 passing frontend tests and 245 passing/two failing backend tests; the MFA helpers still omitted required proof, and contract synchronization failed. Re-establish the current baseline rather than assuming those counts still apply. Do not fix only the helpers while leaving the actual forms broken.

Run available Firefox/WebKit and representative accessibility checks where feasible, plus the desktop/mobile ticket journeys. Clearly separate mocked provider behavior from actual external-provider/device acceptance. If credentials, physical devices or partner access are unavailable, finish all independent implementation and local verification, and record exactly what remains unverified and how to accept it. Never claim a real-provider test passed without running it.

## Deliver the completed work

Create `docs/audits/2026-10-22-completeness/REMEDIATION.md`, mapping every one of the 31 active IDs to its disposition, changed files, repaired behavior and concrete test evidence. Document migrations, recovery/backfill steps, remaining blockers and external acceptance dependencies. Keep BW03 explicitly preserved/resolved and count CSD10 once.

Finish with a concise account of what changed, checks actually run and their results, unresolved items and necessary operator steps. Do not claim 100% completeness merely because tests/builds pass. Continue until every locally actionable repair is implemented and verified, leaving the work ready for review without deploying it.

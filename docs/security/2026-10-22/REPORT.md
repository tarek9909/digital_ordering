# Tanbeeh repository security assessment

**Consolidated final audit: [SECURITY-AUDIT.md](SECURITY-AUDIT.md).** At the user's request, the findings below were merged into that existing audit, duplicates consolidated, stale observations corrected, and additional findings retained. This file is the supporting 16-finding assessment, not the complete active fix list. Use the canonical audit's IDs, severity counts and reconciliation table, including its configuration-dependent billing finding and support-logout addition.

Assessment date: 22 October 2026. Scope: the current working tree, six frontend apps, backend API/realtime/worker services, tenant data boundaries, dependencies, deployment configuration, CI, environment handling, and available Git history.

**The repository has security issues that should be resolved before production release.** This assessment records 16 findings: five High and eleven Medium. Some are verified with isolated probes; others are confirmed missing controls in source or affected deployment dependencies. Those evidence levels are identified below. No production system was attacked or changed, and no application fixes were applied.

The source has changed since the earlier functional audit. Google TOTP enforcement, MFA handoff, API-key entitlement checking, named-staff revocation, and queue identifiers have received repairs. Their previous findings are not being presented here as still unfixed. New security findings concern other paths and incomplete security lifecycles in the current code.

## Findings by priority

| ID | Severity | Issue | Evidence level | Detailed reference |
| --- | --- | --- | --- | --- |
| SEC01 | High | Public storage proxy exposes a pinned MinIO release affected by authentication bypasses allowing object writes | Version/configuration plus maintainer advisories; no live exploit | SC01 in [supply-chain review](supplychain-findings.md) |
| SEC02 | High | Existing-account invitation acceptance does not require enrolled MFA | Source-confirmed | AUTH-01 in [authentication review](auth-review.md) |
| SEC03 | High | An authenticated session alone can replace or remove an existing authenticator | Source-confirmed; session access is a prerequisite | AUTH-02 |
| SEC04 | High | Disabling/resetting a platform agent leaves issued tenant-support credentials usable | Source-confirmed | AUTH-06 |
| SEC05 | High | Established user staff-board sockets keep receiving data after session/membership revocation | Source-confirmed | AUTH-04 |
| SEC06 | Medium | Removing MFA retains the current session's verified assurance | Source-confirmed | AUTH-03 |
| SEC07 | Medium | Realtime staff admission omits the mandatory multi-venue MFA policy | Source-confirmed | AUTH-05 |
| SEC08 | Medium | OAuth transactions lack initiating-browser binding | Source-confirmed login-CSRF risk; live provider untested | AUTH-07 |
| SEC09 | Medium | Request logs contain full ticket/invitation credentials and OAuth callback parameters | Runtime-confirmed with captured synthetic logs | [root probe results](root-security-results.json) |
| SEC10 | Medium | Configured console IP restrictions are never enforced | Source-confirmed; applies when configured | AUTH-08 |
| SEC11 | Medium | Customer-controlled CSV cells remain spreadsheet formulas | Runtime-confirmed through real DB and ZIP export | BSEC-01 in [backend boundary review](backend-security-findings.md) |
| SEC12 | Medium | Payment-processor deletion errors are swallowed before retry identifiers are deleted | Runtime-confirmed with controlled provider failure | BSEC-02 |
| SEC13 | Medium | S3 bulk-deletion per-object failures are counted as successful erasure | Runtime-confirmed against actual adapter with controlled AWS response | BSEC-03 |
| SEC14 | Medium | Release SSH/SCP does not verify the server's host identity | Source plus exact action definitions | SC02 |
| SEC15 | Medium | Local Compose publishes sensitive development services on every interface | Configuration-confirmed; network exposure not scanned | SC03 |
| SEC16 | Medium | All application roles receive MinIO root credentials | Configuration-confirmed blast-radius risk | SC04 |

Severity reflects impact and prerequisites, not a claim that every finding is remotely exploitable without authentication. No Critical application compromise was demonstrated. Critical package-manager labels for development tools are reported separately from application findings.

## High priority repairs

### SEC01 Public MinIO permits a known storage authentication bypass

`deploy/docker-compose.yml:146` pins `minio/minio:RELEASE.2025-04-22T22-12-26Z`. `deploy/Caddyfile:108` forwards all methods/paths on `files.DOMAIN` to MinIO. The application uses the MinIO root identity at Compose lines 28–29; its access identifier appears in ordinary presigned download URLs and has a predictable example value. An access identifier is not a secret.

The maintainer's [unsigned-trailer advisory](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) and [auto-extract advisory](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237) cover this release. They describe unauthorized object writes when an attacker knows a valid write-capable access identifier and bucket name. The configured root identity has much broader permissions than an individual tenant. This permits storage writes outside the application's authentication and image validation, including overwriting known asset/export keys or consuming storage. It does not establish unauthorized object reads through these particular advisories.

Replace the affected storage implementation/release with one containing both fixes. The advisories identify the patched AIStor release and warn that affected community releases extend through that project's final release; changing to another old community tag is insufficient. Restrict the public proxy to required read methods and paths, keep service writes private, and use bucket-scoped application identities. Include storage images in release scans. Verify the repaired behavior in an isolated deployment. The actual VPS image/state was unavailable, so this is a deployment-path finding, not proof of a live compromise.

### SEC02 Invitations issue sessions without an existing account's MFA

`backend/packages/services/src/auth.ts:368` verifies an invited existing user's password but never reads its enrolled factor or disabled state. Line 390 creates a full session with MFA false; the route sets that session cookie. Ordinary password and Google sign-in now challenge the same account's enrolled TOTP.

Prerequisites are the correct existing password and a valid invitation; an invitation alone is insufficient for an existing password account. In a single-venue tenant, this path grants ordinary invited permissions without application TOTP. Multi-venue HTTP management has an additional gate that limits immediate access there.

Apply the same account-status and MFA policy to all session issuers. Return an MFA challenge before authenticated access, and make membership/invitation redemption consistent with failed or retried completion. Add regression coverage for enrolled, disabled, new, expired/revoked, and Google-only account cases.

### SEC03 Temporary session access can alter future authentication

MFA routes at `backend/apps/api/src/routes/auth.ts:251` require the current session and CSRF but no recent authentication or old-factor proof. `services/src/auth.ts:247` allows enrollment even when a factor already exists; line 254 validates only the proposed new factor before overwriting the old one. Line 264 removes MFA without an existing-factor challenge.

A usable session or unlocked browser is a prerequisite; this is not anonymous MFA modification. The risk is persistence after temporary session compromise: the existing authenticator does not protect its own replacement/removal. Require fresh proof from an enrolled factor or a defined recovery path, distinguish enrollment from replacement, notify the user, and invalidate dependent assurance/artifacts. This follows [OWASP's factor-change guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#changing-mfa-factors).

### SEC04 Platform account disablement does not end derived support access

`backend/packages/services/src/console.ts:214` and `:225` revoke console sessions on disable/MFA reset. They do not end `support_sessions` or invalidate issued support tokens/handoffs. `services/src/support.ts:186` joins the platform account for its name but does not check its active status, current support role, or a security version.

An already-issued tenant support credential is required. It can retain ticket, venue-settings and staff-access permissions until the support session ends/expires after the agent's console access is withdrawn. Support's existing billing/export/ownership restrictions still apply.

Revoke all derived credentials on disablement, relevant role change and security reset. Check current parent-account policy when resolving support access. Require an integration test in which an approved session immediately loses access after the normal disable/reset operation.

### SEC05 Revocation does not remove existing user websocket access

`backend/apps/realtime/src/server.ts:87` authenticates user board sockets at handshake and joins venue/tenant rooms. Socket state does not retain the user session identity, join session-specific rooms, revalidate expiry/membership, or receive a user-session revocation event. `services/src/team.ts:43` and auth revocation helpers update database state without evicting those connections.

A previously authorized connected owner/manager client is required. It can continue receiving subsequent staff projections after logout, credential reset, membership removal or session expiry. Those projections include bearer ticket tokens, notes/references, claim/check codes and operational data. This finding concerns continued event/data access, not unauthorized HTTP writes after revocation.

Bind sockets to authoritative user/session identity, propagate revocation across instances and periodically revalidate as a fallback. Preserve the separate device/display disconnection paths that already exist.

## Medium priority repairs

| ID | Preconditions and impact | Exact source | Required correction |
| --- | --- | --- | --- |
| SEC06 | An MFA-verified session removes its account's factor but remains verified, including under mandatory multi-venue policy | `services/src/auth.ts:264,143`; `apps/api/src/http/router.ts:122` | Reject removal where policy requires a factor, or clear assurance on every session including the current one and enforce re-enrollment |
| SEC07 | A valid no-MFA multi-venue member session blocked by HTTP can still join protected staff websocket rooms | `apps/realtime/src/server.ts:90` versus HTTP `router.ts:122` | Reuse effective access/MFA/tenant policy for realtime admission and continued access |
| SEC08 | A valid pending Google callback is delivered to a browser other than the initiator; the application has no transaction-cookie binding | `services/src/account.ts:121,130`; `apps/api/src/routes/auth-r11.ts:28` | Bind state/nonce/PKCE transaction to an initiating-browser secret, consume atomically, clear after completion. This is account confusion/login CSRF, not demonstrated Google account theft. [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html) |
| SEC09 | A person/system with log access can recover full credential-bearing URLs from request serialization | `apps/api/src/app.ts:65` | Redact all credential route parameters and sensitive queries, not only `/tickets/<token>`; test manifest, invitation, OAuth, support and handoff forms |
| SEC10 | A nonempty `console.ipAllowList` is saved but normal login/API access remains unrestricted by source IP | `contracts/src/settings.ts:147`; `services/src/console.ts:240`; API `middleware.ts:122`; console `Settings.tsx:31` | Implement validated IPv4/IPv6/CIDR policy at a trusted source-IP boundary, or clearly remove the appearance of an active security control. Password/MFA/RBAC still apply |
| SEC11 | A customer who follows a collected order can place a formula in a rating comment; the owner subsequently opens its export | `services/src/privacy.ts:198`; `services/src/r2.ts:168`; `venue-features.ts:218` | Use one text-preserving CSV encoder for all untrusted cells, including formula-leading/control prefixes and CR/LF. Test supported spreadsheet behavior on open/save/reopen |
| SEC12 | A transient processor deletion failure occurs during account purge; the handler logs it and removes local retry identifiers anyway | `apps/worker/src/handlers.ts:80`; `services/src/privacy.ts:148` | Make processor deletion/cancellation a durable required phase; retain identifiers and retry, and confirm completion only after acknowledgement |
| SEC13 | An S3 bulk-delete request succeeds at HTTP level but reports individual failed keys | `services/src/aws.ts:44`; `privacy.ts:141` | Inspect per-key `Errors`, retain failed-key tasks and retry, count only acknowledged deletions, verify required erasure before completing |
| SEC14 | An active network/DNS interceptor impersonates the deployment SSH host | `.github/workflows/deploy.yml:56,70,74` | Pin an independently verified host fingerprint for both SSH/SCP actions; a wrong fingerprint must fail. The registry token is in the remote script; the SSH private key itself is not disclosed by this finding |
| SEC15 | A network peer can reach a development machine running local Compose | `backend/docker-compose.yml:16,22,25,32` | Bind development MySQL/Redis/mail/storage ports to loopback; avoid shared default credentials for intentionally shared environments. The production Compose does not publish these service ports |
| SEC16 | An application process/environment is compromised | `deploy/docker-compose.yml:28,29` | Replace shared MinIO root credentials with minimal bucket/operation-scoped identities; keep provisioning/recovery credentials separate |

Paths shortened to `services/`, `contracts/` or `apps/` in this table are under `backend/packages/` or `backend/` respectively, except the explicitly named frontend Settings page.

SEC09 was verified with captured in-memory Pino logs and synthetic credentials: a ticket manifest and invitation-details request returned 200 while recording their full credentials. OAuth callback query markers were also recorded before provider logic. The ordinary `/api/public/v1/tickets/<token>` path correctly masked its token. Authentication secrets should be excluded consistently rather than depending on one URL pattern; see [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude).

SEC11 used harmless `=1+1` cells and real service/ZIP output. No spreadsheet process execution or data exfiltration was attempted. Formula interpretation and external-link behavior depend on the spreadsheet and its settings; [OWASP documents the export trust boundary](https://community.owasp.org/attacks/CSV_Injection).

SEC12 was reproduced with the actual worker handler and a fake failing provider: the handler resolved, the tenant disappeared, and a second run never retried the provider. SEC13 used the actual AWS adapter with a controlled `AccessDenied` object result: it reported one deletion although zero objects were deleted. [AWS documents per-object errors in successful DeleteObjects responses](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).

## Dependency advisories and secret handling

Read-only npm audits returned the following affected package records. These counts are not counts of independently exploitable application vulnerabilities.

| Scope | High | Critical | Moderate | Interpretation |
| --- | --- | --- | --- | --- |
| Backend, production dependencies | 2 | 0 | 0 | Nodemailer 7.0.13 and Sharp 0.34.5 require reviewed upgrades |
| Backend, including development dependencies | 2 | 2 | 1 | Also includes test-toolchain advisories |
| Frontend, production dependencies | 0 | 0 | 0 | No registry advisories reported at audit time |
| Frontend, including development dependencies | 0 | 2 | 1 | Test-toolchain advisories; not evidence of production critical RCE |

Sharp's advertised vulnerable loaders are constrained by this application's PNG/JPEG/WebP magic-byte checks, byte/pixel bounds, permission checks and re-encoding. Controlled SVG/GIF/TIFF/AVIF/malformed inputs were rejected. Nodemailer receives a fixed message shape rather than arbitrary raw-message/transport options. Public API recipient addresses are validated and capped at 254 characters; the queue's email schema has no explicit length maximum. Ten safe reachability/control assertions passed. No exploit against these current runtime paths was demonstrated; upgrade and revalidate rather than calling the package labels proven app RCE. Exact primary advisories and lockfile locations are in [supplychain-findings.md](supplychain-findings.md).

Vitest/mocker/Tinypool advisories affect development dependencies. Current deployed backend prunes development packages, and frontend serves static build output. Review and update the test toolchain, but do not equate its audit labels with a reachable production exploit.

The secret-pattern review inventoried 494 working-tree files, scanned text for credential signatures, and checked two tracked Git revisions. It found no high-confidence credential signatures. This does not prove all secrets are absent: reconciliation with the existing audit confirmed an unignored generated Playwright cookie file (canonical M-15), whose server-side validity was not tested. The local `backend/.env` is ignored and mainly matches development examples; actual values were not copied to reports. Deployment secret files were absent and ignored. Dockerfiles use explicit COPY lists; no actual environment-file copy into the final image was identified. Shared production MinIO root credentials remain a separate finding regardless of Git ignoring them.

## Additional hardening and validation gaps

These are not counted as demonstrated compromises in the 16 findings above:

- The webhook address classifier uses textual IPv6 prefixes. Injected resolver tests accepted some mapped-private/link-local representations. Production DNS normalization, routing and TLS-valid target reachability were not established, so this is an incomplete validation concern, not a proven live private-network SSRF. Use parsed IP ranges while retaining DNS pinning, TLS verification, redirect refusal and timeouts.
- Public push subscriptions enforce HTTPS and provider-host checks. Broad provider subdomains/unspecified paths and ports can be narrowed. The service helper accepting a string alone is not evidence that the public API permits arbitrary SSRF.
- MFA login has an existing per-IP route limit. Add per-challenge/account budgets, rate limits on factor-management/refresh, and accepted-step replay controls. Do not characterize the whole login flow as unthrottled.
- Single-use KV artifacts commonly use separate `get`/`del`; use atomic consumption. Concurrent redemption was not tested.
- Apply fresh-authentication policy consistently to privilege grants and platform-user role changes, as well as destructive console actions.
- Bound/prune realtime tracking maps and add event budgets; full ZIP assembly/follower growth also need capacity limits. No destructive resource-exhaustion test was conducted.
- The documented large breached-password list and its fetch script are absent; `auth/src/passwords.ts:9` falls back to a small built-in list. Bundle and verify the intended list in the production artifact rather than claiming the documented 100,000-entry check is active.
- Add tests for all newly identified auth/revocation paths. The existing suites passing do not cover those missing checks.

## Controls inspected and checks executed

The current source uses random session/ticket secrets, keyed token hashes, Argon2id and AES-GCM with random IVs. Production cookie options are Secure/HttpOnly/host-only/SameSite=Lax. Registered HTTP routes apply authorization and normal mutation CSRF. Tenant clients scope reads/writes/joins, and HTTP membership is rechecked. React renders ordinary text safely; no untrusted raw-HTML execution path was established. Uploads reject SVG/unsupported formats and re-encode accepted images. Webhooks validate protocol/ports and pin DNS destinations. Support has explicit restrictions on billing, integration management, export, ownership and tenant deletion.

Executed in this assessment:

- Backend unit suite: **53 passed**, including auth and tenant-scope tests.
- API integration file: **5 passed**, including generated cross-tenant HTTP resource assertions.
- Root log probes: four recorded outcomes, including three credential/query logging failures and one correctly masked control.
- Backend boundary probes: real MySQL/ZIP CSV proof, actual worker/provider-failure proof and controlled AWS-adapter proof; conditional IPv6 validation observations are labeled separately.
- Supply-chain probes: **10 passing assertions**, plus four current npm audit reports.
- Sanitized working-tree/history secret-pattern inventory and source/configuration review.

Tests used disposable MySQL, captured synthetic logs, memory queues and controlled provider/AWS responses. They did not send real messages, initiate payments, target arbitrary internal/external hosts, deploy changes, or modify shared application data. The authentication findings are source-confirmed and their proposed regression scenarios were not executed as bypass probes. No live OAuth, storage service exploit, VPS firewall, GitHub account policy, container image scan, or independent penetration test was completed. Docker/Trivy/Semgrep/Gitleaks were unavailable. This is a repository assessment, not security certification or evidence that a deployed system has been compromised.

## Remediation sequence

1. Contain and replace the affected public storage dependency; restrict public storage writes and remove application root credentials.
2. Unify session issuance/MFA policy across invitations, login, factor changes, HTTP and websocket access.
3. Propagate revocation to websocket/support credentials and clear obsolete MFA assurance.
4. Fix URL redaction, browser-bound OAuth transactions and the advertised IP restriction.
5. Fix spreadsheet export encoding and durable multi-system deletion acknowledgement/retries.
6. Pin deployment SSH host identity, restrict local service bindings, update affected runtime/test dependencies and add regression coverage.

## Evidence and reproduction

- [Authentication source review](auth-review.md): exact missing checks, prerequisites, safe regression requirements and controls.
- [Backend boundary review](backend-security-findings.md), [probe](backend-security-probes.mts), [results](backend-security-probe-results.json).
- [Dependency and deployment review](supplychain-findings.md), [safe probes](supplychain-probes.mjs), [results](supplychain-probes-results.json), [sanitized secret scan](supplychain-secret-scan.json).
- [Logging probe](root-security-probes.mts), [results](root-security-results.json).
- [Backend complete audit](supplychain-backend-audit.json), [backend production audit](supplychain-backend-production-audit.json), [frontend complete audit](supplychain-frontend-audit.json), [frontend production audit](supplychain-frontend-production-audit.json).

From `backend/`, on a nonproduction development machine:

```powershell
npm run test:unit
npx vitest run --project integration apps/api/test/api.int.test.ts
npx tsx ../docs/security/2026-10-22/root-security-probes.mts
node --import tsx ../docs/security/2026-10-22/backend-security-probes.mts
node --import tsx ../docs/security/2026-10-22/supplychain-probes.mjs
npm audit --json
npm audit --omit=dev --json
```

Repeat the two npm audit commands from `frontend/`. An npm audit nonzero exit with advisories is expected. The scripts reproduce current behavior; successful script execution does not mean the vulnerabilities have been repaired. Security fixes and new regression expectations must be reviewed before release.

# Backend boundary security review — 2026-10-22

Reviewed current repaired code, not the previous audit's assumptions. No application files were modified. Proofs use a disposable MySQL instance, in-memory queues, provider stubs, and injected DNS responses; no emails, payments, public webhooks, or external SSRF traffic were sent.

Reproduce: from `backend`, run `node --import tsx ../docs/security/2026-10-22/backend-security-probes.mts`. Results: `backend-security-probe-results.json`.

## BSEC-01 — Medium: customer-controlled cells become executable spreadsheet formulas

- `backend/packages/services/src/privacy.ts:198-205` writes CSV cells by quoting commas/newlines/quotes only. `backend/packages/services/src/r2.ts:168-171` does the same for report exports.
- A customer who has followed their collected ticket can submit `comment: "=1+1"` to the public rating endpoint; `backend/packages/contracts/src/api.ts:56` accepts it and `backend/packages/services/src/venue-features.ts:218-230` stores it. The owner's tenant ZIP includes this comment unchanged in `ratings.csv`. Staff/API/POS-controlled receipt references and ticket notes reach other exported cells. A tenant owner's own venue names are another input, but the customer-to-owner path is the material trust crossing.
- Confirmed using the actual signup/follow/ready/collected/rating/export services and ZIP decoder on an isolated database: the rating row contains `...,5,=1+1,...`; the report CSV receipt cell likewise contains `=1+1`.
- Impact: opening the export in a formula-interpreting spreadsheet executes attacker-provided formulas in the user's spreadsheet context. External-link/data-exfiltration behavior depends on the spreadsheet/version/security settings. No spreadsheet process execution or data exfiltration was attempted or claimed.
- Primary reference: [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection) explains formula interpretation and warns that CSV escaping behavior differs between spreadsheets and can change on save/reopen. This is why the report demonstrates a harmless formula and recommends validating the chosen text-preservation policy in supported spreadsheet applications.
- Fix: one shared CSV encoder that preserves text while neutralizing formula-leading characters (`=`, `+`, `-`, `@`, and control/whitespace prefixes), quotes CR as well as LF, and consistently applies the policy to every untrusted text field in both export types. Add a regression covering anonymous rating comments and receipt references; test the chosen escaping policy in the supported spreadsheet applications.

## BSEC-02 — Medium: provider deletion failures are swallowed before the retry pointer is erased

- `backend/apps/worker/src/handlers.ts:80-84` reads `stripe_customer_id`, calls `billing.deleteCustomer`, catches/logs any error, then unconditionally purges the tenant. The real provider at `backend/packages/services/src/billing.ts:122-123` calls `stripe.customers.del`.
- `backend/packages/services/src/privacy.ts:148-168` removes subscriptions, tenant rows, and associated data and queues a deletion-completed email. `purgeTenant` treats an absent tenant as already complete. The `resumePurges` sweep only discovers tenant rows still present.
- Confirmed with the actual handler and isolated database: a fake provider throws a transient deletion error; the handler resolves successfully and the tenant disappears; running the same job again does not call the provider (`providerCallsAfterTwoJobRuns: 1`).
- Impact: customer information and potentially active subscriptions remain with the payment processor while local records needed to retry are deleted, and the user is told deletion completed. A transient upstream outage, permission failure, or timeout suffices; no malicious account is required.
- Primary reference: [Stripe: Delete a customer](https://docs.stripe.com/api/customers/delete) documents that successful customer deletion also cancels active subscriptions. Swallowing its failure therefore loses both the erasure attempt and that cancellation path.
- Fix: make processor deletion/cancellation a required durable purge phase. Retry transient failures, distinguish confirmed already-deleted customers from genuine failures, retain customer/subscription IDs in a deletion task/tombstone until completion, and queue the confirmation only after all required systems acknowledge completion.

## BSEC-03 — Medium: S3 per-object deletion errors are treated as successful erasure

- `backend/packages/services/src/aws.ts:44-47` awaits `DeleteObjectsCommand` but ignores its result and increments the deleted count for every requested key. A successful request can carry individual failures in `Errors`.
- `backend/packages/services/src/privacy.ts:141-143` assumes prefix deletion succeeded, then deletes tenant/export database pointers and sends the completion message at `:166-168`.
- Confirmed by stubbing only the actual AWS client's `send` method in-process, never making a network request: listing one key followed by a response `Errors: [{ Key, Code: "AccessDenied" }]` makes the actual storage adapter return `1` deleted although no object was deleted.
- Impact: sensitive tenant ZIP exports or logos survive account deletion, become untracked, and cannot be retried by the tenant-based purge sweep. This is independent of BSEC-02: fixing the provider phase does not repair object-store error handling.
- Primary reference: [AWS S3 DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html) explicitly documents per-object success/failure results and shows an HTTP 200 response containing an `AccessDenied` error for an individual key. The controlled stub reproduces this documented response shape.
- Fix: inspect every delete response, throw/retain durable state when any `Errors` remain, count acknowledged deletions only, handle pagination and versioned-object retention according to the configured storage policy, and verify the prefix empty before declaring erasure complete. Cover mixed successes/failures and transient retries.

## BSEC-04 — Conditional risk/hardening: IPv6 SSRF classification is incomplete

- `backend/packages/services/src/webhooks.ts:24-31` uses textual prefixes rather than parsed address ranges. Hexadecimal IPv4-mapped IPv6 such as `::ffff:7f00:1` and `::ffff:a9fe:a9fe` bypass the recursive IPv4 check because `7f00:1` / `a9fe:a9fe` are not dotted IPv4. Only `fe80...` is rejected although link-local addressing extends beyond that textual prefix.
- Controlled calls to the real `resolvePublic('controlled.invalid', injectedResolver)` accepted `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `fe81::1`, and `febf::1`. The returned address is passed to the pinned HTTP dispatcher by `deliverWebhook`. No uncontrolled network destination was requested.
- Preconditions/limits: outbound-webhook owner permission and enabled plan; DNS/OS must return one of the bypassed representations, and the worker must be able to route it. The real poster still verifies TLS names and restricts URL ports to 443/8443. The probe does **not** establish production DNS formatting, route reachability, a TLS-valid internal destination, or exploitable metadata access. Treat this as a demonstrated validation gap, not a demonstrated live SSRF compromise.
- Fix: parse/canonicalize IP addresses with a maintained range-aware implementation; convert mapped IPv6 to its IPv4 value; allow only global unicast destinations and explicitly reject all loopback, private, link-local, unspecified, multicast and other special-purpose ranges; keep DNS pinning, TLS verification, and redirect prohibition.

## Reviewed controls / limits

- Raw query uses and tenant-scoped services inspected: runtime values use bound Kysely parameters; dynamic raw identifiers in purge/partition paths come from internal constants; report replicas are explicitly tenant scoped. No current SQL injection or direct tenant isolation exploit was established in this review slice.
- Public push routes do enforce HTTPS/provider-host classification (`public.ts` calls `pushServiceOf`), so the service helper accepting arbitrary endpoint text is **not** evidence of arbitrary public SSRF. The host list is broader than exact push hosts (`*.googleapis.com`, `*.mozilla.com`) and lacks endpoint path/port validation; tighten as defense in depth, without describing this as a demonstrated private-network exploit.
- Outgoing webhooks pin resolved addresses, reject redirects and URL credentials, verify TLS, and time out. The finding above concerns range classification only.
- Logo upload performs size/magic-byte/dimension checks, re-encodes through Sharp, strips metadata, and generates random keys. No upload-based code execution or stored-XSS path was established.
- AES-GCM uses random IVs; Argon2id hashes secrets. No cryptographic break was established.
- Full export assembly loads rows/ZIP into memory; follower counts are not capped; these remain resource-exhaustion design risks. No destructive load test was run, and they are not counted as verified denial-of-service exploits.
- AWS and Stripe account policies, live provider behavior, OS/network reachability, physical devices, and production configurations were not tested. Deployment-specific storage lifecycle exists for exports in `deploy/docker-compose.yml`; do not claim all export files lack retention just because `retentionMisc` only changes database status.

# Authenticated API completeness findings

22 October 2026. These probes call actual Express routes and services on disposable MySQL. Billing, queue, KV and storage use controlled test implementations; no external provider is contacted. Application source was not modified. The report's source snapshots identify the changing working tree.

Evidence: [probe](api-runtime-probes.mts), [results](api-runtime-results.json), [all registered routes](api-route-registry.json), [anonymous results](api-anonymous-boundaries.json), [authenticated reads](api-authenticated-reads.json).

## API01 · P2 · Four accepted empty PATCH requests still return 500

The schemas permit an empty object, but each service executes an empty SQL UPDATE. An ordinary authenticated request becomes `500 INTERNAL_ERROR` rather than a no-op or a validation response.

| Request | Source | Observed |
| --- | --- | --- |
| PATCH `/api/admin/v1/webhooks/:id` `{}` | `backend/packages/services/src/webhooks.ts:96`, `:105` | 500 |
| PATCH `/api/console/v1/plans/:id` `{}` | `backend/packages/services/src/platform-tools.ts:148`, `:152` | 500 |
| PATCH `/api/console/v1/platform-users/:id` `{}` | `backend/packages/services/src/console.ts:217`, `:222` | 500 |
| PATCH `/api/console/v1/languages/en` `{}` | `backend/packages/services/src/console.ts:269`, `:273` | 500 |

The fixture resources exist and the authenticated caller has owner/super-admin permission and a valid CSRF token. Empty tenant, venue, counter, display and profile PATCH controls correctly return 200/204, showing that the earlier A10 repairs work in those locations. These four are additional endpoints.

Treat an empty update consistently: reject it with validation before reaching SQL or return a documented no-op after validating resource existence. Add API regressions for all four endpoints and `rotateSecret:false`, which can also produce an empty webhook patch.

## API02 · P1 · A rejected duplicate legal version overwrites published content

At `backend/packages/services/src/platform-tools.ts:262` the storage key is derived from kind/version/locale. Line 264 writes the file before line 266 attempts the unique database insert. A duplicate is rejected at line 268 after the existing content has already been replaced.

The probe creates and publishes English terms `audit-v1`, reads `<p>Original accepted terms</p>`, then attempts the same version/locale with different HTML. Creation returns `VALIDATION_FAILED` as expected, but reading the original published version returns `<p>Replacement rejected by API</p>`. Its version, document ID, publication status and existing acceptance records remain unchanged.

This breaks immutable legal versions and changes the meaning of recorded acceptance after a failed operation. It is distinct from AS04's displayed/accepted locale mismatch. Reserve the version before writing, use immutable unique content keys, and make failed database/storage writes recover without touching the old published object. A simple preflight duplicate check alone would still race concurrent creations. Regression: rejected duplicate creation must leave the original bytes, version and public output unchanged.

## Verified controls and limits

- Every registered route was sent an anonymous request with a valid surface/representative path. None returned an unexpected 500 or granted a protected permission. This is authentication/input-boundary coverage, not successful business execution of every route.
- All 71 GET definitions were also exercised with representative owner, display, platform, www or API-key credentials and queries. The fixture returned 56 successful reads and expected validation/missing-resource/auth responses for the others, with no 500. The JSON retains each outcome; missing fixtures are not counted as successful workflow tests.
- Cross-tenant/missing-resource controls for venue, staff access, device/display/counter lists return 404. Duplicate named-staff PIN returns 400. The owner staff search URI from CSD02 was sent to real HTTP and returns 400, confirming the frontend URL-construction defect.
- Provider failure/quantity tests in BW04 invoke real services with injected provider failures. They demonstrate committed writes plus thrown errors; this report does not mislabel those as observed HTTP 500s.
- The newest probe also tests the exact empty MFA-enrollment payload sent by the current UI and a valid-password control. AS11 records the resulting frontend/backend contract mismatch. An intermediate route/service mismatch briefly produced 500s during concurrent security edits; it was corrected before the valid-password control returned 200 and is not counted as a separate outstanding defect.
- Bulk sweeps disable rate-limit budgets inside their disposable API dependencies so testing one route cannot consume another's budget. Existing suites cover their separate configured rate behavior. No conclusion about production rate-limit effectiveness is drawn here.
- Unknown tenant IDs on console billing and unknown venue IDs in trends can return empty 200 responses; these were logged but are not counted as blockers without a stronger endpoint-specific contract.

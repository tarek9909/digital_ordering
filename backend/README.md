# Back end

npm workspace. The layout and rules are in Implementation Plan §18; the design is in the TRD.

| Path | Contents |
| --- | --- |
| `apps/api` | Express 5 API: public, auth, staff, display, admin, console, integration `/v1`, provider webhooks |
| `apps/realtime` | Socket.IO at `/rt/`, event-bus fan-out, presence |
| `apps/worker` | BullMQ job handlers and the leader-locked scheduler (TRD §18) |
| `packages/contracts` | Zod schemas, error codes, projections and socket messages. This is the source of the shared contract. |
| `packages/domain` | Pure business rules: state machines, numbering, codes, alert level, plans, histograms |
| `packages/db` | Kysely, SQL migrations, `TenantScopePlugin` (tenant isolation layer 2), test database harness |
| `packages/auth` | argon2id, token hashing, AES-GCM envelope encryption, TOTP, RBAC `authorize()` |
| `packages/jobs` | Queue names, job schemas, BullMQ adapter, per-tenant token bucket |
| `packages/services` | Business services used by all three apps |
| `load` | k6 load tests |

## Commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` / `npm run lint` | TypeScript strict; ESLint with the tenant-isolation rules `dop/require-tenant-client` and `dop/no-unscoped-raw-sql` |
| `npm run test:unit` | Domain, auth, tenant-scope plugin and contract tests (no services needed) |
| `npm run test:integration` | Real MySQL 8.4, including the cross-tenant suite generated from the route list (TR-TEN-08). Uses `TEST_DATABASE_URL` when set, or downloads a throwaway MySQL. |
| `npm run db:migrate` / `npm run db:seed` | Migrations; reference data, plus demo data outside production (TR-TST-01) |
| `npm run openapi` | Regenerates `docs/openapi/v1.json`. The contract test fails when it drifts. |
| `npm run sync:contracts` | Copies the contract to `frontend/packages/contracts`. CI checks for drift. |
| `npm run build` | esbuild bundles to `dist/<app>/main.js`; `Dockerfile` builds one image for all roles |

## Tenant isolation, in four layers (TRD §6)

1. The tenant comes only from trusted credentials: the session cookie on the tenant host, the device or display cookie, the ticket token or the API key (`apps/api/src/http/middleware.ts`).
2. `TenantScopePlugin` adds `tenant_id = ?` to every tenant table in every query shape and rejects foreign inserts and unscoped raw SQL (`packages/db/src/tenant-scope.ts`, with unit tests).
3. Composite foreign keys that include `tenant_id` (`packages/db/migrations`).
4. Verification: lint rules, a cross-tenant HTTP suite generated from the route list (`apps/api/test/api.int.test.ts`), and the nightly integrity job.

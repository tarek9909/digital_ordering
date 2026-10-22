# 0006 — Job queue behind an interface

**Context.** BullMQ needs Redis 5 or later. Tests should not need a queue server.

**Decision.** Services enqueue through the `Jobs` interface in `packages/jobs`. `BullJobs` is used in deployed environments, and `MemoryJobs` records jobs in tests and deduplicates them by job ID. When the API starts against Redis older than 5, it falls back to `MemoryJobs` and logs a warning. The worker refuses to start in that case.

**Consequences.** Alert scheduling (deterministic IDs, repeats, reconcile) is tested without Redis. The worker's BullMQ wiring is exercised only with Redis 7, in CI and on staging.

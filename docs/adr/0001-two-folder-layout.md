# 0001 — Two top-level folders, npm workspaces

**Context.** TRD §4 places all apps and packages in a single pnpm and Turborepo tree. The team decided to split the code into `backend/` and `frontend/`.

**Decision.** Each folder is its own npm workspace, with its own lockfile and CI job. They share only the API contract. `backend/packages/contracts` is the source, and `npm run sync:contracts` copies it to `frontend/packages/contracts`. CI fails when the copy drifts. Shared server logic used by both the API and the worker lives in `backend/packages/services`.

**Consequences.** Front-end changes never rebuild the back end, and the reverse. A contract change needs two commits in the same PR: the source change and the synced copy.

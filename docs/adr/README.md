# Architecture decision records

TRD §28 records technical decisions TD-01 to TD-17. This folder records decisions made during the build that change or add to the TRD. Each one is also listed in Implementation Plan §16 for the source documents.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-folder-layout.md) | Code in `backend/` and `frontend/`, using npm workspaces instead of pnpm and Turborepo | Accepted |
| [0002](0002-membership-fk-restrict.md) | `tenant_memberships.tenant_id` foreign key without `ON DELETE CASCADE` | Accepted |
| [0003](0003-number-sequence-row-outside-tx.md) | The number-sequence row is created before the allocation transaction | Accepted |
| [0004](0004-customer-app-router.md) | The customer app uses a small router and a native dialog to meet the 120 KB budget | Accepted |
| [0005](0005-email-layout.md) | Email layout is hand-written, email-safe HTML instead of compiled MJML | Accepted |
| [0006](0006-jobs-interface.md) | Job queue behind an interface: BullMQ in deployed environments, in-memory in tests | Accepted |
| [0007](0007-self-hosted-vps.md) | Self-hosted on one VPS with Docker Compose (Caddy, MySQL, Redis, MinIO) instead of AWS | Accepted |

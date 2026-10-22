# 0002 — Membership foreign key without cascade

**Context.** The TRD DDL gives `tenant_memberships` a stored generated column, `owner_key`, computed from `tenant_id`, plus `FOREIGN KEY (tenant_id) … ON DELETE CASCADE`. MySQL 8.4 rejects this combination: a base column of a stored generated column cannot have a cascading referential action. The migration failed with `ER_CANNOT_ADD_FOREIGN`.

**Decision.** Use the default `RESTRICT` action. The purge order in TR-PRV-12 already deletes `tenant_memberships` before the `tenants` row, so nothing relies on the cascade.

**Consequences.** Ad-hoc deletes of a tenant row fail while memberships exist, which is a useful guard. The TRD DDL should be updated (Implementation Plan §16 #5).

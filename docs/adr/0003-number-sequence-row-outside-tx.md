# 0003 — Create the number-sequence row before the allocation transaction

**Context.** TRD §9.2 runs `INSERT IGNORE INTO number_sequences …` inside the allocation transaction, followed by `SELECT … FOR UPDATE`. In the concurrency test (50 parallel creates on a new business date), MySQL returned `Deadlock found` errors. Concurrent `INSERT IGNORE` statements on the same new key take insert-intention locks, and these conflict with the `FOR UPDATE` row locks.

**Decision.** Run `INSERT IGNORE` as its own auto-committed statement before the transaction. The transaction then only locks an existing row. `ER_LOCK_DEADLOCK` is retried together with duplicate keys, up to 3 times (TR-ALG-03).

**Consequences.** 50 parallel creates give 50 distinct numbers with no deadlocks (`packages/services/test/tickets.int.test.ts`). Behaviour is otherwise unchanged.

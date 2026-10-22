-- 0002: monthly range partitions for ticket_events (TR-DB-11, R1.1). MySQL requires the partition column in every
-- unique key and does not support foreign keys on partitioned tables, so the FK to tickets is dropped; tenant
-- consistency for this table is enforced by the application and the nightly integrity check (TR-TEN-09).
-- webhook_deliveries is partitioned the same way when it gets traffic in R2 (0003).

ALTER TABLE ticket_events DROP FOREIGN KEY ticket_events_ibfk_1;

ALTER TABLE ticket_events DROP PRIMARY KEY, ADD PRIMARY KEY (id, occurred_at);

ALTER TABLE ticket_events PARTITION BY RANGE (TO_DAYS(occurred_at)) (
  PARTITION p_old VALUES LESS THAN (TO_DAYS('2026-01-01')),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);

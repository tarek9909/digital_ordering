-- 2026-10-25: Standard is priced in US dollars only, one price per period (month, quarter, year).
UPDATE plan_prices SET active = 0
 WHERE active = 1 AND currency <> 'USD' AND plan_id = (SELECT id FROM (SELECT id FROM plans WHERE code = 'standard') s);

INSERT INTO plan_prices (id, plan_id, period, currency, amount_minor)
SELECT UUID(), p.id, x.period, 'USD', x.amount_minor
  FROM plans p
  JOIN (SELECT 'month' AS period, 2700 AS amount_minor UNION ALL SELECT 'quarter', 7290 UNION ALL SELECT 'year', 25920) x
 WHERE p.code = 'standard'
   AND NOT EXISTS (SELECT 1 FROM plan_prices q WHERE q.plan_id = p.id AND q.period = x.period AND q.currency = 'USD' AND q.active = 1);

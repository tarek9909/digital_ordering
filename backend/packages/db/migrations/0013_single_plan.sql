-- 2026-10-25: one commercial plan. Standard carries every feature and limit; the other paid tiers are retired.
UPDATE plans
   SET limits = '{"maxDisplaysPerVenue":20,"maxStaffDevicesPerVenue":50,"trialTicketsPerDay":200,"maxVenues":1,"maxCountersPerVenue":10,"maxLanguages":10,"maxApiKeysPerVenue":5}',
       features = '["display_speech","ratings","reports_trends","counters","remove_powered_by","api_access","webhooks","pos_connectors","named_staff","csv_export"]',
       is_public = 1
 WHERE code = 'standard';

UPDATE tenants
   SET plan_id = (SELECT id FROM (SELECT id FROM plans WHERE code = 'standard') s)
 WHERE plan_id IN (SELECT id FROM (SELECT id FROM plans WHERE code IN ('pro','multisite')) o);

UPDATE plans SET archived_at = CURRENT_TIMESTAMP(3), is_public = 0 WHERE code IN ('pro','multisite') AND archived_at IS NULL;

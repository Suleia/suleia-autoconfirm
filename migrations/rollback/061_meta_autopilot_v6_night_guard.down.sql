BEGIN;
-- Never remove the guard while V6 has monetary history. Application rollback
-- must retain it and disable writes rather than reactivate a competing policy.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM economics.ads_operations WHERE body->>'operationKind'='NIGHT_22_30') THEN
  RAISE EXCEPTION 'V6_NIGHT_HISTORY_REQUIRES_GUARD_RETENTION';
 END IF;
END $$;
DROP TRIGGER ads_night_reservation_immutable ON economics.ads_operations;
DROP FUNCTION economics.preserve_ads_night_reservation();
DROP INDEX economics.ads_operations_one_night_per_campaign_day;
COMMIT;

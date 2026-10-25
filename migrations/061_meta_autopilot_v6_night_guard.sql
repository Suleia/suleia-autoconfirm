BEGIN;
-- Reuse the financial operation ledger. This key deliberately excludes policy
-- version and proposal id: a release or process restart cannot compound a cut.
CREATE UNIQUE INDEX ads_operations_one_night_per_campaign_day
 ON economics.ads_operations(account_id,campaign_id,(body->>'nightBusinessDate'))
 WHERE body->>'operationKind'='NIGHT_22_30';
CREATE FUNCTION economics.preserve_ads_night_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.body->>'operationKind'='NIGHT_22_30' AND
   (NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR
    NEW.body->>'operationKind' IS DISTINCT FROM OLD.body->>'operationKind' OR
    NEW.body->>'nightBusinessDate' IS DISTINCT FROM OLD.body->>'nightBusinessDate' OR
    NEW.body->>'nightBeforeCents' IS DISTINCT FROM OLD.body->>'nightBeforeCents' OR
    NEW.body->>'nightTargetCents' IS DISTINCT FROM OLD.body->>'nightTargetCents') THEN
  RAISE EXCEPTION 'IMMUTABLE_NIGHT_RESERVATION';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ads_night_reservation_immutable BEFORE UPDATE ON economics.ads_operations
 FOR EACH ROW EXECUTE FUNCTION economics.preserve_ads_night_reservation();
COMMENT ON INDEX economics.ads_operations_one_night_per_campaign_day IS 'V6 frozen 22:30 target; UNKNOWN, FAILED and EXECUTING consume the reservation. No assigning POST retry.';
COMMIT;

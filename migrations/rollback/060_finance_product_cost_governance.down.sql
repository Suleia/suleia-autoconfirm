BEGIN;
DO $$
DECLARE entry record; prior economics.finance_cost_rates%ROWTYPE;
BEGIN
 FOR entry IN SELECT * FROM economics.finance_product_cost_audit
   WHERE principal_hash='owner-verified-20261024-product-33560'
     AND EXISTS(SELECT 1 FROM economics.finance_cost_rates r WHERE r.rate_id=finance_product_cost_audit.rate_id)
   ORDER BY created_at DESC LOOP
  IF entry.before_snapshot IS NOT NULL AND EXISTS(SELECT 1 FROM economics.finance_cost_rates r WHERE r.rate_id=entry.rate_id AND to_jsonb(r)=entry.before_snapshot) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM economics.finance_cost_rates r WHERE r.rate_id=entry.rate_id AND to_jsonb(r)=entry.after_snapshot)
  THEN RAISE EXCEPTION 'PRODUCT_COST_CHANGED_RECONCILE_BEFORE_ROLLBACK'; END IF;
  IF entry.operation='CREATE' THEN
   DELETE FROM economics.finance_cost_rates WHERE rate_id=entry.rate_id;
  ELSE
   SELECT * INTO prior FROM jsonb_populate_record(NULL::economics.finance_cost_rates,entry.before_snapshot);
   UPDATE economics.finance_cost_rates SET amount=prior.amount,currency=prior.currency,effective_from=prior.effective_from,
     effective_to=prior.effective_to,source=prior.source,updated_at=prior.updated_at WHERE rate_id=entry.rate_id;
  END IF;
 END LOOP;
END $$;
DROP VIEW IF EXISTS read_models.finance_product_cogs_missing;
DROP FUNCTION IF EXISTS economics.save_product_cogs_rate(uuid,text,text,text,numeric,date,date,text,timestamptz);
-- Retain the immutable audit trail. No order/provider/campaign row is touched.
COMMIT;

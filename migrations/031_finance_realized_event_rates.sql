BEGIN;

-- Financial configuration only. No provider, order, customer, template or
-- operational automation is mutated by this migration.
ALTER TABLE economics.finance_cost_rates
  DROP CONSTRAINT IF EXISTS finance_cost_rates_cost_type_check;
ALTER TABLE economics.finance_cost_rates
  ADD CONSTRAINT finance_cost_rates_cost_type_check CHECK (cost_type IN (
    'PRODUCT_COGS','OUTBOUND_SHIPPING','OUTBOUND_FULFILLMENT','COD',
    'RETURN_SHIPPING','RETURN_FULFILLMENT','RETURN_LOGISTICS_COMBINED'
  ));

WITH enabled_store AS (
  SELECT min(store_id) AS store_id
  FROM integration.dropea_store_config
  WHERE enabled=true
  HAVING count(*)=1
), desired(cost_type,carrier,product_id,variant_id,amount,effective_from) AS (
  VALUES
    ('OUTBOUND_SHIPPING'::text,'GLS'::text,NULL::text,NULL::text,4.0600::numeric,DATE '2026-05-01'),
    ('OUTBOUND_FULFILLMENT','GLS',NULL,NULL,1.2000,DATE '2026-05-01'),
    ('COD','GLS',NULL,NULL,1.0000,DATE '2026-05-01'),
    ('RETURN_LOGISTICS_COMBINED','GLS',NULL,NULL,5.2600,DATE '2026-05-01'),
    ('PRODUCT_COGS',NULL,'30133','30133',4.0000,DATE '2026-05-01'),
    ('PRODUCT_COGS',NULL,'31547','31547',1.4400,DATE '2026-06-18'),
    ('PRODUCT_COGS',NULL,'31666','31666',1.0100,DATE '2026-06-28'),
    ('PRODUCT_COGS',NULL,'31839','31839',2.0000,DATE '2026-07-01')
)
UPDATE economics.finance_cost_rates rate
SET amount=desired.amount,effective_from=desired.effective_from,effective_to=NULL,
    source='BUSINESS_VERIFIED_RATE',updated_at=now()
FROM enabled_store store,desired
WHERE rate.store_id=store.store_id AND rate.cost_type=desired.cost_type
  AND rate.carrier IS NOT DISTINCT FROM desired.carrier
  AND rate.product_id IS NOT DISTINCT FROM desired.product_id
  AND rate.variant_id IS NOT DISTINCT FROM desired.variant_id;

WITH enabled_store AS (
  SELECT min(store_id) AS store_id
  FROM integration.dropea_store_config
  WHERE enabled=true
  HAVING count(*)=1
), desired(cost_type,carrier,product_id,variant_id,amount,effective_from) AS (
  VALUES
    ('OUTBOUND_SHIPPING'::text,'GLS'::text,NULL::text,NULL::text,4.0600::numeric,DATE '2026-05-01'),
    ('OUTBOUND_FULFILLMENT','GLS',NULL,NULL,1.2000,DATE '2026-05-01'),
    ('COD','GLS',NULL,NULL,1.0000,DATE '2026-05-01'),
    ('RETURN_LOGISTICS_COMBINED','GLS',NULL,NULL,5.2600,DATE '2026-05-01'),
    ('PRODUCT_COGS',NULL,'30133','30133',4.0000,DATE '2026-05-01'),
    ('PRODUCT_COGS',NULL,'31547','31547',1.4400,DATE '2026-06-18'),
    ('PRODUCT_COGS',NULL,'31666','31666',1.0100,DATE '2026-06-28'),
    ('PRODUCT_COGS',NULL,'31839','31839',2.0000,DATE '2026-07-01')
)
INSERT INTO economics.finance_cost_rates
  (store_id,cost_type,carrier,product_id,variant_id,amount,currency,effective_from,effective_to,source,updated_at)
SELECT store.store_id,desired.cost_type,desired.carrier,desired.product_id,desired.variant_id,
  desired.amount,'EUR',desired.effective_from,NULL,'BUSINESS_VERIFIED_RATE',now()
FROM enabled_store store CROSS JOIN desired
WHERE NOT EXISTS (
  SELECT 1 FROM economics.finance_cost_rates rate
  WHERE rate.store_id=store.store_id AND rate.cost_type=desired.cost_type
    AND rate.carrier IS NOT DISTINCT FROM desired.carrier
    AND rate.product_id IS NOT DISTINCT FROM desired.product_id
    AND rate.variant_id IS NOT DISTINCT FROM desired.variant_id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM economics.finance_cost_rates
    WHERE cost_type='RETURN_LOGISTICS_COMBINED' AND amount=5.2600
      AND effective_from=DATE '2026-05-01' AND effective_to IS NULL
      AND source='BUSINESS_VERIFIED_RATE'
  ) THEN
    RAISE EXCEPTION 'FINANCE_RETURN_RATE_POSTCONDITION_FAILED';
  END IF;
END $$;

COMMIT;

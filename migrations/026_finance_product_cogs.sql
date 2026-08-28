BEGIN;

-- Unit costs confirmed by the business owner on 2026-08-28. These are
-- assumptions used only by the internal financial report when Dropea does not
-- provide a positive wholesale_price for the delivered product line.
WITH enabled_store AS (
  SELECT min(store_id) AS store_id
  FROM integration.dropea_store_config
  WHERE enabled=true
  HAVING count(*)=1
), desired(variant_id,product_id,amount) AS (
  VALUES
    ('31666'::text,'31666'::text,1.0100::numeric), -- Collagum, per delivered unit
    ('31547'::text,'31547'::text,1.4400::numeric)  -- NIDA, per delivered unit
)
INSERT INTO economics.finance_cost_rates
  (store_id,cost_type,product_id,variant_id,amount,currency,effective_from,
   effective_to,source,updated_at)
SELECT s.store_id,'PRODUCT_COGS',d.product_id,d.variant_id,d.amount,'EUR',
  DATE '2026-06-01',NULL,'USER_CONFIRMED_PRODUCT_COGS_2026_08_28',now()
FROM enabled_store s CROSS JOIN desired d
WHERE NOT EXISTS (
  SELECT 1 FROM economics.finance_cost_rates r
  WHERE r.store_id=s.store_id AND r.cost_type='PRODUCT_COGS'
    AND r.variant_id=d.variant_id AND r.effective_from=DATE '2026-06-01'
    AND r.effective_to IS NULL
);

DO $$
BEGIN
  IF (SELECT count(*) FROM economics.finance_cost_rates
      WHERE cost_type='PRODUCT_COGS'
        AND source='USER_CONFIRMED_PRODUCT_COGS_2026_08_28'
        AND effective_from=DATE '2026-06-01' AND effective_to IS NULL
        AND ((variant_id='31666' AND amount=1.0100)
          OR (variant_id='31547' AND amount=1.4400))) <> 2 THEN
    RAISE EXCEPTION 'FINANCE_PRODUCT_COGS_POSTCONDITION_FAILED';
  END IF;
END $$;

COMMIT;

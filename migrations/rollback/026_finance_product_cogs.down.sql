BEGIN;

DELETE FROM economics.finance_cost_rates
WHERE cost_type='PRODUCT_COGS'
  AND source='USER_CONFIRMED_PRODUCT_COGS_2026_08_28'
  AND effective_from=DATE '2026-06-01'
  AND variant_id IN ('31547','31666');

COMMIT;

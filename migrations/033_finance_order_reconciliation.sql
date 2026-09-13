BEGIN;

-- Expose only the provider order key required for an exact, PII-free join to
-- the existing server-side finance read model.
CREATE OR REPLACE VIEW read_models.operations_finance_order_inputs AS
WITH active_issues AS (
  SELECT DISTINCT ON (canonical_order_id) canonical_order_id,canonical_issue_id AS active_issue_id
  FROM read_models.operations_incident_records
  WHERE status='PENDING' AND is_active=true
  ORDER BY canonical_order_id,updated_at DESC
), latest_discount AS (
  SELECT DISTINCT ON (dropea_order_id) dropea_order_id,response_status,signal_quality,final_amount
  FROM read_models.operations_incident_discount_recovery_latest
  ORDER BY dropea_order_id,source_updated_at DESC
)
SELECT r.canonical_order_id,r.store_id,d.lifecycle_status,r.status,
       d.created_at_utc,d.observed_at AS source_updated_at,r.updated_at,
       d.confirmed_at_utc,d.delivered_at_utc,d.returned_at_utc,
       r.total_amount,r.currency,r.carrier,r.product_summary,
       active_issues.active_issue_id,d.order_costs_masked AS order_costs,
       r.test_order,r.duplicate_status,
       CASE WHEN latest_discount.response_status='DISCOUNT_ACCEPTED'
                   AND latest_discount.signal_quality='VERIFIED'
            THEN coalesce(latest_discount.final_amount,r.total_amount)
            ELSE r.total_amount END AS final_amount,
       r.dropea_order_id
FROM read_models.operations_order_records r
LEFT JOIN integration.dropea_orders d USING(canonical_order_id)
LEFT JOIN active_issues USING(canonical_order_id)
LEFT JOIN latest_discount ON latest_discount.dropea_order_id=r.dropea_order_id;

REVOKE ALL ON read_models.operations_finance_order_inputs FROM PUBLIC,suleia_mcp_readonly;
GRANT SELECT ON read_models.operations_finance_order_inputs TO suleia_operations_readonly,suleia_backup;

-- Correct the category attribution confirmed against Dropea order breakdowns.
-- Delivered-order total is unchanged (2.20 EUR), but fulfilment and COD must
-- appear in their real columns.
UPDATE economics.finance_cost_rates
SET amount=1.00,updated_at=now()
WHERE cost_type='OUTBOUND_FULFILLMENT' AND carrier='GLS' AND source='BUSINESS_VERIFIED_RATE';

UPDATE economics.finance_cost_rates
SET amount=1.20,updated_at=now()
WHERE cost_type='COD' AND carrier='GLS' AND source='BUSINESS_VERIFIED_RATE';

COMMIT;

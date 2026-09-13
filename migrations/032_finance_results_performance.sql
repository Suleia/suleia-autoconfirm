BEGIN;

-- Finance-only projection over the canonical Dropea mirror. It deliberately
-- avoids the operational order context, whose incident and conversation
-- joins are useful for case review but unnecessarily expensive for P&L.
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
            ELSE r.total_amount END AS final_amount
FROM read_models.operations_order_records r
LEFT JOIN integration.dropea_orders d USING(canonical_order_id)
LEFT JOIN active_issues USING(canonical_order_id)
LEFT JOIN latest_discount ON latest_discount.dropea_order_id=r.dropea_order_id;

REVOKE ALL ON read_models.operations_finance_order_inputs FROM PUBLIC,suleia_mcp_readonly;
GRANT SELECT ON read_models.operations_finance_order_inputs TO suleia_operations_readonly,suleia_backup;

CREATE OR REPLACE VIEW read_models.finance_available_months AS
SELECT store_id,to_char(month_start,'YYYY-MM') AS month
FROM (
  SELECT store_id,date_trunc('month',event_at)::date AS month_start
  FROM read_models.operations_finance_order_inputs
  CROSS JOIN LATERAL unnest(ARRAY[created_at_utc,confirmed_at_utc,delivered_at_utc,returned_at_utc]) AS events(event_at)
  WHERE event_at IS NOT NULL
  UNION
  SELECT store_id,date_trunc('month',business_date)::date
  FROM economics.finance_ad_spend_daily
  UNION
  SELECT store_id,date_trunc('month',coalesce(occurred_on,start_date))::date
  FROM economics.finance_fixed_expenses
) months
GROUP BY store_id,month_start
ORDER BY month_start DESC;

REVOKE ALL ON read_models.finance_available_months FROM PUBLIC,suleia_mcp_readonly;
GRANT SELECT ON read_models.finance_available_months TO suleia_operations_readonly,suleia_backup;

COMMIT;

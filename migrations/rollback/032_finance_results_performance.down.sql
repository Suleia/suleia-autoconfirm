BEGIN;

CREATE OR REPLACE VIEW read_models.finance_available_months AS
SELECT store_id,to_char(month_start,'YYYY-MM') AS month
FROM (
  SELECT store_id,date_trunc('month',event_at)::date AS month_start
  FROM read_models.operations_order_context
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
DROP VIEW IF EXISTS read_models.operations_finance_order_inputs;

COMMIT;

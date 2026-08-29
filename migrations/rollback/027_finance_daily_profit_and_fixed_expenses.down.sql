BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='suleia_api_login') THEN
    REVOKE INSERT,UPDATE ON economics.finance_fixed_expenses FROM suleia_api_login;
  END IF;
END $$;
DROP VIEW IF EXISTS read_models.finance_available_months;
DROP TABLE IF EXISTS economics.finance_fixed_expense_audit;
CREATE VIEW read_models.finance_available_months AS
SELECT store_id,to_char(month_start,'YYYY-MM') AS month
FROM (
  SELECT store_id,date_trunc('month',created_at_utc)::date AS month_start
  FROM read_models.operations_order_context WHERE created_at_utc IS NOT NULL
  UNION
  SELECT store_id,date_trunc('month',business_date)::date
  FROM economics.finance_ad_spend_daily
) months
GROUP BY store_id,month_start
ORDER BY month_start DESC;
GRANT SELECT ON read_models.finance_available_months TO suleia_operations_readonly,suleia_backup;
COMMIT;

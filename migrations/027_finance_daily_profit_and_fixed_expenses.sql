BEGIN;

CREATE TABLE IF NOT EXISTS economics.finance_fixed_expense_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id uuid NOT NULL REFERENCES economics.finance_fixed_expenses(expense_id),
  operation text NOT NULL CHECK (operation IN ('CREATE','UPDATE')),
  snapshot jsonb NOT NULL,
  principal_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  external_actions integer NOT NULL DEFAULT 0 CHECK (external_actions=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0)
);

CREATE INDEX IF NOT EXISTS finance_fixed_expense_audit_expense_idx
  ON economics.finance_fixed_expense_audit(expense_id,created_at DESC);

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

GRANT SELECT ON economics.finance_fixed_expense_audit TO suleia_operations_readonly,suleia_backup;
GRANT SELECT ON SEQUENCE economics.finance_fixed_expense_audit_audit_id_seq TO suleia_backup;
GRANT SELECT ON read_models.finance_available_months TO suleia_operations_readonly,suleia_backup;

-- Only the authenticated Operations API login receives the narrowly scoped
-- internal configuration capability. No provider, order, customer or message
-- table is writable through this grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='suleia_api_login') THEN
    GRANT INSERT,UPDATE ON economics.finance_fixed_expenses TO suleia_api_login;
    GRANT INSERT ON economics.finance_fixed_expense_audit TO suleia_api_login;
    GRANT USAGE,SELECT ON SEQUENCE economics.finance_fixed_expense_audit_audit_id_seq TO suleia_api_login;
  END IF;
END $$;

COMMIT;

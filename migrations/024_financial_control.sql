BEGIN;

-- Financial configuration is internal Operations data. It never mutates an
-- order, provider, customer conversation or advertising campaign.
CREATE TABLE IF NOT EXISTS economics.finance_cost_rates (
  rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  cost_type text NOT NULL CHECK (cost_type IN (
    'PRODUCT_COGS','OUTBOUND_SHIPPING','OUTBOUND_FULFILLMENT','COD',
    'RETURN_SHIPPING','RETURN_FULFILLMENT'
  )),
  carrier text,
  provider text,
  product_id text,
  variant_id text,
  amount numeric(14,4) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  effective_from date NOT NULL,
  effective_to date,
  source text NOT NULL DEFAULT 'OPERATIONS_CONFIGURATION',
  source_reference_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS finance_cost_rates_lookup_idx
  ON economics.finance_cost_rates(store_id,cost_type,effective_from,effective_to);

CREATE TABLE IF NOT EXISTS economics.finance_fixed_expenses (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  expense_type text NOT NULL CHECK (expense_type IN ('RECURRING','ONE_OFF')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  start_date date NOT NULL,
  end_date date,
  occurred_on date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  source text NOT NULL DEFAULT 'OPERATIONS_CONFIGURATION',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (expense_type <> 'ONE_OFF' OR occurred_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS finance_fixed_expenses_window_idx
  ON economics.finance_fixed_expenses(store_id,start_date,end_date,status);

CREATE TABLE IF NOT EXISTS economics.finance_ad_spend_daily (
  store_id text NOT NULL,
  business_date date NOT NULL,
  platform text NOT NULL,
  spend numeric(14,2),
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL,
  source_record_key text NOT NULL,
  campaign_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_status text NOT NULL CHECK (sync_status IN ('COMPLETE','INCOMPLETE','STALE','FAILED')),
  source_observed_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,business_date,platform,source_record_key)
);

CREATE TABLE IF NOT EXISTS economics.finance_sync_checkpoints (
  store_id text NOT NULL,
  source text NOT NULL,
  business_date date NOT NULL,
  sync_status text NOT NULL CHECK (sync_status IN ('COMPLETE','INCOMPLETE','STALE','FAILED')),
  records_read integer NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id,source,business_date)
);

CREATE OR REPLACE VIEW read_models.finance_available_months AS
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

GRANT USAGE ON SCHEMA economics TO suleia_operations_readonly,suleia_ingestion,suleia_backup;
GRANT SELECT ON economics.finance_cost_rates,economics.finance_fixed_expenses,
  economics.finance_ad_spend_daily,economics.finance_sync_checkpoints
TO suleia_operations_readonly,suleia_backup;
GRANT SELECT,INSERT,UPDATE ON economics.finance_ad_spend_daily,economics.finance_sync_checkpoints
TO suleia_ingestion;
GRANT SELECT ON read_models.finance_available_months TO suleia_operations_readonly,suleia_backup;

COMMIT;

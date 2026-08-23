BEGIN;
DROP VIEW IF EXISTS read_models.finance_available_months;
DROP TABLE IF EXISTS economics.finance_sync_checkpoints;
DROP TABLE IF EXISTS economics.finance_ad_spend_daily;
DROP TABLE IF EXISTS economics.finance_fixed_expenses;
DROP TABLE IF EXISTS economics.finance_cost_rates;
COMMIT;

BEGIN;
DROP VIEW IF EXISTS read_models.operations_rejected_actions;
DROP VIEW IF EXISTS read_models.operations_rejected_returns;
-- Keep the additive JSON column and view extension: preserves observations and
-- allows rollback to the previous API/ingestion images without data loss.
COMMIT;

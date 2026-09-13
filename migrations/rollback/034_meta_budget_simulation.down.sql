BEGIN;

DROP VIEW IF EXISTS read_models.meta_budget_simulation_latest;
DROP VIEW IF EXISTS read_models.meta_budget_decision_history;
DROP TABLE IF EXISTS economics.meta_budget_simulation_resets;
DROP TABLE IF EXISTS economics.meta_budget_simulated_state;
DROP TABLE IF EXISTS economics.meta_budget_decisions;

COMMIT;


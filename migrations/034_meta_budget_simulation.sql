BEGIN;

CREATE TABLE IF NOT EXISTS economics.meta_budget_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_hour timestamptz NOT NULL CHECK (evaluation_hour=date_trunc('hour',evaluation_hour)),
  campaign_id text NOT NULL CHECK (campaign_id<>''),
  campaign_name text NOT NULL DEFAULT '',
  campaign_status text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Madrid' CHECK (timezone='Europe/Madrid'),
  local_time text NOT NULL CHECK (local_time LIKE '%[Europe/Madrid]'),
  budget_model text NOT NULL CHECK (budget_model IN ('CBO','ABO','UNKNOWN')),
  budget_period text NOT NULL CHECK (budget_period IN ('DAILY','LIFETIME','MULTIPLE','NONE')),
  actual_meta_budget_cents bigint CHECK (actual_meta_budget_cents IS NULL OR actual_meta_budget_cents>=0),
  simulated_budget_before_cents bigint CHECK (simulated_budget_before_cents IS NULL OR simulated_budget_before_cents>=0),
  budget_proposed_cents bigint CHECK (budget_proposed_cents IS NULL OR budget_proposed_cents>=0),
  budget_delta_cents bigint,
  purchase_roas numeric(20,8) CHECK (purchase_roas IS NULL OR purchase_roas>=0),
  metrics_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics_status text NOT NULL CHECK (metrics_status IN ('FRESH','STALE','INCOMPLETE','FAILED')),
  policy_version text NOT NULL CHECK (policy_version='META_BUDGET_POLICY_V1'),
  decision_type text NOT NULL CHECK (decision_type IN ('WOULD_CHANGE','HOLD','BLOCK_POLICY','SIMULATION_ONLY_REVIEW')),
  reason_code text NOT NULL,
  reason_text text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('SIMULATION','SHADOW')),
  would_execute boolean NOT NULL DEFAULT false,
  executed boolean NOT NULL DEFAULT false CHECK (executed=false),
  meta_write_attempted boolean NOT NULL DEFAULT false CHECK (meta_write_attempted=false),
  telegram_preview_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_actions integer NOT NULL DEFAULT 0 CHECK (external_actions=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0),
  meta_budget_writes integer NOT NULL DEFAULT 0 CHECK (meta_budget_writes=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_budget_delta_consistent CHECK (
    budget_delta_cents IS NULL OR budget_delta_cents=budget_proposed_cents-simulated_budget_before_cents
  ),
  CONSTRAINT meta_budget_would_execute_bounds CHECK (
    would_execute=false OR (budget_proposed_cents BETWEEN 1500 AND 7000)
  ),
  CONSTRAINT meta_budget_hourly_idempotency UNIQUE (campaign_id,evaluation_hour,policy_version)
);

CREATE INDEX IF NOT EXISTS meta_budget_decisions_hour_idx
  ON economics.meta_budget_decisions(evaluation_hour DESC,campaign_id);
CREATE INDEX IF NOT EXISTS meta_budget_decisions_reason_idx
  ON economics.meta_budget_decisions(reason_code,evaluation_hour DESC);

CREATE TABLE IF NOT EXISTS economics.meta_budget_simulated_state (
  campaign_id text NOT NULL CHECK (campaign_id<>''),
  policy_version text NOT NULL CHECK (policy_version='META_BUDGET_POLICY_V1'),
  actual_meta_budget_cents bigint NOT NULL CHECK (actual_meta_budget_cents>=0),
  simulated_budget_cents bigint NOT NULL CHECK (simulated_budget_cents>=0),
  last_evaluation_hour timestamptz NOT NULL CHECK (last_evaluation_hour=date_trunc('hour',last_evaluation_hour)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id,policy_version)
);

CREATE TABLE IF NOT EXISTS economics.meta_budget_simulation_resets (
  reset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version='META_BUDGET_POLICY_V1'),
  actual_meta_budget_cents bigint NOT NULL CHECK (actual_meta_budget_cents>=0),
  reason text NOT NULL,
  external_actions integer NOT NULL DEFAULT 0 CHECK (external_actions=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0),
  meta_budget_writes integer NOT NULL DEFAULT 0 CHECK (meta_budget_writes=0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW read_models.meta_budget_decision_history AS
SELECT decision_id,evaluation_hour,campaign_id,campaign_name,campaign_status,timezone,local_time,
       budget_model,budget_period,actual_meta_budget_cents,simulated_budget_before_cents,
       budget_proposed_cents,budget_delta_cents,purchase_roas,metrics_window,metrics_status,
       policy_version,decision_type,reason_code,reason_text,mode,would_execute,executed,
       meta_write_attempted,telegram_preview_payload,external_actions,production_writes,
       meta_budget_writes,created_at
FROM economics.meta_budget_decisions;

CREATE OR REPLACE VIEW read_models.meta_budget_simulation_latest AS
WITH latest AS (
  SELECT DISTINCT ON (campaign_id,policy_version) *
  FROM economics.meta_budget_decisions
  ORDER BY campaign_id,policy_version,evaluation_hour DESC,created_at DESC
)
SELECT latest.campaign_id,latest.campaign_name,latest.campaign_status,latest.budget_model,
       latest.budget_period,latest.actual_meta_budget_cents,
       state.simulated_budget_cents,latest.purchase_roas,latest.metrics_status,
       latest.decision_type,latest.budget_proposed_cents,latest.reason_code,latest.reason_text,
       latest.evaluation_hour AS last_evaluation,latest.local_time,latest.mode,latest.policy_version,
       'SIMULATION - NO REAL CHANGES'::text AS safety_notice,
       false AS executed,false AS meta_write_attempted,0::integer AS external_actions,
       0::integer AS production_writes,0::integer AS meta_budget_writes
FROM latest
LEFT JOIN economics.meta_budget_simulated_state state
  ON state.campaign_id=latest.campaign_id AND state.policy_version=latest.policy_version;

REVOKE ALL ON economics.meta_budget_decisions,economics.meta_budget_simulated_state,
  economics.meta_budget_simulation_resets FROM PUBLIC,suleia_mcp_readonly;
REVOKE ALL ON read_models.meta_budget_decision_history,
  read_models.meta_budget_simulation_latest FROM PUBLIC,suleia_mcp_readonly;

GRANT SELECT,INSERT ON economics.meta_budget_decisions TO suleia_ingestion;
GRANT SELECT,INSERT,UPDATE ON economics.meta_budget_simulated_state TO suleia_ingestion;
GRANT SELECT,INSERT ON economics.meta_budget_simulation_resets TO suleia_ingestion;
GRANT SELECT ON economics.meta_budget_decisions,economics.meta_budget_simulated_state,
  economics.meta_budget_simulation_resets TO suleia_backup;
GRANT SELECT ON read_models.meta_budget_decision_history,
  read_models.meta_budget_simulation_latest TO suleia_operations_readonly,suleia_backup;

COMMIT;

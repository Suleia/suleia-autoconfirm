BEGIN;

CREATE TABLE IF NOT EXISTS decision_memory.incident_recommendation_feedback (
  feedback_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_issue_id text NOT NULL REFERENCES read_models.operations_incident_records(canonical_issue_id),
  recommendation_code text NOT NULL,
  feedback_type text NOT NULL CHECK (feedback_type IN ('APPROVE','CORRECT','REJECT')),
  reason_code text NOT NULL CHECK (reason_code IN ('ACCURATE','WRONG_TYPE','MISSING_CHATBY','WRONG_ACTION','STALE_DATA','OTHER')),
  principal_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed=0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes=0)
);

CREATE INDEX IF NOT EXISTS incident_feedback_issue_created_idx
  ON decision_memory.incident_recommendation_feedback(canonical_issue_id,created_at DESC);

GRANT USAGE ON SCHEMA decision_memory TO suleia_operations_readonly;
GRANT SELECT,INSERT ON decision_memory.incident_recommendation_feedback TO suleia_operations_readonly;
GRANT USAGE,SELECT ON SEQUENCE decision_memory.incident_recommendation_feedback_feedback_id_seq TO suleia_operations_readonly;
GRANT SELECT ON decision_memory.incident_recommendation_feedback TO suleia_backup;

COMMIT;

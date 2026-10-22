BEGIN;
CREATE TABLE economics.ads_autopilot_slots (
 account_id text NOT NULL CHECK(account_id ~ '^[0-9]+$'),
 slot_key text NOT NULL CHECK(slot_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{2}:[0-9]{2}$'),
 state text NOT NULL CHECK(state IN ('EXECUTING','COMPLETE','FAILED')),
 body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 PRIMARY KEY(account_id,slot_key)
);
GRANT SELECT,INSERT,UPDATE ON economics.ads_autopilot_slots TO suleia_ads_executor;
GRANT SELECT ON economics.ads_autopilot_slots TO suleia_operations_readonly,suleia_backup;
CREATE INDEX ads_proposals_account_audit ON economics.ads_proposals((body->>'accountId'),created_at DESC,id DESC);
COMMENT ON TABLE economics.ads_autopilot_slots IS 'Single scheduler claim per Madrid slot. Interrupted claims require review, never replay. No additional budget writer.';
COMMIT;

BEGIN;
CREATE TABLE economics.command_context (
 actor text PRIMARY KEY CHECK(actor ~ '^[1-9][0-9]*$'), body jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE economics.command_decisions (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 actor text NOT NULL CHECK(actor ~ '^[1-9][0-9]*$'),
 kind text NOT NULL CHECK(kind IN ('QUERY','EXECUTIVE_BRIEF','DECISION')),
 body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX command_decisions_actor_time ON economics.command_decisions(actor,created_at DESC);
GRANT SELECT,INSERT,UPDATE ON economics.command_context TO suleia_ads_executor;
GRANT SELECT,INSERT ON economics.command_decisions TO suleia_ads_executor;
GRANT SELECT ON economics.command_decisions TO suleia_operations_readonly,suleia_backup;
COMMENT ON TABLE economics.command_decisions IS 'Append-only structured evidence; no raw Telegram text, contacts or authorization inferred from history.';
COMMIT;

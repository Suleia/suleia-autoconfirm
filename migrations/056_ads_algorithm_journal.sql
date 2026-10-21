BEGIN;
CREATE TABLE economics.ads_algorithm_journal (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 event_type text NOT NULL CHECK(event_type IN ('DIAGNOSIS','RECOMMENDATION','APPROVED','REJECTED','FALSE_POSITIVE','OBSERVATION','EXPERIMENT_DESIGN')),
 reference text NOT NULL CHECK(length(reference)<=100),body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE economics.ads_algorithm_journal IS 'Append-only review evidence. No Meta execution or automatic rule learning.';
GRANT SELECT ON economics.ads_algorithm_journal TO suleia_operations_readonly,suleia_backup;
GRANT SELECT,INSERT ON economics.ads_algorithm_journal TO suleia_ads_executor;
COMMIT;

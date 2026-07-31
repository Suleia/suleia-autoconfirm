BEGIN;

CREATE SCHEMA IF NOT EXISTS raw_private;
CREATE SCHEMA IF NOT EXISTS truth;
CREATE SCHEMA IF NOT EXISTS reconciliation;
CREATE SCHEMA IF NOT EXISTS enterprise_graph;
CREATE SCHEMA IF NOT EXISTS decision_memory;
CREATE SCHEMA IF NOT EXISTS enterprise_twins;
CREATE SCHEMA IF NOT EXISTS economics;
CREATE SCHEMA IF NOT EXISTS process_intelligence;
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE SCHEMA IF NOT EXISTS migration;
CREATE SCHEMA IF NOT EXISTS read_models;

REVOKE ALL ON SCHEMA raw_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS migration.source_inventory (
  source text NOT NULL, source_object text NOT NULL, classification text NOT NULL,
  record_count bigint NOT NULL DEFAULT 0, oldest_at timestamptz, newest_at timestamptz,
  schema_fingerprint text, inventoried_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_object)
);

CREATE TABLE IF NOT EXISTS migration.batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, source_object text NOT NULL,
  range_start timestamptz, range_end timestamptz, source_records bigint NOT NULL DEFAULT 0,
  imported_records bigint NOT NULL DEFAULT 0, transformed_records bigint NOT NULL DEFAULT 0,
  rejected_records bigint NOT NULL DEFAULT 0, duplicate_records bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0, checksum text, masking_status text NOT NULL DEFAULT 'PENDING',
  reconciliation_status text NOT NULL DEFAULT 'PENDING', rollback_status text NOT NULL DEFAULT 'AVAILABLE',
  status text NOT NULL DEFAULT 'PENDING', started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY'),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0)
);

CREATE TABLE IF NOT EXISTS migration.checkpoints (
  source text NOT NULL, source_object text NOT NULL, cursor_masked text, last_seen_at timestamptz,
  last_success_at timestamptz, last_failure_at timestamptz, lag_seconds bigint,
  status text NOT NULL DEFAULT 'UNKNOWN', updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_object)
);

CREATE TABLE IF NOT EXISTS migration.rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES migration.batches(batch_id),
  source_record_hash text, reason_code text NOT NULL, detail_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_private.source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES migration.batches(batch_id),
  source text NOT NULL, source_object text NOT NULL, source_record_hash text NOT NULL,
  canonical_order_hash text, payload_masked jsonb NOT NULL, payload_checksum text NOT NULL,
  source_updated_at timestamptz, imported_at timestamptz NOT NULL DEFAULT now(),
  masking_version text NOT NULL DEFAULT 'shadow-v1',
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY'),
  UNIQUE (source, source_object, source_record_hash, payload_checksum)
);

CREATE TABLE IF NOT EXISTS truth.snapshots (
  truth_snapshot_id text PRIMARY KEY, canonical_order_hash text NOT NULL, snapshot jsonb NOT NULL,
  quality_score integer NOT NULL CHECK (quality_score BETWEEN 0 AND 100), identity_status text NOT NULL,
  shadow_eligible boolean NOT NULL DEFAULT false, blocking_reasons text[] NOT NULL DEFAULT '{}',
  generated_at timestamptz NOT NULL, schema_version text NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation.ledger (
  fingerprint text PRIMARY KEY, canonical_order_hash text, source_a text NOT NULL, source_b text NOT NULL,
  comparison_result text NOT NULL, difference_classification text NOT NULL,
  occurrence_count bigint NOT NULL DEFAULT 1, first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL, evidence_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz, resolution text
);

CREATE TABLE IF NOT EXISTS enterprise_graph.entities (
  entity_id text PRIMARY KEY, entity_type text NOT NULL, source text NOT NULL,
  attributes_masked jsonb NOT NULL DEFAULT '{}'::jsonb, confidence numeric(5,4) NOT NULL,
  valid_from timestamptz, valid_until timestamptz, evidence_hashes text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS enterprise_graph.relationships (
  relationship_id text PRIMARY KEY, from_entity_id text NOT NULL REFERENCES enterprise_graph.entities(entity_id),
  to_entity_id text NOT NULL REFERENCES enterprise_graph.entities(entity_id), relationship_type text NOT NULL,
  source text NOT NULL, confidence numeric(5,4) NOT NULL, evidence_hashes text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz, valid_until timestamptz
);

CREATE TABLE IF NOT EXISTS decision_memory.records (
  memory_id text PRIMARY KEY, canonical_order_hash text, facts_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_versions text[] NOT NULL DEFAULT '{}', proposed_decision text NOT NULL DEFAULT 'UNKNOWN',
  executed_decision text NOT NULL DEFAULT 'UNKNOWN', human_review text NOT NULL DEFAULT 'UNKNOWN',
  final_outcome text NOT NULL DEFAULT 'UNKNOWN', differences text[] NOT NULL DEFAULT '{}',
  economic_impact jsonb NOT NULL DEFAULT '{"status":"UNKNOWN"}'::jsonb,
  evidence_hashes text[] NOT NULL DEFAULT '{}', recorded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS enterprise_twins.snapshots (
  twin_id text PRIMARY KEY, twin_type text NOT NULL, entity_hash text NOT NULL,
  snapshot_masked jsonb NOT NULL, completeness numeric(5,4) NOT NULL,
  freshness_status text NOT NULL, generated_at timestamptz NOT NULL,
  run_mode text NOT NULL DEFAULT 'SHADOW_READ_ONLY' CHECK (run_mode = 'SHADOW_READ_ONLY')
);

CREATE TABLE IF NOT EXISTS economics.observations (
  observation_id text PRIMARY KEY, canonical_order_hash text, metric text NOT NULL,
  value numeric, currency text, value_status text NOT NULL CHECK (value_status IN ('OBSERVED','CALCULATED','ESTIMATED','UNKNOWN')),
  source text NOT NULL, observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS process_intelligence.observations (
  observation_id text PRIMARY KEY, process_type text NOT NULL, entity_hash text,
  state text NOT NULL, duration_seconds bigint, source text NOT NULL, observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge.facts (
  fact_id text PRIMARY KEY, fact_type text NOT NULL, entity_hash text,
  value_masked jsonb NOT NULL, verification_status text NOT NULL,
  source text NOT NULL, confidence numeric(5,4) NOT NULL, observed_at timestamptz NOT NULL
);

CREATE OR REPLACE VIEW read_models.migration_summary AS
SELECT source, source_object, status, source_records, imported_records, transformed_records,
       rejected_records, duplicate_records, errors, masking_status, reconciliation_status,
       started_at, completed_at, actions_executed, production_writes
FROM migration.batches;

CREATE OR REPLACE VIEW read_models.operational_truth_summary AS
SELECT
  (SELECT count(*) FROM truth.snapshots) AS truth_snapshots,
  (SELECT count(*) FROM truth.snapshots WHERE shadow_eligible) AS shadow_eligible,
  (SELECT count(*) FROM reconciliation.ledger) AS comparisons,
  (SELECT count(*) FROM decision_memory.records) AS decision_memories,
  (SELECT count(*) FROM enterprise_graph.entities) AS graph_entities,
  (SELECT count(*) FROM enterprise_graph.relationships) AS graph_relationships,
  (SELECT count(*) FROM enterprise_twins.snapshots) AS enterprise_twins,
  0::integer AS actions_executed, 0::integer AS production_writes;

REVOKE ALL ON ALL TABLES IN SCHEMA raw_private FROM PUBLIC;
GRANT USAGE ON SCHEMA raw_private, truth, reconciliation, enterprise_graph, decision_memory,
  enterprise_twins, economics, process_intelligence, knowledge, migration, read_models TO suleia_ingestion;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA raw_private, truth, reconciliation,
  enterprise_graph, decision_memory, enterprise_twins, economics, process_intelligence,
  knowledge, migration TO suleia_ingestion;
GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_ingestion;
GRANT USAGE ON SCHEMA read_models TO suleia_mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA read_models TO suleia_mcp_readonly;
GRANT USAGE ON SCHEMA raw_private, truth, reconciliation, enterprise_graph, decision_memory,
  enterprise_twins, economics, process_intelligence, knowledge, migration, read_models TO suleia_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA raw_private, truth, reconciliation, enterprise_graph,
  decision_memory, enterprise_twins, economics, process_intelligence, knowledge, migration,
  read_models TO suleia_backup;

COMMIT;

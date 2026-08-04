BEGIN;

CREATE SCHEMA IF NOT EXISTS integration;
REVOKE ALL ON SCHEMA integration FROM PUBLIC;

CREATE TABLE IF NOT EXISTS integration.dropea_store_config (
  market text NOT NULL,
  store_id text NOT NULL,
  base_url text NOT NULL,
  jwt_secret_reference text NOT NULL,
  jwt_expires_at timestamptz NOT NULL,
  migration_cutover_at timestamptz NOT NULL,
  native_v2_activation_at timestamptz NOT NULL,
  historical_reingestion_allowed boolean NOT NULL DEFAULT false CHECK (historical_reingestion_allowed = false),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, store_id),
  CHECK (market IN ('ES','IT','PT')),
  CHECK (base_url = 'https://' || lower(market) || '.public-api.dropea.com')
);

CREATE TABLE IF NOT EXISTS integration.dropea_orders (
  market text NOT NULL,
  store_id text NOT NULL,
  dropea_order_id text NOT NULL,
  canonical_order_id text NOT NULL UNIQUE,
  external_order_id_hash text,
  external_order_id_ciphertext text,
  status text NOT NULL,
  sub_status text,
  lifecycle_status text NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  payment_method text,
  carrier text,
  service_type text,
  line_items_masked jsonb NOT NULL DEFAULT '[]'::jsonb,
  canonical_product_keys text[] NOT NULL DEFAULT '{}',
  product_display_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  normalized_address_hash text,
  shipping_address_ciphertext text,
  address_line_2_present boolean NOT NULL DEFAULT false,
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  confirmed_at_utc timestamptz,
  delivered_at_utc timestamptz,
  source_system text NOT NULL DEFAULT 'DROPEA_PUBLIC_API_V2',
  source_version text NOT NULL,
  schema_version text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_hash text NOT NULL,
  data_freshness text NOT NULL,
  historical_pre_cutover boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  shadow_mirror_writes integer NOT NULL DEFAULT 1,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  PRIMARY KEY (market, store_id, dropea_order_id)
);

CREATE TABLE IF NOT EXISTS integration.dropea_issues (
  market text NOT NULL,
  store_id text NOT NULL,
  dropea_issue_id text NOT NULL,
  canonical_issue_id text NOT NULL UNIQUE,
  canonical_order_id text NOT NULL,
  dropea_order_id text NOT NULL,
  carrier text NOT NULL,
  canonical_type text NOT NULL,
  secondary_type text NOT NULL,
  raw_type text NOT NULL,
  status text NOT NULL,
  is_active boolean NOT NULL,
  initial_carrier_code text,
  initial_carrier_description_sanitized text,
  initial_carrier_substatus_code text,
  allowed_resolution_options text[] NOT NULL DEFAULT '{}',
  capability_status text NOT NULL,
  resolution_status text,
  pickup_point_masked jsonb,
  delivery_attempt_number text NOT NULL DEFAULT 'UNKNOWN',
  created_at_utc timestamptz NOT NULL,
  updated_at_utc timestamptz NOT NULL,
  source_event_id text,
  source_version text NOT NULL,
  observed_at timestamptz NOT NULL,
  payload_hash text NOT NULL,
  data_freshness text NOT NULL,
  human_review boolean NOT NULL,
  automation_allowed boolean NOT NULL DEFAULT false CHECK (automation_allowed = false),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  shadow_mirror_writes integer NOT NULL DEFAULT 1,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  PRIMARY KEY (market, store_id, dropea_issue_id)
);

CREATE TABLE IF NOT EXISTS integration.dropea_sync_checkpoints (
  market text NOT NULL,
  store_id text NOT NULL,
  resource_type text NOT NULL,
  phase text NOT NULL,
  page integer,
  requested_limit integer NOT NULL DEFAULT 100,
  records_read bigint NOT NULL DEFAULT 0,
  records_inserted_to_shadow bigint NOT NULL DEFAULT 0,
  records_updated_in_shadow bigint NOT NULL DEFAULT 0,
  duplicates_skipped bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0,
  checkpoint_masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_started_at timestamptz,
  sync_completed_at timestamptz,
  source_updated_at timestamptz,
  freshness text NOT NULL DEFAULT 'UNKNOWN',
  pagination_complete boolean NOT NULL DEFAULT false,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  PRIMARY KEY (market, store_id, resource_type, phase)
);

CREATE TABLE IF NOT EXISTS integration.dropea_webhook_events (
  event_id text PRIMARY KEY,
  topic text NOT NULL,
  market text NOT NULL,
  store_id text NOT NULL,
  resource_id text NOT NULL,
  payload_hash text NOT NULL,
  auth_status text NOT NULL CHECK (auth_status IN ('HMAC_VALID','PATH_TOKEN_VALID','AUTH_FAILED')),
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'PENDING',
  late_event boolean NOT NULL DEFAULT false,
  actions_executed integer NOT NULL DEFAULT 0 CHECK (actions_executed = 0),
  production_writes integer NOT NULL DEFAULT 0 CHECK (production_writes = 0),
  UNIQUE (market, store_id, event_id, payload_hash)
);

ALTER TABLE read_models.operations_order_records
  ADD COLUMN IF NOT EXISTS market text,
  ADD COLUMN IF NOT EXISTS store_id text,
  ADD COLUMN IF NOT EXISTS product_display_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS normalized_address_hash text,
  ADD COLUMN IF NOT EXISTS address_line_2_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_system text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS conversation_source text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS interpretation_status text NOT NULL DEFAULT 'WAITING_CHATBY_SOURCE';

ALTER TABLE read_models.operations_incident_records
  ADD COLUMN IF NOT EXISTS market text,
  ADD COLUMN IF NOT EXISTS store_id text,
  ADD COLUMN IF NOT EXISTS secondary_type text,
  ADD COLUMN IF NOT EXISTS capability_status text NOT NULL DEFAULT 'NOT_DECLARED',
  ADD COLUMN IF NOT EXISTS human_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS automation_allowed boolean NOT NULL DEFAULT false CHECK (automation_allowed = false),
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS conversation_source text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS interpretation_status text NOT NULL DEFAULT 'WAITING_CHATBY_SOURCE';

CREATE OR REPLACE VIEW read_models.operations_data_freshness AS
SELECT market, store_id, resource_type, phase, sync_completed_at AS source_updated_at,
       freshness, pagination_complete, records_read, errors, updated_at AS measured_at,
       0::integer AS actions_executed, 0::integer AS production_writes
FROM integration.dropea_sync_checkpoints;

CREATE OR REPLACE VIEW read_models.integration_dropea_orders AS SELECT * FROM integration.dropea_orders;
CREATE OR REPLACE VIEW read_models.integration_dropea_issues AS SELECT * FROM integration.dropea_issues;
CREATE OR REPLACE VIEW read_models.integration_dropea_sync_checkpoints AS SELECT * FROM integration.dropea_sync_checkpoints;
CREATE OR REPLACE VIEW read_models.integration_dropea_webhook_events AS SELECT * FROM integration.dropea_webhook_events;

CREATE INDEX IF NOT EXISTS dropea_orders_updated_idx ON integration.dropea_orders(market, store_id, updated_at_utc DESC);
CREATE INDEX IF NOT EXISTS dropea_issues_pending_idx ON integration.dropea_issues(market, store_id, status, is_active, updated_at_utc DESC);
CREATE INDEX IF NOT EXISTS dropea_webhook_received_idx ON integration.dropea_webhook_events(received_at DESC);

GRANT USAGE ON SCHEMA integration TO suleia_ingestion, suleia_backup;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA integration TO suleia_ingestion;
GRANT SELECT ON ALL TABLES IN SCHEMA integration TO suleia_backup;
GRANT SELECT ON read_models.operations_data_freshness,
  read_models.integration_dropea_orders, read_models.integration_dropea_issues,
  read_models.integration_dropea_sync_checkpoints, read_models.integration_dropea_webhook_events
TO suleia_mcp_readonly, suleia_operations_readonly;

COMMIT;

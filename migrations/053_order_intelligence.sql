BEGIN;
CREATE SCHEMA IF NOT EXISTS analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='suleia_analytics_materializer') THEN
 CREATE ROLE suleia_analytics_materializer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
END IF; END $$;
CREATE TABLE IF NOT EXISTS analytics.order_facts (
 canonical_order_id text PRIMARY KEY,
 business_date date NOT NULL,
 source_hash text NOT NULL,
 fact jsonb NOT NULL CHECK (NOT fact ?| ARRAY['name','phone','email','address','shipping_address_ciphertext','conversation','message']),
 materialized_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_facts_date ON analytics.order_facts(business_date);
CREATE INDEX IF NOT EXISTS analytics_facts_dimensions ON analytics.order_facts((fact->>'province'),(fact->>'product'),business_date);
CREATE TABLE IF NOT EXISTS analytics.order_cells (
 cell_key text PRIMARY KEY,business_date date NOT NULL,cell jsonb NOT NULL,materialized_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_cells_date ON analytics.order_cells(business_date);
CREATE TABLE IF NOT EXISTS analytics.finance_days (business_date date PRIMARY KEY,body jsonb NOT NULL,materialized_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics.finance_months (month text PRIMARY KEY,body jsonb NOT NULL,materialized_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics.detected_patterns (pattern_id text PRIMARY KEY,body jsonb NOT NULL,detected_at timestamptz NOT NULL,valid_until timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS analytics.insights (insight_id text PRIMARY KEY,body jsonb NOT NULL,generated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics.runtime_state (state_key text PRIMARY KEY,body jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS analytics.daily_summaries (business_date date PRIMARY KEY,body jsonb NOT NULL,generated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics.agent_registry (agent_id text PRIMARY KEY,body jsonb NOT NULL);
INSERT INTO analytics.agent_registry VALUES ('ORDER_INTELLIGENCE_AGENT','{"category":"DATA_INTELLIGENCE","mode":"READ_ONLY","external_actions":false,"experimental_predictions":false,"version":1}') ON CONFLICT DO NOTHING;

-- Input is outside analytics; only the existing protected reader can access
-- encrypted geography transiently. MCP has NO grant on this view.
CREATE OR REPLACE VIEW read_models.order_intelligence_source AS
WITH issues AS (
 SELECT canonical_order_id,count(DISTINCT canonical_issue_id)::integer AS incident_count,
 array_agg(DISTINCT canonical_type) FILTER (WHERE canonical_type IS NOT NULL) AS incident_types,
 max(observed_at) AS issue_updated_at
 FROM integration.dropea_issues GROUP BY canonical_order_id
), discount AS (
 SELECT DISTINCT ON (dropea_order_id) dropea_order_id,discount_sent_at,response_status,signal_quality,source_updated_at
 FROM read_models.operations_incident_discount_recovery_latest ORDER BY dropea_order_id,source_updated_at DESC
), contact AS (
 SELECT canonical_order_id,min(occurred_at) FILTER (WHERE direction='OUTBOUND') AS first_contact_at,max(updated_at) AS contact_updated_at
 FROM read_models.operations_private_incident_messages WHERE relation_to_issue='AFTER_INCIDENT' GROUP BY canonical_order_id
), replies AS (
 SELECT m.canonical_order_id,min(m.occurred_at) AS first_response_at
 FROM read_models.operations_private_incident_messages m JOIN contact c USING(canonical_order_id)
 WHERE m.direction='INBOUND' AND m.relation_to_issue='AFTER_INCIDENT' AND m.occurred_at>=c.first_contact_at
 GROUP BY m.canonical_order_id
)
SELECT d.canonical_order_id,d.dropea_order_id,d.store_id,d.lifecycle_status,d.status,d.total_amount,d.currency,
 d.created_at_utc,d.confirmed_at_utc,d.processing_at_utc,d.delivered_at_utc,d.returned_at_utc,d.cancelled_at_utc,
 d.shipping_address_ciphertext,r.product_summary,r.test_order,r.duplicate_status,
 coalesce(i.incident_count,0) AS incident_count,coalesce(i.incident_types,'{}'::text[]) AS incident_types,
 c.first_contact_at,p.first_response_at,s.discount_sent_at,s.response_status AS discount_response,s.signal_quality AS discount_signal_quality,
 w.cod_change_verified,greatest(d.observed_at,i.issue_updated_at,s.source_updated_at,r.updated_at,w.updated_at,c.contact_updated_at) AS source_updated_at,
 d.observed_at AS order_observed_at
FROM integration.dropea_orders d LEFT JOIN read_models.operations_order_records r USING(canonical_order_id)
LEFT JOIN issues i USING(canonical_order_id) LEFT JOIN contact c USING(canonical_order_id) LEFT JOIN replies p USING(canonical_order_id)
LEFT JOIN discount s ON s.dropea_order_id=d.dropea_order_id LEFT JOIN read_models.operations_discount_workflows w USING(canonical_order_id);
REVOKE ALL ON read_models.order_intelligence_source FROM PUBLIC,suleia_mcp_readonly,suleia_analytics_materializer;
GRANT SELECT ON read_models.order_intelligence_source TO suleia_operations_readonly;

-- Pre-aggregated input views; the shared deterministic service applies all
-- filters before calculating rates (never averages percentages).
DO $$ DECLARE r record; BEGIN FOR r IN SELECT * FROM (VALUES
 ('orders_by_hour','hour'),('orders_by_weekday','weekday'),('orders_by_province','province'),('orders_by_city','locality'),
 ('orders_by_product','product'),('orders_by_offer','offer'),('order_outcomes','outcome'),('return_patterns','maturity'),
 ('confirmation_patterns','confirmation_delay_band'),('delivery_patterns','has_incident'),('incident_patterns','province'),
 ('profitability_segments','product'),('order_funnel','outcome'),('daily_order_intelligence','day'),('customer_response_patterns','response_delay_band')
 ) AS dimensions(model,dimension) LOOP
 EXECUTE format('CREATE OR REPLACE VIEW analytics.%I AS SELECT business_date,cell->>%L AS dimension_value,
 sum((cell->''counts''->>''orders'')::bigint) AS orders,
 sum((cell->''counts''->>''confirmed'')::bigint) AS confirmed,
 sum((cell->''counts''->>''sent'')::bigint) AS sent,
 sum((cell->''counts''->>''delivered'')::bigint) AS delivered,
 sum((cell->''counts''->>''returned'')::bigint) AS returned,
 sum((cell->''counts''->>''incident_orders'')::bigint) AS incident_orders,
 sum((cell->''counts''->>''revenue'')::numeric) AS known_revenue,
 sum((cell->''counts''->>''revenue_known'')::bigint) AS revenue_known_orders,
 sum((cell->''counts''->>''contribution'')::numeric) AS known_contribution,
 sum((cell->''counts''->>''contribution_known'')::bigint) AS contribution_known_orders,
 sum((cell->''counts''->>''missing_costs'')::bigint) AS missing_cost_orders
 FROM analytics.order_cells GROUP BY business_date,cell->>%L',r.model,r.dimension,r.dimension);
 END LOOP; END $$;
GRANT USAGE ON SCHEMA analytics TO suleia_operations_readonly,suleia_mcp_readonly,suleia_analytics_materializer,suleia_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
REVOKE ALL ON analytics.order_facts FROM suleia_mcp_readonly;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA analytics TO suleia_analytics_materializer;
REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC;
COMMENT ON SCHEMA analytics IS 'Additive read-only business intelligence. Only its materializer writes derived analytics. No operational actions.';
COMMIT;

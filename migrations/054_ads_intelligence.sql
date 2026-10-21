BEGIN;
CREATE ROLE suleia_ads_executor NOLOGIN;
GRANT USAGE ON SCHEMA economics,read_models TO suleia_ads_executor;
CREATE TABLE economics.ads_insights (
 account_id text NOT NULL,level text NOT NULL CHECK(level IN ('campaign','adset','ad')),
 entity_id text NOT NULL,since date NOT NULL,until date NOT NULL CHECK(until>=since),contract text NOT NULL,
 body jsonb NOT NULL,source_observed_at timestamptz NOT NULL,ingested_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,level,entity_id,since,until,contract)
);
CREATE TABLE economics.ads_proposals (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{16}$'),request_key text NOT NULL UNIQUE,body jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','RUNNING','EXPIRED','CANCELLED','STALE_POLICY_OR_MODE','SIMULATED','COMPLETED','REVIEW_REQUIRED')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL
);
CREATE TABLE economics.ads_operations (
 proposal_id text NOT NULL REFERENCES economics.ads_proposals(id),campaign_id text NOT NULL,account_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('EXECUTING','UNKNOWN','FAILED','VERIFIED','RECONCILED','BLOCKED','STALE','SIMULATED')),
 body jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(proposal_id,campaign_id)
);
CREATE UNIQUE INDEX ads_one_unresolved_campaign ON economics.ads_operations(account_id,campaign_id) WHERE state IN ('EXECUTING','UNKNOWN');
CREATE TABLE economics.ads_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,proposal_id text NOT NULL REFERENCES economics.ads_proposals(id),
 campaign_id text NOT NULL,body jsonb NOT NULL,at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE economics.ads_circuit(account_id text PRIMARY KEY,open_until timestamptz NOT NULL);
CREATE TABLE economics.ads_day_coverage (
 account_id text NOT NULL,level text NOT NULL CHECK(level IN ('campaign','adset','ad')),business_date date NOT NULL,contract text NOT NULL,
 entity_ids jsonb NOT NULL CHECK(jsonb_typeof(entity_ids)='array'),source_observed_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,level,business_date,contract)
);
CREATE VIEW read_models.ads_spend_daily AS
 SELECT c.account_id,c.business_date,c.contract,
 CASE WHEN count(f.entity_id)=jsonb_array_length(c.entity_ids) AND count(f.body->>'spend')=count(f.entity_id)
 THEN sum((f.body->>'spend')::numeric) ELSE NULL END AS spend,
 CASE WHEN jsonb_array_length(c.entity_ids)=0 THEN 'NO_ROWS'
 WHEN count(f.entity_id)<>jsonb_array_length(c.entity_ids) OR count(f.body->>'spend')<>count(f.entity_id) THEN 'INCOMPLETE' ELSE 'COMPLETE' END AS coverage_status,
 c.source_observed_at
 FROM economics.ads_day_coverage c LEFT JOIN economics.ads_insights f
 ON f.account_id=c.account_id AND f.level=c.level AND f.since=c.business_date AND f.until=c.business_date AND f.contract=c.contract
 AND c.entity_ids ? f.entity_id AND f.source_observed_at=c.source_observed_at
 WHERE c.level='campaign' GROUP BY c.account_id,c.business_date,c.contract,c.entity_ids,c.source_observed_at;
-- Existing operational credentials retain their existing ownership boundary.
-- No public/anonymous grants and no changes to logistics roles or tables.
GRANT SELECT ON economics.ads_insights,economics.ads_proposals,economics.ads_operations,economics.ads_events,economics.ads_circuit,read_models.ads_spend_daily TO suleia_operations_readonly,suleia_backup;
GRANT SELECT ON economics.ads_day_coverage TO suleia_operations_readonly,suleia_backup;
GRANT SELECT,INSERT,UPDATE ON economics.ads_insights,economics.ads_proposals,economics.ads_operations,economics.ads_circuit TO suleia_ads_executor;
GRANT SELECT,INSERT ON economics.ads_events TO suleia_ads_executor;
GRANT USAGE,SELECT ON SEQUENCE economics.ads_events_id_seq TO suleia_ads_executor;
GRANT SELECT,INSERT,UPDATE ON economics.ads_insights TO suleia_ingestion;
GRANT SELECT,INSERT,UPDATE ON economics.ads_day_coverage TO suleia_ads_executor,suleia_ingestion;
COMMIT;

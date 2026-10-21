BEGIN;
CREATE SCHEMA IF NOT EXISTS platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
CREATE TABLE IF NOT EXISTS platform.runtime_registry (
 runtime_id text PRIMARY KEY,name text NOT NULL,platform text NOT NULL,owner text,
 capabilities jsonb NOT NULL DEFAULT '[]',mode text NOT NULL DEFAULT 'UNVERIFIED',
 commit text,image text,digest text,health text NOT NULL DEFAULT 'UNKNOWN',
 last_cycle timestamptz,last_write timestamptz,last_verified_action timestamptz,
 breaker_state text,enabled boolean,environment text,release_id text,
 observed_at timestamptz NOT NULL DEFAULT now(),evidence_reference text
);
CREATE TABLE IF NOT EXISTS operations.action_ownership (
 workflow text NOT NULL,action_type text NOT NULL,owner_runtime text NOT NULL,
 fallback_owner text,mode text NOT NULL,enabled boolean NOT NULL DEFAULT false,
 policy_version text,verified_at timestamptz,evidence_reference text,
 PRIMARY KEY(workflow,action_type,owner_runtime),
 CHECK(NOT enabled OR verified_at IS NOT NULL),
 CHECK(fallback_owner IS DISTINCT FROM owner_runtime)
);
CREATE UNIQUE INDEX IF NOT EXISTS single_active_action_owner
 ON operations.action_ownership(workflow,action_type) WHERE enabled;
CREATE TABLE IF NOT EXISTS operations.timer_ownership (
 timer_type text NOT NULL,workflow text NOT NULL,owner text NOT NULL,storage text NOT NULL,
 scheduler text NOT NULL,anchor text NOT NULL,expiry_action text NOT NULL,policy_version text NOT NULL,
 verified_at timestamptz,evidence_reference text,PRIMARY KEY(timer_type,workflow)
);
CREATE TABLE IF NOT EXISTS platform.release_manifest (
 release_id text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL,manifest jsonb NOT NULL,evidence_reference text
);
CREATE TABLE IF NOT EXISTS platform.release_compatibility (
 release_id text NOT NULL REFERENCES platform.release_manifest,service text NOT NULL,
 source_commit text,image_commit text,schema_version text,event_contract_version text,
 policy_contract_version text,compatible boolean,evidence_reference text,
 PRIMARY KEY(release_id,service)
);
CREATE TABLE IF NOT EXISTS platform.test_runs (
 run_id text PRIMARY KEY,release_id text,suite_name text NOT NULL,environment text NOT NULL,
 commit text,total integer NOT NULL,passed integer NOT NULL,failed integer NOT NULL,
 skipped integer NOT NULL,started_at timestamptz NOT NULL,completed_at timestamptz NOT NULL,
 artifact_reference text NOT NULL,CHECK(total=passed+failed+skipped),CHECK(completed_at>=started_at)
);
CREATE TABLE IF NOT EXISTS platform.backup_status (
 backup_id text PRIMARY KEY,last_backup timestamptz,backup_type text,backup_size bigint,
 checksum text,status text NOT NULL,last_restore_test timestamptz,restore_status text,
 rpo_seconds bigint,rto_seconds bigint,evidence_reference text,
 CHECK(status<>'HEALTHY' OR (last_backup IS NOT NULL AND checksum IS NOT NULL
 AND last_restore_test IS NOT NULL AND restore_status='PASS'))
);
CREATE TABLE IF NOT EXISTS platform.database_size_samples (
 measured_at timestamptz PRIMARY KEY DEFAULT now(),database_size bigint NOT NULL,
 relation_sizes jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS platform.operational_findings (
 stable_key text PRIMARY KEY,finding_type text NOT NULL,resource text NOT NULL,
 evidence_fingerprint text NOT NULL,severity text NOT NULL,
 status text NOT NULL CHECK(status IN('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','SUPERSEDED')),
 first_seen timestamptz NOT NULL,last_seen timestamptz NOT NULL,resolved_at timestamptz,
 evidence_reference text,UNIQUE(finding_type,resource,evidence_fingerprint)
);
CREATE OR REPLACE VIEW read_models.unknown_mapping_backlog AS
 SELECT carrier,market,initial_carrier_code AS code,initial_carrier_substatus_code AS substatus,raw_type,
 CASE WHEN upper(initial_carrier_description_sanitized) LIKE '%AUSEN%' THEN 'AUSEN*'
 WHEN upper(initial_carrier_description_sanitized) LIKE '%NO ACEPT%' THEN 'NO ACEPT*'
 WHEN upper(initial_carrier_description_sanitized) LIKE '%RECHAZ%' THEN 'RECHAZ*'
 WHEN upper(initial_carrier_description_sanitized) LIKE '%DIRECCI%' THEN 'DIRECCI*'
 WHEN upper(initial_carrier_description_sanitized) LIKE '%DATOS%' THEN '*DATOS*'
 WHEN upper(initial_carrier_description_sanitized) LIKE '%RECOG%' THEN '*RECOG*'
 ELSE 'OTHER_REQUIRES_PRIVATE_EVIDENCE' END AS description_pattern,
 count(*) FILTER(WHERE created_at>=now()-interval '7 days') AS count_7d,
 count(*) FILTER(WHERE created_at>=now()-interval '30 days') AS count_30d,
 count(*) FILTER(WHERE is_active) AS active_count,
 min(created_at) AS first_seen,max(observed_at) AS last_seen,mapping_status AS current_mapping_status
 FROM read_models.operations_incident_records
 WHERE type='UNKNOWN' OR mapping_status IS DISTINCT FROM 'MAPPED'
 GROUP BY 1,2,3,4,5,6,12;
CREATE OR REPLACE VIEW read_models.stabilization_data_quality AS
 SELECT now() measured_at,count(*) total_incidents,count(*) FILTER(WHERE is_active) active_incidents,
 count(*) FILTER(WHERE is_active AND type='UNKNOWN') unknown_active,
 round(100.0*count(*) FILTER(WHERE is_active AND type='UNKNOWN')/nullif(count(*) FILTER(WHERE is_active),0),2) unknown_active_rate,
 round(100.0*count(*) FILTER(WHERE is_active AND mapping_status='MAPPED')/nullif(count(*) FILTER(WHERE is_active),0),2) mapped_active_incident_rate
 FROM read_models.operations_incident_records;
REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC;
REVOKE ALL ON operations.action_ownership,operations.timer_ownership FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA platform TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
GRANT SELECT ON operations.action_ownership,operations.timer_ownership,
 read_models.unknown_mapping_backlog,read_models.stabilization_data_quality
 TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
COMMIT;

BEGIN;
-- Governed compound evidence, not a global interpretation of GLS -30.
CREATE OR REPLACE VIEW read_models.recipient_absent_carrier_code_registry AS
SELECT i.canonical_issue_id,i.carrier,i.market,i.initial_carrier_code AS code,
 i.initial_carrier_substatus_code AS substatus,'SECOND_ABSENCE'::text AS normalized_type,
 'VERIFIED'::text AS mapping_status,'DROPEA_GLS_ES_SUBSTATUS_15_CORROBORATED'::text AS evidence_source,
 v.checksum AS policy_snapshot_hash,i.last_seen_at
FROM integration.dropea_issues i
JOIN configuration.policy_versions v ON v.policy_name='RECIPIENT_ABSENT_POLICY_V1' AND v.version='RECIPIENT_ABSENT_POLICY_V1'
WHERE i.carrier='GLS' AND i.market='ES' AND i.canonical_type='RECIPIENT_ABSENT'
 AND i.initial_carrier_substatus_code='15'
 AND (v.policy_document->'carrier_mapping'->'GLS_ES_SUBSTATUS_15'->'requires_code') ? i.initial_carrier_code
 AND position(v.policy_document->'carrier_mapping'->'GLS_ES_SUBSTATUS_15'->>'requires_description' IN upper(i.initial_carrier_description_sanitized))>0;
REVOKE ALL ON read_models.recipient_absent_carrier_code_registry FROM PUBLIC;
GRANT SELECT ON read_models.recipient_absent_carrier_code_registry TO suleia_ingestion,suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
-- Preserve existing aggregate unknown findings for every other workflow/code.
-- Only the proven compound cohort is subtracted from the unknown evidence.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_viewdef('read_models.reconciliation_findings'::regclass,true) INTO definition;
 IF position('recipient_absent_carrier_code_registry' IN definition)=0 THEN
  definition:=replace(definition,'FROM integration.carrier_issue_code_registry r',
   'FROM integration.carrier_issue_code_registry r');
  -- PostgreSQL prints this predicate as an ALL array expression. Alter only
  -- the UNKNOWN_GLS_CODE branch, with an exact anchor and fail-closed guard.
  IF position('WHERE r.mapping_status' IN definition)=0 THEN RAISE EXCEPTION 'UNKNOWN_FINDING_VIEW_CONTRACT_CHANGED'; END IF;
  definition:=replace(definition,'WHERE r.mapping_status',
   'WHERE (NOT (r.carrier=''GLS'' AND r.market=''ES'' AND r.code IN(''-30'',''14'')) OR EXISTS(SELECT 1 FROM integration.dropea_issues ci WHERE ci.carrier=r.carrier AND ci.market=r.market AND ci.initial_carrier_code=r.code AND NOT EXISTS(SELECT 1 FROM read_models.recipient_absent_carrier_code_registry governed WHERE governed.canonical_issue_id=ci.canonical_issue_id))) AND r.mapping_status');
  EXECUTE 'CREATE OR REPLACE VIEW read_models.reconciliation_findings AS '||definition;
 END IF;
END $migration$;
COMMIT;

BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='suleia_absent_controller') THEN
  CREATE ROLE suleia_absent_controller NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
END $$;
GRANT USAGE ON SCHEMA operations,read_models,integration TO suleia_absent_controller;
GRANT SELECT ON read_models.operations_incident_records,read_models.operations_order_records,
 read_models.recipient_absent_current_context TO suleia_absent_controller;
GRANT SELECT(canonical_order_id,external_order_id_hash,dropea_order_id,created_at_utc)
 ON integration.dropea_orders TO suleia_absent_controller;
GRANT SELECT(canonical_order_id,canonical_issue_id,created_at_utc,updated_at_utc,canonical_type,raw_type,status,is_active)
 ON integration.dropea_issues TO suleia_absent_controller;
GRANT SELECT ON operations.recipient_absent_native_control,operations.recipient_absent_resolution_control,
 operations.recipient_absent_native_notifications,operations.recipient_absent_native_timers,
 operations.recipient_absent_resolutions TO suleia_absent_controller;
GRANT UPDATE(canary_issue_id,circuit_breaker_reason,circuit_breaker_at)
 ON operations.recipient_absent_native_control,operations.recipient_absent_resolution_control TO suleia_absent_controller;
GRANT INSERT,UPDATE ON operations.recipient_absent_native_notifications,operations.recipient_absent_resolutions TO suleia_absent_controller;
GRANT INSERT ON operations.recipient_absent_native_timers TO suleia_absent_controller;
-- A runtime can stop itself, never enable flags or manufacture gate evidence.
CREATE OR REPLACE FUNCTION operations.absent_native_breaker_stop() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.circuit_breaker_reason IS NOT NULL THEN
  NEW.automation_live=false;
  NEW.native_send_enabled=false;
  NEW.template_sends_enabled=false;
 END IF;
 IF OLD.circuit_breaker_reason IS NOT NULL AND NEW.circuit_breaker_reason IS NULL
   AND NOT pg_has_role(current_user,'suleia_admin','MEMBER') THEN
  RAISE EXCEPTION 'ABSENT_BREAKER_REQUIRES_OPERATOR';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations.absent_native_breaker_stop() FROM PUBLIC;
DROP TRIGGER IF EXISTS absent_native_breaker_stop ON operations.recipient_absent_native_control;
CREATE TRIGGER absent_native_breaker_stop BEFORE UPDATE ON operations.recipient_absent_native_control
 FOR EACH ROW EXECUTE FUNCTION operations.absent_native_breaker_stop();
COMMIT;

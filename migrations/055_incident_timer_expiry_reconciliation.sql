BEGIN;
SET LOCAL lock_timeout='3s';
-- These are projection timers (both write counters constrained to zero).
-- Expiry does not execute or authorize any provider operation.
CREATE TABLE IF NOT EXISTS platform.timer_expiry_reconciliation (
 timer_id text PRIMARY KEY,
 previous_status text NOT NULL,
 due_at timestamptz NOT NULL,
 reconciled_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform.timer_expiry_reconciliation FROM PUBLIC;
GRANT SELECT ON platform.timer_expiry_reconciliation TO suleia_operations_readonly,suleia_mcp_readonly,suleia_backup;
GRANT SELECT,INSERT ON platform.timer_expiry_reconciliation TO suleia_ingestion;
CREATE OR REPLACE FUNCTION operations.normalize_projection_timer_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='ACTIVE' AND NEW.due_at<=statement_timestamp() THEN
  INSERT INTO platform.timer_expiry_reconciliation(timer_id,previous_status,due_at)
   VALUES(NEW.timer_id,NEW.status,NEW.due_at) ON CONFLICT(timer_id) DO NOTHING;
  NEW.status:='EXPIRED';
  NEW.updated_at:=statement_timestamp();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations.normalize_projection_timer_expiry() FROM PUBLIC;
DROP TRIGGER IF EXISTS normalize_projection_timer_expiry ON operations.incident_timers;
CREATE TRIGGER normalize_projection_timer_expiry
 BEFORE INSERT OR UPDATE ON operations.incident_timers
 FOR EACH ROW EXECUTE FUNCTION operations.normalize_projection_timer_expiry();
-- Touch only overdue ACTIVE rows; the trigger records their transition.
UPDATE operations.incident_timers SET updated_at=statement_timestamp()
 WHERE status='ACTIVE' AND due_at<=statement_timestamp();
COMMIT;

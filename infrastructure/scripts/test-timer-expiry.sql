CREATE SCHEMA operations;
CREATE SCHEMA platform;
CREATE ROLE suleia_operations_readonly;
CREATE ROLE suleia_mcp_readonly;
CREATE ROLE suleia_backup;
CREATE ROLE suleia_ingestion;
CREATE TABLE operations.incident_timers(
 timer_id text PRIMARY KEY,status text NOT NULL,due_at timestamptz NOT NULL,updated_at timestamptz DEFAULT now()
);
INSERT INTO operations.incident_timers VALUES
 ('past-active','ACTIVE',now()-interval '1 day',now()),
 ('future-active','ACTIVE',now()+interval '1 day',now()),
 ('superseded','SUPERSEDED',now()-interval '1 day',now()),
 ('cancelled','CANCELLED',now()-interval '1 day',now());
\i /test/migrations/055_incident_timer_expiry_reconciliation.sql
DO $$ BEGIN
 IF (SELECT status FROM operations.incident_timers WHERE timer_id='past-active')<>'EXPIRED' THEN RAISE EXCEPTION 'past timer not expired';END IF;
 IF (SELECT count(*) FROM operations.incident_timers WHERE status='ACTIVE')<>1 THEN RAISE EXCEPTION 'future status altered';END IF;
 IF (SELECT count(*) FROM platform.timer_expiry_reconciliation)<>1 THEN RAISE EXCEPTION 'audit mismatch';END IF;
END $$;
GRANT USAGE ON SCHEMA operations TO suleia_ingestion;
GRANT SELECT,INSERT,UPDATE ON operations.incident_timers TO suleia_ingestion;
SET ROLE suleia_ingestion;
INSERT INTO operations.incident_timers(timer_id,status,due_at) VALUES('late-insert','ACTIVE',now()-interval '1 hour');
UPDATE operations.incident_timers SET status='ACTIVE' WHERE timer_id='past-active';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM operations.incident_timers WHERE status='ACTIVE' AND due_at<=now())<>0 THEN RAISE EXCEPTION 'expired timer revived';END IF;
 IF (SELECT count(*) FROM platform.timer_expiry_reconciliation)<>2 THEN RAISE EXCEPTION 'audit not idempotent';END IF;
 IF (SELECT status FROM operations.incident_timers WHERE timer_id='superseded')<>'SUPERSEDED' THEN RAISE EXCEPTION 'terminal status altered';END IF;
END $$;
\i /test/migrations/rollback/055_incident_timer_expiry_reconciliation.down.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM platform.timer_expiry_reconciliation)<>2 THEN RAISE EXCEPTION 'rollback deleted history';END IF;
END $$;
SELECT 'TIMER_EXPIRY_TESTS_PASS';

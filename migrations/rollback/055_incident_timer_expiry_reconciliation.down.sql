BEGIN;
SET LOCAL lock_timeout='3s';
DROP TRIGGER IF EXISTS normalize_projection_timer_expiry ON operations.incident_timers;
DROP FUNCTION IF EXISTS operations.normalize_projection_timer_expiry();
-- Preserve accurate historical expiry and its audit evidence on rollback.
-- Roll back the projection worker first; no timer is reactivated blindly.
COMMIT;

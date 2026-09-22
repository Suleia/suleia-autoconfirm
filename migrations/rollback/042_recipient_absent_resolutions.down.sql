-- Operational rollback preserves all action evidence and claims.
BEGIN;
UPDATE operations.recipient_absent_resolution_control SET status='DISABLED',updated_at=now()
WHERE workflow='RECIPIENT_ABSENT';
COMMIT;

BEGIN;
-- Disable the scheduler and revert application code first. Retain audit rows.
REVOKE INSERT,UPDATE ON economics.ads_autopilot_slots FROM suleia_ads_executor;
COMMIT;

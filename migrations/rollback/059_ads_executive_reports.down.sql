BEGIN;
-- Export report/delivery audit before rollback. Never drop the budget ledger.
DROP TABLE economics.ads_executive_deliveries;
DROP TABLE economics.ads_executive_reports;
COMMIT;

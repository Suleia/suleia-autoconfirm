BEGIN;
CREATE TABLE economics.ads_executive_reports (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 account_id text NOT NULL CHECK(account_id ~ '^[0-9]+$'),
 local_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('DAILY','MANUAL')),
 state text NOT NULL CHECK(state IN ('PREPARING','READY','FAILED','MISSED')),
 lease text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 1,
 body jsonb, error_code text, principal text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ads_executive_daily_once ON economics.ads_executive_reports(account_id,local_date) WHERE kind='DAILY';
CREATE INDEX ads_executive_history ON economics.ads_executive_reports(account_id,created_at DESC,id DESC);
CREATE TABLE economics.ads_executive_deliveries (
 report_id text NOT NULL REFERENCES economics.ads_executive_reports(id),
 recipient text NOT NULL CHECK(recipient ~ '^[1-9][0-9]*$'),part integer NOT NULL CHECK(part BETWEEN 0 AND 3),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('SENDING','SENT','UNKNOWN','RETRY','REJECTED')),
 claim_id text NOT NULL, attempts integer NOT NULL DEFAULT 1,
 message_id bigint, retry_at timestamptz,code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(report_id,recipient,part)
);
GRANT SELECT,INSERT,UPDATE ON economics.ads_executive_reports,economics.ads_executive_deliveries TO suleia_ads_executor;
GRANT SELECT ON economics.ads_executive_reports,economics.ads_executive_deliveries TO suleia_operations_readonly,suleia_backup;
COMMENT ON TABLE economics.ads_executive_reports IS 'V8 read-only advertising analysis. Date/account idempotency, expiring generation lease. No Meta write authority.';
COMMENT ON TABLE economics.ads_executive_deliveries IS 'Existing Telegram consumer only. SENDING survives crashes as uncertain, never automatically replayed. Numeric private recipients only.';
COMMIT;

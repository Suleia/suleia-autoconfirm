BEGIN;
CREATE TABLE economics.telegram_order_alert_settings (
 recipient text PRIMARY KEY CHECK(recipient ~ '^[1-9][0-9]*$'),
 enabled boolean NOT NULL DEFAULT false, enabled_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE economics.telegram_order_alert_deliveries (
 id text NOT NULL UNIQUE CHECK(id ~ '^[a-f0-9]{64}$'),
 recipient text NOT NULL REFERENCES economics.telegram_order_alert_settings(recipient),
 market text NOT NULL,store_id text NOT NULL,dropea_order_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('SENDING','SENT','UNKNOWN','RETRY','REJECTED')),
 claim_id uuid NOT NULL,attempts integer NOT NULL DEFAULT 1,
 message_id bigint,retry_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(recipient,market,store_id,dropea_order_id)
);
GRANT SELECT,INSERT,UPDATE ON economics.telegram_order_alert_settings,economics.telegram_order_alert_deliveries TO suleia_ads_executor;
GRANT SELECT ON economics.telegram_order_alert_settings,economics.telegram_order_alert_deliveries TO suleia_operations_readonly,suleia_backup;
COMMENT ON TABLE economics.telegram_order_alert_deliveries IS 'Existing Telegram poller only. Persist claim before send; uncertain sends never automatically replay. No customer/provider writes. Preserve receipts on rollback.';
COMMIT;

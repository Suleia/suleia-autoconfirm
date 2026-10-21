BEGIN;
CREATE TABLE economics.ads_recommendations (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{24}$'),body jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('DRAFT','APPROVED_FOR_REVIEW','DISMISSED')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE economics.ads_alert_digests (
 key text PRIMARY KEY,body jsonb NOT NULL,state text NOT NULL DEFAULT 'CLAIMED' CHECK(state IN ('CLAIMED','SENT','UNKNOWN')),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON economics.ads_recommendations,economics.ads_alert_digests TO suleia_operations_readonly,suleia_backup;
GRANT SELECT,INSERT,UPDATE ON economics.ads_recommendations,economics.ads_alert_digests TO suleia_ads_executor;
-- Capability on NEW Ads tables only, reusing the existing API login/pool.
-- Does not grant the executor role (or access to unrelated tables) to readers.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='suleia_api_login') THEN
   GRANT suleia_ads_executor TO suleia_api_login;
 END IF;
END $$;
COMMIT;

-- Explicit rollback. Never invoked by the application or deployment scripts.
\set ON_ERROR_STOP on

BEGIN;
REVOKE suleia_shadow_reader FROM authenticator;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_state', 'orders', 'operational_orders', 'incidents',
    'incident_carrier_history', 'agent_feedback', 'agent_memory_events',
    'telegram_messages', 'webhook_events', 'template_delivery_ledger',
    'meta_campaign_insights'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS suleia_shadow_reader_select ON public.%I', table_name);
  END LOOP;
END
$$;

REVOKE ALL ON SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM suleia_shadow_reader;
DROP ROLE suleia_shadow_reader;
COMMIT;

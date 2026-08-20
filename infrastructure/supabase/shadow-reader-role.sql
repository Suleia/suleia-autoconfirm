-- DESIGN ARTIFACT ONLY. Do not run automatically or from a deploy hook.
-- Apply only after explicit Supabase change approval, backup and rollback drill.
-- This role grant alone is NOT proof of read-only: privileges inherited from
-- PUBLIC (especially function EXECUTE) must also pass verify-shadow-reader-role.sql.
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suleia_shadow_reader') THEN
    CREATE ROLE suleia_shadow_reader
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE suleia_shadow_reader
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM suleia_shadow_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM suleia_shadow_reader;

GRANT USAGE ON SCHEMA public TO suleia_shadow_reader;
GRANT SELECT ON TABLE
  public.app_state,
  public.orders,
  public.operational_orders,
  public.incidents,
  public.incident_carrier_history,
  public.agent_feedback,
  public.agent_memory_events,
  public.telegram_messages,
  public.webhook_events,
  public.template_delivery_ledger,
  public.meta_campaign_insights
TO suleia_shadow_reader;

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
    EXECUTE format(
      'CREATE POLICY suleia_shadow_reader_select ON public.%I FOR SELECT TO suleia_shadow_reader USING (true)',
      table_name
    );
  END LOOP;
END
$$;

-- PostgREST changes into the JWT role only when authenticator is a member.
GRANT suleia_shadow_reader TO authenticator;

COMMIT;

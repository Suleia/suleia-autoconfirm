-- Read-only metadata verification. Returns privilege/policy facts, never row data.
\set ON_ERROR_STOP on

WITH allowlist(table_name) AS (
  VALUES
    ('app_state'), ('orders'), ('operational_orders'), ('incidents'),
    ('incident_carrier_history'), ('agent_feedback'), ('agent_memory_events'),
    ('telegram_messages'), ('webhook_events'), ('template_delivery_ledger'),
    ('meta_campaign_insights')
)
SELECT
  table_name,
  has_table_privilege('suleia_shadow_reader', format('public.%I', table_name), 'SELECT') AS can_select,
  has_table_privilege('suleia_shadow_reader', format('public.%I', table_name), 'INSERT') AS can_insert,
  has_table_privilege('suleia_shadow_reader', format('public.%I', table_name), 'UPDATE') AS can_update,
  has_table_privilege('suleia_shadow_reader', format('public.%I', table_name), 'DELETE') AS can_delete,
  has_table_privilege('suleia_shadow_reader', format('public.%I', table_name), 'TRUNCATE') AS can_truncate
FROM allowlist
ORDER BY table_name;

SELECT schemaname, tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND policyname = 'suleia_shadow_reader_select'
ORDER BY tablename;

SELECT rolname, rolsuper, rolinherit, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname = 'suleia_shadow_reader';

SELECT pg_has_role('authenticator', 'suleia_shadow_reader', 'MEMBER') AS authenticator_is_member;

-- Any true mutator or any access outside the allowlist is a hard failure.
WITH allowlist(table_name) AS (
  VALUES
    ('app_state'), ('orders'), ('operational_orders'), ('incidents'),
    ('incident_carrier_history'), ('agent_feedback'), ('agent_memory_events'),
    ('telegram_messages'), ('webhook_events'), ('template_delivery_ledger'),
    ('meta_campaign_insights')
)
SELECT
  c.relname AS object_name,
  c.relkind,
  a.table_name IS NOT NULL AS allowlisted,
  has_table_privilege('suleia_shadow_reader', c.oid, 'SELECT') AS can_select,
  has_table_privilege('suleia_shadow_reader', c.oid, 'INSERT') AS can_insert,
  has_table_privilege('suleia_shadow_reader', c.oid, 'UPDATE') AS can_update,
  has_table_privilege('suleia_shadow_reader', c.oid, 'DELETE') AS can_delete,
  has_table_privilege('suleia_shadow_reader', c.oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege('suleia_shadow_reader', c.oid, 'TRIGGER') AS can_trigger
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN allowlist a ON a.table_name = c.relname
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relname;

-- PostgreSQL grants EXECUTE to PUBLIC on functions by default. Every true row
-- must be reviewed and reduced or isolated behind a GET-only proxy/replica.
SELECT
  p.oid::regprocedure::text AS function_identity,
  has_function_privilege('suleia_shadow_reader', p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY function_identity;

SELECT
  has_schema_privilege('suleia_shadow_reader', 'public', 'USAGE') AS can_use_schema,
  has_schema_privilege('suleia_shadow_reader', 'public', 'CREATE') AS can_create_in_schema;

SELECT inherited.rolname AS inherited_role
FROM pg_auth_members membership
JOIN pg_roles member ON member.oid = membership.member
JOIN pg_roles inherited ON inherited.oid = membership.roleid
WHERE member.rolname = 'suleia_shadow_reader'
ORDER BY inherited.rolname;

SELECT
  c.relname AS sequence_name,
  has_sequence_privilege('suleia_shadow_reader', c.oid, 'SELECT') AS can_select,
  has_sequence_privilege('suleia_shadow_reader', c.oid, 'USAGE') AS can_use,
  has_sequence_privilege('suleia_shadow_reader', c.oid, 'UPDATE') AS can_update
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname;

-- Convert the inventory into an executable fail-closed gate. The expected
-- result is no exception; any inherited or PUBLIC capability aborts psql.
DO $$
DECLARE
  violations text;
  invalid_policies integer;
  reader_role record;
BEGIN
  SELECT rolname, rolsuper, rolinherit, rolcreatedb, rolcreaterole,
         rolcanlogin, rolreplication, rolbypassrls
  INTO reader_role
  FROM pg_roles
  WHERE rolname = 'suleia_shadow_reader';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shadow reader role is missing';
  END IF;
  IF reader_role.rolsuper OR reader_role.rolinherit OR reader_role.rolcreatedb
     OR reader_role.rolcreaterole OR reader_role.rolcanlogin
     OR reader_role.rolreplication OR reader_role.rolbypassrls THEN
    RAISE EXCEPTION 'shadow reader role-attribute gate failed';
  END IF;
  IF NOT pg_has_role('authenticator', 'suleia_shadow_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'shadow reader authenticator membership gate failed';
  END IF;
  IF NOT has_schema_privilege('suleia_shadow_reader', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'shadow reader schema USAGE capability gate failed';
  END IF;

  WITH allowlist(table_name) AS (
    VALUES
      ('app_state'), ('orders'), ('operational_orders'), ('incidents'),
      ('incident_carrier_history'), ('agent_feedback'), ('agent_memory_events'),
      ('telegram_messages'), ('webhook_events'), ('template_delivery_ledger'),
      ('meta_campaign_insights')
  )
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO violations
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN allowlist a ON a.table_name = c.relname
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      (a.table_name IS NOT NULL AND NOT has_table_privilege('suleia_shadow_reader', c.oid, 'SELECT'))
      OR (a.table_name IS NULL AND has_table_privilege('suleia_shadow_reader', c.oid, 'SELECT'))
      OR has_table_privilege('suleia_shadow_reader', c.oid, 'INSERT')
      OR has_table_privilege('suleia_shadow_reader', c.oid, 'UPDATE')
      OR has_table_privilege('suleia_shadow_reader', c.oid, 'DELETE')
      OR has_table_privilege('suleia_shadow_reader', c.oid, 'TRUNCATE')
      OR has_table_privilege('suleia_shadow_reader', c.oid, 'TRIGGER')
      OR (a.table_name IS NOT NULL AND NOT c.relrowsecurity)
    );
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'shadow reader table/RLS capability gate failed: %', violations;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO violations
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('suleia_shadow_reader', p.oid, 'EXECUTE');
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'shadow reader function/RPC capability gate failed: %', violations;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO violations
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND (
      has_sequence_privilege('suleia_shadow_reader', c.oid, 'SELECT')
      OR has_sequence_privilege('suleia_shadow_reader', c.oid, 'USAGE')
      OR has_sequence_privilege('suleia_shadow_reader', c.oid, 'UPDATE')
    );
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'shadow reader sequence capability gate failed: %', violations;
  END IF;

  IF has_schema_privilege('suleia_shadow_reader', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'shadow reader schema CREATE capability gate failed';
  END IF;

  SELECT string_agg(inherited.rolname, ', ' ORDER BY inherited.rolname)
  INTO violations
  FROM pg_auth_members membership
  JOIN pg_roles member ON member.oid = membership.member
  JOIN pg_roles inherited ON inherited.oid = membership.roleid
  WHERE member.rolname = 'suleia_shadow_reader';
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'shadow reader inherited-role capability gate failed: %', violations;
  END IF;

  WITH allowlist(table_name) AS (
    VALUES
      ('app_state'), ('orders'), ('operational_orders'), ('incidents'),
      ('incident_carrier_history'), ('agent_feedback'), ('agent_memory_events'),
      ('telegram_messages'), ('webhook_events'), ('template_delivery_ledger'),
      ('meta_campaign_insights')
  ), policy_tables(table_name) AS (
    SELECT p.tablename
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.policyname = 'suleia_shadow_reader_select'
  ), policy_set_differences AS (
    SELECT 'missing:' || table_name AS difference
    FROM (SELECT table_name FROM allowlist EXCEPT SELECT table_name FROM policy_tables) missing
    UNION ALL
    SELECT 'unexpected:' || table_name AS difference
    FROM (SELECT table_name FROM policy_tables EXCEPT SELECT table_name FROM allowlist) unexpected
  )
  SELECT string_agg(difference, ', ' ORDER BY difference)
  INTO violations
  FROM policy_set_differences;
  IF violations IS NOT NULL THEN
    RAISE EXCEPTION 'shadow reader RLS policy table-set gate failed: %', violations;
  END IF;

  SELECT count(*) FILTER (
    WHERE p.cmd <> 'SELECT'
      OR NOT ('suleia_shadow_reader' = ANY (p.roles))
      OR p.qual IS DISTINCT FROM 'true'
  ) + abs(count(*) - 11)
  INTO invalid_policies
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.policyname = 'suleia_shadow_reader_select';
  IF invalid_policies <> 0 THEN
    RAISE EXCEPTION 'shadow reader RLS policy gate failed';
  END IF;
END
$$;

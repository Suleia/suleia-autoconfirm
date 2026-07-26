-- Run only in the dedicated Supabase staging project after approval.
-- This script does not copy production data and does not grant write access.

create schema if not exists staging_private;
create schema if not exists mcp_read;

revoke all on schema staging_private from public, anon, authenticated;
revoke all on schema mcp_read from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_staging_reader') then
    create role mcp_staging_reader nologin noinherit;
  end if;
end
$$;

create table if not exists staging_private.masked_orders (
  order_id text primary key,
  store_id text not null,
  status text not null,
  product_family text,
  amount_bucket text,
  customer_ref text not null,
  customer_display text not null default 'Cliente enmascarado',
  phone_token text,
  email_token text,
  created_at timestamptz not null,
  source_updated_at timestamptz not null,
  requires_review boolean not null default false,
  review_reason text,
  mirror_batch_id text not null
);

create table if not exists staging_private.masked_order_timeline (
  event_id text primary key,
  order_id text not null references staging_private.masked_orders(order_id),
  event_type text not null,
  occurred_at timestamptz not null,
  summary text not null,
  mirror_batch_id text not null
);

create table if not exists staging_private.masked_active_timers (
  timer_id text primary key,
  order_id text not null references staging_private.masked_orders(order_id),
  timer_type text not null,
  started_at timestamptz not null,
  due_at timestamptz not null,
  status text not null,
  mirror_batch_id text not null
);

create table if not exists staging_private.masked_agent_decisions (
  decision_id text primary key,
  order_id text not null references staging_private.masked_orders(order_id),
  system text not null,
  decision text not null,
  confidence numeric,
  reason_codes jsonb not null default '[]'::jsonb,
  decided_at timestamptz not null,
  actions_executed integer not null default 0 check (actions_executed = 0),
  mirror_batch_id text not null
);

create table if not exists staging_private.mirror_status (
  singleton boolean primary key default true check (singleton),
  source_snapshot_at timestamptz,
  staging_loaded_at timestamptz,
  mirror_batch_id text,
  row_count integer not null default 0,
  pii_scan_passed boolean not null default false,
  production_write_path_detected boolean not null default false
);

create or replace view mcp_read.mcp_orders
with (security_barrier = true)
as
select
  order_id,
  store_id,
  status,
  product_family,
  amount_bucket,
  customer_ref,
  customer_display,
  phone_token,
  email_token,
  created_at,
  source_updated_at,
  requires_review,
  review_reason
from staging_private.masked_orders;

create or replace view mcp_read.mcp_order_timeline
with (security_barrier = true)
as
select event_id, order_id, event_type, occurred_at, summary
from staging_private.masked_order_timeline;

create or replace view mcp_read.mcp_active_timers
with (security_barrier = true)
as
select timer_id, order_id, timer_type, started_at, due_at, status
from staging_private.masked_active_timers;

create or replace view mcp_read.mcp_agent_decisions
with (security_barrier = true)
as
select decision_id, order_id, system, decision, confidence, reason_codes, decided_at, actions_executed
from staging_private.masked_agent_decisions;

create or replace view mcp_read.mcp_orders_requiring_review
with (security_barrier = true)
as
select *
from mcp_read.mcp_orders
where requires_review is true;

create or replace view mcp_read.mcp_data_freshness
with (security_barrier = true)
as
select
  source_snapshot_at as source_updated_at,
  staging_loaded_at,
  mirror_batch_id,
  row_count,
  pii_scan_passed,
  production_write_path_detected
from staging_private.mirror_status
where singleton is true;

revoke all on all tables in schema staging_private from public, anon, authenticated;
revoke all on all tables in schema mcp_read from public, anon, authenticated;
grant usage on schema mcp_read to mcp_staging_reader;
grant select on all tables in schema mcp_read to mcp_staging_reader;

-- Views are owned by the staging migration owner and expose only the masked
-- projection. The MCP role intentionally receives no USAGE or SELECT grant on
-- staging_private, so it cannot bypass the public read model.

alter default privileges in schema mcp_read
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema mcp_read
  grant select on tables to mcp_staging_reader;

-- The mirror writer is a separate future identity and is never used by MCP.
-- The MCP credential must carry role=mcp_staging_reader and is stored only in
-- Render staging. It receives no grants on staging_private or production.

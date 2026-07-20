create extension if not exists pgcrypto;

create table if not exists public.app_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  order_id text primary key,
  store_id text not null default 'suleia',
  status text,
  customer_name text,
  customer_phone text,
  customer_email text,
  order_amount numeric,
  currency_code text default 'EUR',
  product text,
  chatby_user_ns text,
  agent_intent text,
  agent_confidence numeric,
  confirmation_source text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at_source timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.operational_orders (
  order_id text primary key,
  customer_name text,
  customer_phone text,
  created_at_source timestamptz,
  dropea_status text,
  customer_confirmed boolean,
  customer_messages integer not null default 0,
  customer_action_label text,
  agent_action text,
  agent_intent text,
  agent_confidence numeric,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  incidence_id text primary key,
  order_id text not null,
  issue_type text,
  issue_code text,
  status text,
  order_status text,
  customer_name text,
  customer_phone text,
  created_at_source timestamptz,
  last_response_at timestamptz,
  customer_responded boolean,
  customer_messages integer not null default 0,
  context_summary text,
  proposed_solution text,
  operational_instruction text,
  confidence numeric,
  priority text,
  chatby_user_ns text,
  carrier_reason text,
  carrier_reason_code text,
  carrier_annotated_at timestamptz,
  carrier_observation text,
  carrier_last_updated_at timestamptz,
  carrier_incidence_id text,
  carrier_source text,
  raw jsonb,
  updated_at timestamptz not null default now()
);

alter table public.incidents add column if not exists carrier_reason text;
alter table public.incidents add column if not exists carrier_reason_code text;
alter table public.incidents add column if not exists carrier_annotated_at timestamptz;
alter table public.incidents add column if not exists carrier_observation text;
alter table public.incidents add column if not exists carrier_last_updated_at timestamptz;
alter table public.incidents add column if not exists carrier_incidence_id text;
alter table public.incidents add column if not exists carrier_source text;

create table if not exists public.incident_carrier_history (
  history_id text primary key,
  order_id text not null,
  incidence_id text,
  reason_code text,
  reason text,
  annotated_at timestamptz,
  observation text,
  resolved boolean,
  last_updated_at timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.agent_feedback (
  id text primary key,
  scope text not null,
  entity_id text,
  order_id text,
  incidence_id text,
  verdict text,
  correction text,
  note text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_memory_events (
  id text primary key,
  type text not null,
  source text,
  entity_id text,
  content text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_messages (
  id text primary key,
  chat_id text,
  username text,
  direction text,
  text text,
  reply text,
  authorized boolean,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id text primary key,
  source text,
  event_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.template_delivery_ledger (
  template_key text primary key,
  store_id text not null default 'suleia',
  order_id text not null,
  customer_phone text,
  template_name text not null,
  provider text,
  chatby_user_ns text,
  status text not null default 'claimed',
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_campaign_insights (
  meta_row_id text primary key,
  date_start date,
  date_stop date,
  campaign_id text,
  campaign_name text,
  adset_id text,
  ad_id text,
  spend numeric,
  impressions numeric,
  clicks numeric,
  purchases numeric,
  purchase_value numeric,
  roas numeric,
  cpa numeric,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at_source on public.orders (created_at_source desc);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_customer_phone on public.orders (customer_phone);
create index if not exists idx_operational_orders_created_at_source on public.operational_orders (created_at_source desc);
create index if not exists idx_incidents_order_id on public.incidents (order_id);
create index if not exists idx_incidents_created_at_source on public.incidents (created_at_source desc);
create index if not exists idx_incidents_customer_phone on public.incidents (customer_phone);
create index if not exists idx_incidents_carrier_annotated_at on public.incidents (carrier_annotated_at desc);
create index if not exists idx_incident_carrier_history_order on public.incident_carrier_history (order_id, annotated_at desc);
create index if not exists idx_agent_feedback_scope_entity on public.agent_feedback (scope, entity_id);
create index if not exists idx_telegram_messages_created_at on public.telegram_messages (created_at desc);
create index if not exists idx_meta_campaign_insights_date on public.meta_campaign_insights (date_start desc);
create index if not exists idx_meta_campaign_insights_campaign on public.meta_campaign_insights (campaign_id);
create index if not exists idx_template_delivery_order on public.template_delivery_ledger (order_id, template_name);
create index if not exists idx_template_delivery_phone on public.template_delivery_ledger (customer_phone);

alter table public.app_state enable row level security;
alter table public.orders enable row level security;
alter table public.operational_orders enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_carrier_history enable row level security;
alter table public.agent_feedback enable row level security;
alter table public.agent_memory_events enable row level security;
alter table public.telegram_messages enable row level security;
alter table public.webhook_events enable row level security;
alter table public.meta_campaign_insights enable row level security;
alter table public.template_delivery_ledger enable row level security;

-- The Render backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose the service role key in frontend code.

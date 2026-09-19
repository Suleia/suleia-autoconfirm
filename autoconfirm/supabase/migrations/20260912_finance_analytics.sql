-- Finance analytics is service-role only. It contains aggregated operational
-- identifiers and economic figures, never customer personal data.
create schema if not exists economics;

create table if not exists economics.finance_cost_rates (
  id uuid primary key default gen_random_uuid(),
  cost_type text not null check (cost_type in ('PRODUCT_COGS', 'OUTBOUND_SHIPPING', 'OUTBOUND_FULFILLMENT', 'COD', 'RETURN_LOGISTICS_COMBINED')),
  amount_cents bigint not null check (amount_cents >= 0),
  unit text not null check (unit in ('PER_DELIVERED_UNIT', 'PER_SENT_ORDER', 'PER_DELIVERED_ORDER', 'PER_RETURNED_ORDER')),
  currency char(3) not null default 'EUR' check (currency = 'EUR'),
  product_id bigint,
  variant_id bigint,
  skus text[] not null default '{}',
  source text not null,
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists finance_cost_rates_identity_idx
  on economics.finance_cost_rates (cost_type, coalesce(product_id, -1), coalesce(variant_id, -1), effective_from);

create table if not exists economics.finance_daily_metrics (
  day date primary key,
  report jsonb not null,
  source_version text not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists economics.finance_monthly_metrics (
  month date primary key check (extract(day from month) = 1),
  report jsonb not null,
  source_version text not null,
  generated_at timestamptz not null,
  status text not null check (status in ('provisional', 'reconstructed', 'closed_actual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists economics.finance_product_metrics (
  month date not null check (extract(day from month) = 1),
  product_id bigint not null,
  variant_id bigint not null,
  sku text not null,
  report jsonb not null,
  source_version text not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (month, product_id, variant_id, sku)
);

alter table economics.finance_cost_rates enable row level security;
alter table economics.finance_daily_metrics enable row level security;
alter table economics.finance_monthly_metrics enable row level security;
alter table economics.finance_product_metrics enable row level security;

create or replace view economics.finance_monthly_read_model as
select month, status, source_version, generated_at, report
from economics.finance_monthly_metrics;

create or replace view economics.finance_daily_read_model as
select day, source_version, generated_at, report
from economics.finance_daily_metrics;

insert into economics.finance_cost_rates (cost_type, amount_cents, unit, product_id, variant_id, skus, source, effective_from, notes)
values
  ('PRODUCT_COGS', 400, 'PER_DELIVERED_UNIT', 30133, 30133, array['038_CREMAHIDRATANTE','CREMAHIDRATANTE'], 'BUSINESS_VERIFIED_HISTORICAL_PRODUCT_RATE', date '2026-05-01', 'Crema Hidratante Definitiva HOYGI 100G'),
  ('PRODUCT_COGS', 101, 'PER_DELIVERED_UNIT', 31666, 31666, array['COLLAGUM','1969_COLLAGUM'], 'BUSINESS_VERIFIED_PRODUCT_RATE', date '2026-06-28', 'CollaGum'),
  ('PRODUCT_COGS', 144, 'PER_DELIVERED_UNIT', 31547, 31547, array['CREMANIDA','1969_CREMANIDA'], 'BUSINESS_VERIFIED_PRODUCT_RATE', date '2026-06-18', 'NIDA'),
  ('PRODUCT_COGS', 200, 'PER_DELIVERED_UNIT', 31839, 31839, array['WHITEO2','1989_WHITEO2'], 'JULY_CLOSED_ACTUAL_RECONCILIATION', date '2026-07-01', 'WhiteO2'),
  ('OUTBOUND_SHIPPING', 406, 'PER_SENT_ORDER', null, null, '{}', 'JULY_CLOSED_ACTUAL_RECONCILIATION', date '2026-05-01', 'Tarifa reconstruida del cierre validado'),
  ('OUTBOUND_FULFILLMENT', 120, 'PER_SENT_ORDER', null, null, '{}', 'JULY_CLOSED_ACTUAL_RECONCILIATION', date '2026-05-01', 'Tarifa reconstruida del cierre validado'),
  ('COD', 100, 'PER_DELIVERED_ORDER', null, null, '{}', 'JULY_CLOSED_ACTUAL_RECONCILIATION', date '2026-05-01', 'Solo para pedidos entregados y cobrados'),
  ('RETURN_LOGISTICS_COMBINED', 526, 'PER_RETURNED_ORDER', null, null, '{}', 'BUSINESS_VERIFIED_DROPEA_RATE', date '2026-05-01', 'Transporte y fulfillment de retorno combinados; no multiplicar por unidades')
on conflict do nothing;

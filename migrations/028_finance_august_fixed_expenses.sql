BEGIN;

-- Monthly expenses confirmed by the business owner on 2026-08-30. They are
-- recurring operating expenses, so August 2026 and later reports apply them
-- automatically. This migration writes only internal financial configuration.
WITH enabled_store AS (
  SELECT min(store_id) AS store_id
  FROM integration.dropea_store_config
  WHERE enabled=true
  HAVING count(*)=1
), desired(expense_id,label,category,amount,start_date) AS (
  VALUES
    ('a8260001-0000-4000-8000-000000000001'::uuid,'Plan PRO Chatgpt','SOFTWARE',103.00::numeric,DATE '2026-07-01'),
    ('a8260001-0000-4000-8000-000000000002'::uuid,'Servidor externo VPS','SERVICIOS',13.13::numeric,DATE '2026-07-01'),
    ('a8260001-0000-4000-8000-000000000003'::uuid,'Supabase','SOFTWARE',25.00::numeric,DATE '2026-07-01'),
    ('a8260001-0000-4000-8000-000000000004'::uuid,'COD release','SOFTWARE',9.99::numeric,DATE '2026-06-22'),
    ('a8260001-0000-4000-8000-000000000005'::uuid,'Chatby','SOFTWARE',25.27::numeric,DATE '2026-06-18')
)
INSERT INTO economics.finance_fixed_expenses
  (expense_id,store_id,label,category,expense_type,amount,currency,start_date,
   end_date,occurred_on,status,source,created_at,updated_at)
SELECT d.expense_id,s.store_id,d.label,d.category,'RECURRING',d.amount,'EUR',
  d.start_date,NULL,NULL,'ACTIVE','USER_CONFIRMED_FIXED_EXPENSES_2026_08_30',now(),now()
FROM enabled_store s CROSS JOIN desired d
WHERE NOT EXISTS (
  SELECT 1 FROM economics.finance_fixed_expenses e
  WHERE e.store_id=s.store_id AND lower(e.label)=lower(d.label)
);

INSERT INTO economics.finance_fixed_expense_audit
  (expense_id,operation,snapshot,principal_hash,external_actions,production_writes)
SELECT e.expense_id,'UPDATE',jsonb_build_object(
  'label',e.label,'amount',e.amount,'currency',e.currency,'expense_type',e.expense_type,
  'start_date',e.start_date,'status',e.status,'source',e.source
),'migration:028:business-owner-confirmed',0,0
FROM economics.finance_fixed_expenses e
WHERE e.source='USER_CONFIRMED_FIXED_EXPENSES_2026_08_30'
  AND NOT EXISTS (
    SELECT 1 FROM economics.finance_fixed_expense_audit a
    WHERE a.expense_id=e.expense_id
      AND a.principal_hash='migration:028:business-owner-confirmed'
  );

DO $$
DECLARE configured_total numeric;
DECLARE configured_count integer;
BEGIN
  SELECT count(*),sum(e.amount) INTO configured_count,configured_total
  FROM economics.finance_fixed_expenses e
  JOIN integration.dropea_store_config s ON s.store_id=e.store_id AND s.enabled=true
  WHERE lower(e.label) IN ('plan pro chatgpt','servidor externo vps','supabase','cod release','chatby')
    AND e.expense_type='RECURRING' AND e.status='ACTIVE';
  IF configured_count <> 5 OR configured_total IS DISTINCT FROM 176.39::numeric THEN
    RAISE EXCEPTION 'FINANCE_FIXED_EXPENSES_POSTCONDITION_FAILED';
  END IF;
END $$;

COMMIT;

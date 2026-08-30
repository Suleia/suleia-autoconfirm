BEGIN;

-- The five itemised recurring expenses introduced by migration 028 replace
-- the earlier one-off August aggregate. Preserve the historical row and its
-- audit trail, but make it inactive so the same EUR 176.39 is never charged
-- twice.
WITH deactivated AS (
  UPDATE economics.finance_fixed_expenses
  SET status='INACTIVE',updated_at=now()
  WHERE lower(label)='gastos fijos agosto 2026'
    AND source='CLEARCOD_VERIFIED_SCREEN_REVIEW'
    AND expense_type='ONE_OFF'
    AND amount=176.39::numeric
    AND start_date=DATE '2026-08-01'
    AND occurred_on=DATE '2026-08-01'
    AND status='ACTIVE'
  RETURNING expense_id,label,amount,currency,expense_type,start_date,end_date,occurred_on,status,source
)
INSERT INTO economics.finance_fixed_expense_audit
  (expense_id,operation,snapshot,principal_hash,external_actions,production_writes)
SELECT expense_id,'UPDATE',to_jsonb(deactivated),
  'migration:029:deduplicate-august-fixed-expenses',0,0
FROM deactivated
WHERE NOT EXISTS (
  SELECT 1 FROM economics.finance_fixed_expense_audit audit
  WHERE audit.expense_id=deactivated.expense_id
    AND audit.principal_hash='migration:029:deduplicate-august-fixed-expenses'
);

DO $$
DECLARE itemised_count integer;
DECLARE itemised_total numeric;
DECLARE active_aggregate_count integer;
BEGIN
  SELECT count(*),sum(amount) INTO itemised_count,itemised_total
  FROM economics.finance_fixed_expenses
  WHERE source='USER_CONFIRMED_FIXED_EXPENSES_2026_08_30'
    AND expense_type='RECURRING' AND status='ACTIVE';

  SELECT count(*) INTO active_aggregate_count
  FROM economics.finance_fixed_expenses
  WHERE lower(label)='gastos fijos agosto 2026'
    AND source='CLEARCOD_VERIFIED_SCREEN_REVIEW'
    AND amount=176.39::numeric AND status='ACTIVE';

  IF itemised_count <> 5 OR itemised_total IS DISTINCT FROM 176.39::numeric
    OR active_aggregate_count <> 0 THEN
    RAISE EXCEPTION 'FINANCE_FIXED_EXPENSE_DEDUPLICATION_POSTCONDITION_FAILED';
  END IF;
END $$;

COMMIT;

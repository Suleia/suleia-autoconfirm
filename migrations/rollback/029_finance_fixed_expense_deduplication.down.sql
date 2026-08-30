BEGIN;

DELETE FROM economics.finance_fixed_expense_audit
WHERE principal_hash='migration:029:deduplicate-august-fixed-expenses';

UPDATE economics.finance_fixed_expenses
SET status='ACTIVE',updated_at=now()
WHERE lower(label)='gastos fijos agosto 2026'
  AND source='CLEARCOD_VERIFIED_SCREEN_REVIEW'
  AND expense_type='ONE_OFF'
  AND amount=176.39::numeric
  AND start_date=DATE '2026-08-01'
  AND occurred_on=DATE '2026-08-01';

COMMIT;

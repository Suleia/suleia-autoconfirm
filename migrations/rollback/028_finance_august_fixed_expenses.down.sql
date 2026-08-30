BEGIN;
DELETE FROM economics.finance_fixed_expense_audit
WHERE principal_hash='migration:028:business-owner-confirmed';
DELETE FROM economics.finance_fixed_expenses
WHERE expense_id IN (
  'a8260001-0000-4000-8000-000000000001'::uuid,
  'a8260001-0000-4000-8000-000000000002'::uuid,
  'a8260001-0000-4000-8000-000000000003'::uuid,
  'a8260001-0000-4000-8000-000000000004'::uuid,
  'a8260001-0000-4000-8000-000000000005'::uuid
);
COMMIT;

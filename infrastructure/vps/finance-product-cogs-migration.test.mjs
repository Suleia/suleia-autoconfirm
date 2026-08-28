import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('confirmed product costs are idempotent, reversible and internal-only', () => {
  const up = read('migrations/026_finance_product_cogs.sql');
  const down = read('migrations/rollback/026_finance_product_cogs.down.sql');
  const apply = read('infrastructure/vps/apply-finance-product-cogs-migration.sh');
  assert.match(up, /'31666'::text,'31666'::text,1\.0100::numeric/);
  assert.match(up, /'31547'::text,'31547'::text,1\.4400::numeric/);
  assert.match(up, /WHERE NOT EXISTS/);
  assert.match(up, /FINANCE_PRODUCT_COGS_POSTCONDITION_FAILED/);
  assert.match(up, /USER_CONFIRMED_PRODUCT_COGS_2026_08_28/);
  assert.match(down, /DELETE FROM economics\.finance_cost_rates/);
  assert.match(apply, /026_finance_product_cogs\.sql/);
  assert.doesNotMatch(`${up}\n${down}\n${apply}`, /DROPEA_(?:CONFIRM|CANCEL)|CHATBY_SEND|META_ADS_BUDGET/);
});

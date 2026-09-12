import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../migrations/031_finance_realized_event_rates.sql', import.meta.url), 'utf8');
const apply = fs.readFileSync(new URL('./apply-finance-realized-event-rates-migration.sh', import.meta.url), 'utf8');
const deploy = fs.readFileSync(new URL('./deploy-private-staging.sh', import.meta.url), 'utf8');

test('realised-event finance rates are versioned, idempotent and deployment-wired', () => {
  assert.match(migration, /RETURN_LOGISTICS_COMBINED/);
  assert.match(migration, /5\.2600/);
  assert.match(migration, /'30133','30133',4\.0000/);
  assert.match(migration, /'31547','31547',1\.4400/);
  assert.match(migration, /'31666','31666',1\.0100/);
  assert.match(migration, /BUSINESS_VERIFIED_RATE/);
  assert.match(migration, /WHERE NOT EXISTS/);
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:operations|integration)\.(?:dropea_orders|dropea_issues|chatby_messages)/i);
  assert.match(apply, /031_finance_realized_event_rates\.sql/);
  assert.match(apply, /production_writes=0/);
  assert.ok(deploy.indexOf('apply-finance-realized-event-rates-migration.sh') > deploy.indexOf('apply-financial-control-migration.sh'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('results publication is isolated to finance API/UI and preserves runtime with rollback',()=>{
  const script=readFileSync(new URL('./deploy-results-clarity.sh',import.meta.url),'utf8');
  assert.match(script,/branch=fix\/results-return-rate-daily-clarity/);
  assert.match(script,/up -d --no-deps --no-build api review-panel/);
  assert.match(script,/cmp .*before-env\.json.*after-env\.json/);
  assert.match(script,/cmp .*before-config\.json.*after-config\.json/);
  assert.match(script,/cmp .*service-id-before.*service-id-after/);
  assert.match(script,/trap rollback ERR/);
  assert.doesNotMatch(script,/psql|migrations\/|install-staging|git push|CHATBY_REAL_SENDS=true|DROPEA_ACTIONS_ENABLED=true/);
});

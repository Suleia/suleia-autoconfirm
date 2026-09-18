import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./deploy-incident-recovery-center.sh',import.meta.url),'utf8');
test('current-incident deployment isolates GET-only reader/API/MCP/UI and preserves seven unrelated services and financial source',()=>{
  assert.match(source,/services=\(api mcp-server review-panel ingestion-worker\)/);
  assert.match(source,/for service in scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring/);
  assert.doesNotMatch(source,/psql|CHATBY_REAL_SENDS=true|docker (rm|stop)|rm -rf/);
  assert.match(source,/CHATBY_READ_MAX_CONVERSATIONS="8"/);
  assert.match(source,/startswith\("CHATBY_READ_MAX_CONVERSATIONS="\)\|not/);
  assert.match(source,/rollback\.json.*up -d --no-deps --no-build api mcp-server review-panel ingestion-worker/);
  assert.match(source,/127\.0\.0\.1:3302\/health/);
  assert.match(source,/cmp .*finance\/results-report\.mjs/);
  assert.match(source,/financial\(old\),financial\(next\)/);
  assert.match(source,/unchanged\(readFileSync\("\/previous\/apps\/review-panel\/styles\.css"/);
  assert.match(source,/trap rollback ERR/);assert.match(source,/--network none/);
});

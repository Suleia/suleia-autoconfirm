import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./deploy-incident-recovery-center.sh',import.meta.url),'utf8');
test('recovery deployment affects only API, MCP and static review, preserving operational workers and financial source',()=>{
  assert.match(source,/services=\(api mcp-server review-panel\)/);
  assert.match(source,/for service in ingestion-worker scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring/);
  assert.doesNotMatch(source,/up -d[^\n]*ingestion-worker|psql|CHATBY_REAL_SENDS=true|docker (rm|stop)|rm -rf/);
  assert.match(source,/cmp .*finance\/results-report\.mjs/);
  assert.match(source,/financial\(old\),financial\(next\)/);
  assert.match(source,/unchanged\(readFileSync\("\/previous\/apps\/review-panel\/styles\.css"/);
  assert.match(source,/trap rollback ERR/);assert.match(source,/--network none/);
});

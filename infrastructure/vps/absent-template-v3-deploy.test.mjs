import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('v3 isolated deployment preserves financial assets, safety environment and all unrelated services',()=>{
 const script=readFileSync(new URL('./deploy-absent-template-v3.sh',import.meta.url),'utf8');
 assert.match(script,/up -d --no-deps --no-build api mcp-server ingestion-worker/);
 assert.match(script,/CURRENT_ABSENT_TEMPLATE_IMAGE_TESTS\|PASS/);assert.match(script,/--network none/);assert.match(script,/trap rollback ERR/);
 assert.match(script,/for service in review-panel scheduler decision-engine postgres keycloak reverse-proxy mcp-edge monitoring/);
 assert.match(script,/cmp "\$resolved\/\$file" "\$release\/\$file"/);
 assert.match(script,/cmp "\$backup\/\$service-before-env.json" "\$backup\/\$service-after-env.json"/);
 assert.doesNotMatch(script,/\bpsql\b|migrations\/\d+|git push.*main|docker compose.*down/);
});

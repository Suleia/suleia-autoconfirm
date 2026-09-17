import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('real MCP absence registry has schema usage without CREATE or any mutation grants',()=>{
 const sql=read('../../migrations/039_absent_policy_registry_read_usage.sql');
 assert.match(sql,/GRANT USAGE ON SCHEMA configuration TO suleia_mcp_readonly,suleia_operations_readonly/);
 assert.doesNotMatch(sql,/GRANT\s+(ALL|CREATE|INSERT|UPDATE|DELETE)/i);
 assert.ok(read('./deploy-absent-integrity.sh').includes('migrations/039_absent_policy_registry_read_usage.sql'));
});
test('notification vocabulary accepts only the two precise missing states without weakening encryption or zero-action guards',()=>{
 const sql=read('../../migrations/038_chatby_notification_boundary_vocabulary.sql');
 assert.match(sql,/NOTIFICATION_NOT_OBSERVED/);assert.match(sql,/BEFORE_NOTIFICATION/);assert.match(sql,/ADD CONSTRAINT.*CHECK\(/s);
 assert.doesNotMatch(sql,/message_text_ciphertext|actions_executed|production_writes|UPDATE|DELETE/);
});
test('absence migration persists SHADOW registry/snapshots and never modifies existing timer rows',()=>{
 const sql=read('../../migrations/037_recipient_absent_shadow_integrity.sql');
 for(const evidence of ['configuration.policy_assignments','operations.recipient_absent_decision_snapshots','supersedes_decision_id','ABSENT_ASSIGNMENT_CONFLICT','absent_v1_one_response_timer_per_issue','configuration.shadow_schema_releases'])assert.ok(sql.includes(evidence));
 assert.doesNotMatch(sql,/UPDATE\s+operations\.incident_timers|DELETE\s+FROM\s+operations\.incident_timers|INSERT\s+INTO\s+operations\.incident_timers/i);
 assert.match(sql,/600 seconds/);assert.match(sql,/300 seconds/);assert.match(sql,/SHADOW_ISSUE_CREATED_ANCHOR_ONLY_NOT_NOTIFICATION/);
});
test('isolated deployment tests current image, preserves unrelated runtime and has scoped rollback',()=>{
 const sh=read('./deploy-absent-integrity.sh');
 for(const evidence of ['--network none','CURRENT_IMAGE_TESTS|PASS','--no-deps --no-build','trap rollback ERR','runtime-preserving-override.json','ABSENT_INTEGRITY_DEPLOY','"AUSENTE_AUTOMATION_LIVE":"false"'])assert.ok(sh.includes(evidence));
 assert.doesNotMatch(sh,/git push.*main|Render|send-template|resolveIssue|docker compose.*down/);
});
test('general ingestion cannot overwrite independent absence Chatby projections',()=>{
 const worker=read('../../services/shadow-readonly-worker.mjs');
 assert.match(worker,/excludeRecipientAbsent: true/);assert.match(worker,/onlyRecipientAbsent:true/);assert.match(worker,/submit:false/);
 assert.match(worker,/checked\.template_name==='dropea_ausente_v1'/);assert.match(worker,/setInterval\(runAbsent,120000\)/);
});

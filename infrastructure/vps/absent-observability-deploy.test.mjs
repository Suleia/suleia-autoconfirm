import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('observability deploy preserves ingestion environment and controls, collector includes only exact controller',async()=>{
 const deploy=await readFile(new URL('./deploy-absent-observability.sh',import.meta.url),'utf8');
 assert.match(deploy,/cmp.*before-env.*after-env/);assert.match(deploy,/trap rollback ERR/);
 assert.doesNotMatch(deploy,/UPDATE operations|migrations\/04[256]/);
 const collector=await readFile(new URL('./collect-platform-runtime-inventory.sh',import.meta.url),'utf8');
 assert.match(collector,/controller=recipient-absent-live-controller/);assert.match(collector,/restart_count/);assert.match(collector,/image_revision/);
 assert.doesNotMatch(collector,/AUSENTE_DROPEA_WRITE_TOKEN/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('all-incident trigger persists daily half-hour schedule without HTTP mutation retries',()=>{
 const runner=read('./run-incidents-cycle.sh'),timer=read('./suleia-incidents.timer'),service=read('./suleia-incidents.service');
 assert.match(timer,/OnCalendar=\*-\*-\* \*:00,30:00/);assert.match(timer,/Persistent=true/);
 assert.match(runner,/\/api\/cron\/sync-incidents/);assert.doesNotMatch(runner,/--retry/);
 assert.match(runner,/flock --nonblock/);assert.match(service,/StateDirectoryMode=0700/);
 assert.doesNotMatch(runner,/print\(.*payload|^cat\s+.*response_file/m);
});
test('VPS ownership suppresses all three local periodic sync owners',()=>{
 const server=read('../../autoconfirm/server.mjs');
 for(const name of ['startIncidentsScheduler','startIncidentNotificationsScheduler','startIncidentDiscountRecoveryScheduler']){
  const start=server.indexOf('function '+name+'()');
  const body=server.slice(start,server.indexOf('\n}',start)+2);
  const context={config:{incidentSyncOwner:'vps'}};
  // Any attempt to access local schedulers/timers throws in this isolated context.
  vm.runInNewContext(body+';'+name+'();',context);
 }
});

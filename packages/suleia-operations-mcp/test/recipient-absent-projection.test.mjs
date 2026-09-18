import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OperationsProjector} from '../src/operations/projector.mjs';
import {OperationsRepository} from '../src/operations/repository.mjs';
import {simulateRecipientAbsent} from '../../platform-core/src/incident/recipient-absent-policy.mjs';
import {projectRecipientAbsentShadow} from '../../platform-core/src/incident/absent-panel-projection.mjs';
const issue={canonical_issue_id:'i',canonical_order_id:'o',type:'RECIPIENT_ABSENT',status:'PENDING',is_active:true,created_at:'2026-09-16T10:00:00Z',updated_at:'2026-09-16T10:00:00Z'};
const decision=()=>simulateRecipientAbsent({issue,order:{canonical_order_id:'o'},chatby:{},events:[]},{now:'2026-09-16T12:00:00Z'}).decision;
test('shadow projector updates only the additive absent column, never status/actions/timer deadlines',async()=>{
  const calls=[];const p=new OperationsProjector({query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1};}});
  await p.applyIncidentDecision({issue,decision:decision()});assert.equal(calls.length,1);
  assert.match(calls[0].sql,/SET absent_shadow/);assert.match(calls[0].sql,/AND type='RECIPIENT_ABSENT'/);
  assert.doesNotMatch(calls[0].sql,/SET status|SET due_at|discount|incident_timers/);
  const d=decision();d.timer={timer_type:'T_PLUS_12H'};await assert.rejects(p.applyRecipientAbsentShadow({issue,decision:d}),/TIMER_POLICY_INVALID/);assert.equal(calls.length,1);
  await assert.rejects(p.applyRecipientAbsentShadow({issue:{...issue,type:'ADDRESS_INCORRECT'},decision:decision()}),/PROJECTION_INVALID/);
});
test('canonical absent read projection exposes the persisted decision id and does not alter other lanes',()=>{
  const d=decision(),s=d.absent_shadow;const row=projectRecipientAbsentShadow({absent_shadow:s});
  assert.equal(row.current_decision_id,d.decision_id);assert.equal(row.effective_decision_status,s.simulation_status);
  const other={type:'REFUSED_BY_RECIPIENT',next_action:'old'};assert.equal(projectRecipientAbsentShadow(other),other);
});
test('absent joins bind both identity keys and invalidate stale decisions before filtering',()=>{
  for(const path of ['../src/operations/repository.mjs','../src/data/postgres-read-repository.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(source,/JOIN read_models\.recipient_absent_shadow (\w+) ON \1\.canonical_issue_id=p\.canonical_issue_id\s+AND \1\.canonical_order_id=p\.canonical_order_id AND p\.notification_decision_current/);
    assert.doesNotMatch(source,/JOIN read_models\.recipient_absent_shadow \w+ USING\(canonical_issue_id\)/);
    assert.doesNotMatch(source,/JOIN read_models\.operations_private_order_display private_order USING\(canonical_order_id\)/);
  }
});
test('new absent filters use the same derived universe and leave generic types isolated',async()=>{
  const calls=[];const r=new OperationsRepository('',{pool:{query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}}});
  await r.listIncidents(new URLSearchParams({scope:'ALL',absent:'AUSENTE'}));
  assert.match(calls[0].sql,/read_models\.recipient_absent_shadow/);
  await r.listIncidents(new URLSearchParams({scope:'ALL',type:'REFUSED_BY_RECIPIENT'}));
  assert.match(calls[2].sql,/read_models\.recipient_absent_shadow/);
  assert.ok(calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE)/.test(c.sql)));
  const source=readFileSync(new URL('../../platform-core/src/incident/recovery-center.mjs',import.meta.url),'utf8');
  assert.match(source,/item\.normalized_type!=='RECIPIENT_ABSENT'/);
  assert.match(source,/\['type','interpreted_type'\]/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIncidentDashboard,dashboardProjection} from '../src/incident/dashboard.mjs';
const now='2026-09-20T16:00:00Z';
const issue=(id,extra={})=>({canonical_issue_id:`issue-${id}`,canonical_order_id:`order-${id}`,dropea_issue_id:String(id),status:'PENDING',is_active:true,
  created_at:'2026-09-18T12:00:00Z',interpreted_type:'REFUSED_BY_RECIPIENT',chatby_sync_current:true,dropea_sync_current:true,...extra});
test('resolution, follow-up and history partition the population without closing open records',()=>{
  const records=[...Array.from({length:6},(_,i)=>issue(i)),...Array.from({length:6},(_,i)=>issue(i+6,{interpreted_type:'PICKUP_AT_AGENCY'})),
    ...Array.from({length:3},(_,i)=>issue(i+12,{interpreted_type:'RECIPIENT_ABSENT',dashboard_source_context:{is_first_absent:true,absence_count:1}})),issue(20,{is_active:false})];
  const active=buildIncidentDashboard(records,{now});assert.equal(active.total,6);assert.deepEqual(active.summary.dashboard.scope_counts,{ACTIVE:6,FOLLOWUP:9,HISTORICAL:1});
  const follow=buildIncidentDashboard(records,{now,filters:{scope:'FOLLOWUP'}});assert.equal(follow.total,9);assert.ok(follow.items.every(i=>i.status==='PENDING' && i.is_active));
  records[12].dashboard_source_context={is_first_absent:false,absence_count:2};
  assert.equal(buildIncidentDashboard(records,{now}).total,7);
  assert.equal(buildIncidentDashboard(records,{now,filters:{scope:'HISTORICAL'}}).total,1);
});
test('unknown attempt never silently removes an open incident from resolution',()=>{
  assert.equal(buildIncidentDashboard([issue(1,{interpreted_type:'RECIPIENT_ABSENT'})],{now}).total,1);
});
test('all six metric buttons use exactly the table selector before pagination',()=>{
  const records=[issue(1),issue(2,{chatby_sync_current:false}),issue(3,{is_active:false})];
  const result=buildIncidentDashboard(records,{now,limit:1});assert.equal(result.summary.dashboard.kpis.length,6);
  for(const kpi of result.summary.dashboard.kpis){const filtered=buildIncidentDashboard(records,{now,filters:{metric:kpi.key}});assert.equal(filtered.total,kpi.count,kpi.key);}
  assert.equal(result.items.length,1);assert.equal(result.total,2);
});
test('missing real timer and stale historical decision cannot present a current wait or ready simulation',()=>{
  const row=dashboardProjection(issue(1,{autopilot_next_action:'WAIT_EXISTING_TIMER',autopilot_state:'WAITING_CUSTOMER',tailored_recommendation:{code:'WAIT_EXISTING_TIMER',title:'Esperar'},
    interpreted_type:'RECIPIENT_ABSENT',effective_decision_status:'SIMULATION_READY'}),{now});
  assert.equal(row.dashboard.flags.WAITING_CUSTOMER,false);assert.equal(row.dashboard.flags.SIMULATION_READY,false);
  assert.equal(row.dashboard.action,'Verificar el plazo de respuesta');assert.ok(row.dashboard.blocking_reasons.includes('TIMER_NOT_MATERIALIZED'));
  const history=dashboardProjection(issue(2,{is_active:false,autopilot_next_action:'REQUEST_RETURN'}),{now});assert.equal(history.dashboard.action,'Consultar historial');
});
test('ready simulation requires persisted identity, hashes, current binding, fresh sources and no blockers',()=>{
  const ready=issue(1,{notification_decision_current:true,current_decision_id:'decision',policy_id:'policy',policy_version:'v1',policy_snapshot_hash:'policy-hash',input_snapshot_hash:'input-hash',decision_record_status:'PERSISTED',effective_decision_status:'SIMULATION_READY'});
  assert.equal(dashboardProjection(ready,{now}).dashboard.flags.SIMULATION_READY,true);
  for(const extra of [{policy_snapshot_hash:null},{notification_decision_current:false},{chatby_sync_current:false},{effective_blocking_reasons:['BLOCKED']},{absent_shadow:{input_snapshot_hash:'old'}}])
    assert.equal(dashboardProjection({...ready,...extra},{now}).dashboard.flags.SIMULATION_READY,false);
});
test('search covers external order, customer and canonical IDs; template and names stay separate',()=>{
  const data=issue(1,{external_order_reference:'TEST-123',customer_name:'Persona -',incident_notification_template:'Persona ***'});
  for(const q of ['test-123','persona','issue-1'])assert.equal(buildIncidentDashboard([data],{now,filters:{q}}).total,1);
  const row=dashboardProjection(data,{now});assert.equal(row.customer_name,'Persona');assert.equal(row.dashboard.template_name,null);
  assert.equal(buildIncidentDashboard([data],{now,filters:{q:'missing'}}).total,0);
});
test('rejection aliases are display mappings only and actions remain disabled',()=>{
  for(const raw_type of ['REFUSED','REJECTED_BY_RECIPIENT']){const row=dashboardProjection(issue(1,{raw_type,interpreted_type:'UNKNOWN'}),{now});assert.equal(row.interpreted_type,'REFUSED_BY_RECIPIENT');assert.equal(row.dashboard.executable,false);}
});

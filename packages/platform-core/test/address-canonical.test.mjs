import test from 'node:test';
import assert from 'node:assert/strict';
import {materializeAddress,ADDRESS_POLICY_HASH} from '../src/incident/address-canonical.mjs';
import {mapDropeaIssue} from '../src/operational-truth/dropea-canonical.mjs';
const t0='2026-09-21T08:38:08.000Z',now=new Date('2026-09-26T14:00:00Z');
const issue={type:'ADDRESS_INCORRECT',canonical_issue_id:'issue-fixture',canonical_order_id:'order-fixture',created_at:'2026-09-21T08:37:05Z',updated_at:'2026-09-26T13:18:44.492Z',status:'PENDING',is_active:true};
const observation={notification_at:t0,notification_message_id:'message-hash',template_name:'dropea_incidencia_direccion_v1',read_at:now.toISOString(),read_verified:true,issue_version:issue.updated_at,policy_snapshot_hash:ADDRESS_POLICY_HASH,action:'RETURN_TO_ORIGIN',intent:'NO_RESPONSE'};
const policy={policy_id:'policy-fixture',policy_snapshot_hash:ADDRESS_POLICY_HASH};
const decide=(o={})=>materializeAddress({issue,observation,policy,now,...o});
test('A governed GLS ES composite maps address; each missing corroboration stays unknown',()=>{
 const raw={id:'fixture',order_id:'fixture',type:'ADDRESS_INCORRECT',carrier:'GLS',status:'PENDING',is_active:true,initial_carrier_code:'-30',initial_carrier_substatus_code:'13',initial_carrier_description:'DIRECCIÓN INCORRECTA',created_at:issue.created_at,updated_at:issue.updated_at};
 const options={canonicalOrderId:'order-fixture',hmacKey:'fixture-'.repeat(8),market:'ES',storeId:'fixture'};
 assert.equal(mapDropeaIssue(raw,options).type,'ADDRESS_INCORRECT');
 for(const patch of [{type:'GENERAL_INCIDENCE'},{carrier:'OTHER'},{initial_carrier_substatus_code:'15'},{initial_carrier_description:'OTHER'}])assert.equal(mapDropeaIssue({...raw,...patch},options).type,'UNKNOWN');
 assert.equal(mapDropeaIssue(raw,{...options,market:'PT'}).type,'UNKNOWN');
});
test('B five observations have one initial timer identity',()=>{
 const timers=Array.from({length:5},(_,i)=>decide({issue:{...issue,updated_at:new Date(+now+i*1000).toISOString(),source_event_id:`event-${i}`}}).timer);
 assert.equal(new Set(timers.map(t=>t.timer_id)).size,1);
});
test('C exact real notification anchors both milestones',()=>{
 const t=decide().timer;assert.equal(t.started_at,t0);assert.equal(t.offer_due_at,'2026-09-22T08:38:08.000Z');assert.equal(t.due_at,'2026-09-23T08:38:08.000Z');assert.equal(t.status,'EXPIRED');
});
test('D provider update never restarts timer and invalidates old decision',()=>{
 const d=decide({issue:{...issue,updated_at:now.toISOString()}});assert.deepEqual(d.timer,decide().timer);assert.equal(d.current,false);
});
test('E failed resolution keeps original window',()=>{
 const d=decide({observation:{...observation,execution:{status:'MANUAL_RECONCILIATION_REQUIRED',provider_error_code:'GLS_INCIDENCE_ALREADY_SOLVED'}}});assert.deepEqual(d.timer,decide().timer);assert.equal(d.state,'PROVIDER_RECONCILIATION_REQUIRED');
});
test('F partial response supersedes permanently even when later owner read lacks response',()=>{
 const first=decide({observation:{...observation,initial_milestones:'SUPERSEDED_BY_CUSTOMER_RESPONSE'}});
 const second=decide({previous:first});assert.equal(second.timer.status,'SUPERSEDED');assert.equal(second.action,'HUMAN_REVIEW');
});
test('G provider conflict persists and excludes canaries',()=>{
 const d=decide({previous:{provider_conflict:true}});assert.equal(d.action,'HUMAN_REVIEW');assert.equal(d.finding.canary_excluded,true);assert.equal(d.finding.manual_reconciliation_required,true);assert.equal(d.executed,false);
});
test('H old Chatby error becomes historical with healthy current evidence',()=>{
 const old='CHATBY_BROKEN:CHATBY_MESSAGE_READ_FAILED';const d=decide({issue:{...issue,blocking_reasons:[old]}});
 assert.ok(d.historical_blockers.includes(old));assert.ok(!d.current_blockers.includes(old));assert.equal(d.current,true);
});
test('I stale read, changed issue or policy cannot be current',()=>{
 assert.equal(decide({now:new Date(+now+21*60000)}).current,false);
 assert.equal(decide({policy:{...policy,policy_snapshot_hash:'different'}}).current,false);
 assert.equal(decide({observation:{...observation,issue_version:null}}).current,false);
});
test('missing notification never invents a timer; replacement notification is blocked',()=>{
 assert.equal(decide({observation:{...observation,notification_message_id:null}}).timer,null);
 const d=decide({previous:{notification_message_id:'different'}});assert.equal(d.timer,null);assert.equal(d.current,false);
});

test('crossing a milestone requires a new owner decision, even with a recent read',()=>{
 const read=new Date(Date.parse(t0)+24*3600000-60000);
 const d=decide({observation:{...observation,read_at:read.toISOString()},now:new Date(+read+120000)});
 assert.equal(d.current,false);assert.ok(d.current_blockers.includes('OWNER_MILESTONE_STALE'));
});

test('raw address with ungoverned carrier mapping remains manual',()=>{
 const d=decide({issue:{...issue,type:'UNKNOWN',raw_type:'ADDRESS_INCORRECT'}});
 assert.equal(d.action,'HUMAN_REVIEW');assert.ok(d.current_blockers.includes('ADDRESS_MAPPING_NOT_GOVERNED'));
});

test('Postgres Date objects preserve millisecond issue versions',()=>{
 const d=decide({issue:{...issue,updated_at:new Date(issue.updated_at),created_at:new Date(issue.created_at)}});
 assert.equal(d.current,true);assert.ok(!d.current_blockers.includes('OWNER_ISSUE_VERSION_MISMATCH'));
});

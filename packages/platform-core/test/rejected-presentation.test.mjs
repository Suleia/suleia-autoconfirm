import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowPresentation,incidentAutonomy} from '../src/incident/automation-presentation.mjs';
import {rejectedMetrics} from '../src/incident/rejected-presentation.mjs';
const now=new Date().toISOString();
const owner={workflow:'RECIPIENT_REJECTED',observed_at:now,last_cycle_at:now,master_enabled:true,healthy:true,stages:{contact:'LIVE',interpretation:'LIVE',recovery_offer:'LIVE',discount:'UNKNOWN',new_delivery:'OFF',return:'LIVE'},breakers:{notification:'CLOSED',return:'OPEN'}};
test('existing owner live stages survive shadow projection while unsupported application stays unknown',()=>{
 const w=workflowPresentation({workflow:'REFUSED_BY_RECIPIENT',has_shadow:true},{rejectedHealth:owner});
 assert.equal(w.id,'RECIPIENT_REJECTED');assert.equal(w.stages.find(s=>s.id==='notification').mode,'LIVE');
 assert.equal(w.stages.find(s=>s.id==='discount').mode,null);assert.equal(w.stages.find(s=>s.id==='new_delivery').mode,'OFF');
 assert.equal(w.breakers.find(b=>b.id==='return').status,'OPEN');assert.equal(w.counts.notifications,null);
});
test('stale or future owner evidence cannot present live',()=>{
 for(const observed_at of ['2000-01-01T00:00:00Z','2999-01-01T00:00:00Z']){
 const w=workflowPresentation({workflow:'REFUSED_BY_RECIPIENT'},{rejectedHealth:{...owner,observed_at}});
 assert.equal(w.health,'UNKNOWN');assert.ok(w.stages.every(s=>s.mode===null));
 }
});
test('current acceptance prepares support recovery; later evidence or stale read requires review',()=>{
 const item={interpreted_type:'REFUSED_BY_RECIPIENT',rejected_observation:{decision:{decision_status:'CURRENT',read_verified:true,read_at:now,responded_at:now,intent:'ACCEPTS_DISCOUNT',next_best_action:'APPLY_DISCOUNT'}}};
 const w=workflowPresentation({workflow:'REFUSED_BY_RECIPIENT'},{rejectedHealth:owner});
 const p=incidentAutonomy(item,w);assert.equal(p.next_best_action.action,'APPLY_DISCOUNT');assert.equal(p.autonomy.status,'PREPARED');
 const newer=incidentAutonomy({...item,latest_private_customer_message_at:'2999-01-01T00:00:00Z'},w);
 assert.equal(newer.autonomy.status,'HUMAN_REVIEW');assert.equal(newer.next_best_action.action,'HUMAN_REVIEW');
});
test('rejected metrics dedupe records/actions and never invent recovered profit',()=>{
 const i={canonical_issue_id:'issue1',interpreted_type:'REFUSED_BY_RECIPIENT'};
 const a={id:'offer1',workflow:'RECIPIENT_REJECTED',evidence_mode:'REAL',execution_status:'VERIFIED',action_type:'OFFER_RECOVERY_DISCOUNT'};
 const m=rejectedMetrics([i,i],[a,a,{...a,id:'shadow',evidence_mode:'SHADOW'}]);
 assert.equal(m.find(x=>x.id==='rejected_total').value,1);assert.equal(m.find(x=>x.id==='discount_offered').value,1);assert.equal(m.find(x=>x.id==='recovery_profit').value,null);
});

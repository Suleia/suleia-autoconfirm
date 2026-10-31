import test from 'node:test';import assert from 'node:assert/strict';
import {evaluatePreCanaryGate,evaluatePromotionGate} from './release-gates.mjs';
const pre=()=>({real_cases:380,reviewed_real_cases:345,provenance_verified:true,wrong_irreversible_route:0,wrong_order_binding:0,repeated_clarification:0,
 owner_routing:1,explicit_return_recall:1,explicit_order_recall:1,date_window_accuracy:.99,current_replay_verified:true,
 executor_reconciliation_contract_verified:true,unknown_execution_no_blind_retry_tests:true,blind_retry:null});
const promotion=()=>({...pre(),canary_executed:true,canary_exact_case:true,send_attempts:1,provider_receipt_verified:true,conversation_readback_verified:true,
 wrong_recipient:0,duplicate_send:0,blind_retry:0,uncertain_write_replayed:0,current_evidence_revalidated:true,capability:'CONTEXTUAL_CLARIFICATION',canary_capability:'CONTEXTUAL_CLARIFICATION'});
test('pre-canary requires evidence contracts but no observed canary or invented blind-retry zero',()=>{
 assert.equal(evaluatePreCanaryGate(pre()).allowed,true);assert.equal(evaluatePreCanaryGate({...pre(),blind_retry:undefined,canary_executed:false}).allowed,true);
 assert.equal(evaluatePromotionGate(pre()).allowed,false);
 for(const key of ['provenance_verified','current_replay_verified','executor_reconciliation_contract_verified','unknown_execution_no_blind_retry_tests'])
  for(const value of [false,null,undefined,'true'])assert.equal(evaluatePreCanaryGate({...pre(),[key]:value}).allowed,false,key);
});
test('pre-canary rejects incomplete/non-numeric metrics, synthetic counts and threshold equality',()=>{
 for(const patch of [{real_cases:undefined},{reviewed_real_cases:undefined},{real_cases:300,reviewed_real_cases:301},{real_cases:299},{reviewed_real_cases:'345'},
  {real_cases:0,synthetic_cases:1000},{owner_routing:.999},{explicit_order_recall:.999},{explicit_return_recall:.999},{date_window_accuracy:.98},{date_window_accuracy:'0.99'},{date_window_accuracy:NaN},{date_window_accuracy:2}])assert.equal(evaluatePreCanaryGate({...pre(),...patch}).allowed,false);
 for(const key of ['wrong_irreversible_route','wrong_order_binding','repeated_clarification'])for(const v of [1,null,undefined,'0'])assert.equal(evaluatePreCanaryGate({...pre(),[key]:v}).allowed,false);
});
test('promotion needs one real exact send and all independent provider/readback and no-replay evidence',()=>{
 assert.equal(evaluatePromotionGate(promotion()).allowed,true);
 for(const key of ['canary_executed','canary_exact_case','provider_receipt_verified','conversation_readback_verified','current_evidence_revalidated'])
  assert.equal(evaluatePromotionGate({...promotion(),[key]:false}).allowed,false,key);
 for(const key of ['wrong_recipient','duplicate_send','blind_retry','uncertain_write_replayed'])
  for(const v of [1,null,undefined])assert.equal(evaluatePromotionGate({...promotion(),[key]:v}).allowed,false,key);
 for(const v of [0,2,null])assert.equal(evaluatePromotionGate({...promotion(),send_attempts:v}).allowed,false);
});
test('one capability canary cannot promote another capability or bypass pre-canary gates',()=>{
 assert.equal(evaluatePromotionGate(promotion()).capability,'CONTEXTUAL_CLARIFICATION');
 for(const patch of [{capability:'STATUS_REPLY'},{canary_capability:'STATUS_REPLY'},{capability:'LIVE'},{current_replay_verified:false}])assert.equal(evaluatePromotionGate({...promotion(),...patch}).allowed,false);
});

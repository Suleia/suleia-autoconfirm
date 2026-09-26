import test from 'node:test';
import assert from 'node:assert/strict';
import {maskPii} from '../../suleia-operations-mcp/src/security/pii.mjs';
import {evaluateSourceFreshness} from '../src/operational-truth/freshness.mjs';
import {absentResolutionPreflight} from '../src/incident/absent-resolution.mjs';
import {interpretAbsentResponse} from '../src/incident/recipient-absent-policy.mjs';
import {fixture,now} from './fixtures/absent-resolution.mjs';
test('old source event with fresh completed poll has distinct statuses, no relaxed threshold',()=>{
 const x=evaluateSourceFreshness({source:'dropea',source_event_at:'2026-09-21T12:00:00Z',last_successful_sync_at:now,sync_complete:true},{now});
 assert.equal(x.connector_poll_freshness,'FRESH');assert.equal(x.source_event_freshness,'STALE');assert.equal(x.freshness_status,'STALE');
});
test('governed template snapshot name survives masking; customer names do not',()=>{
 const x=maskPii({input_snapshot:{template:{name:'dropea_ausente_v3',body_hash:'h',mapping_hash:'m'},customer:{name:'Synthetic customer'}},template:{name:'Synthetic person'}});
 assert.equal(x.input_snapshot.template.name,'dropea_ausente_v3');assert.equal(x.input_snapshot.customer.name,'Cliente enmascarado');assert.equal(x.template.name,'Cliente enmascarado');
});
for(const state of ['SUPERSEDED','HISTORICAL'])test(`${state} decision cannot authorize execution`,()=>{
 const x=fixture();x.decision_currentness=state;assert.equal(absentResolutionPreflight(x,now).can_execute,false);
});
test('CURRENT still requires direct execution freshness and absence of incompatible return',()=>{
 const x=fixture();assert.equal(absentResolutionPreflight(x,now).can_execute,true);x.order.observed_at='2026-09-21T12:00:00Z';
 assert.equal(absentResolutionPreflight(x,now).execution_freshness.status,'REVALIDATION_REQUIRED');x.order.observed_at=now;x.return_in_progress=true;
 assert.equal(absentResolutionPreflight(x,now).can_execute,false);
});
for(const [text,date,window] of [['entregar mañana','2026-09-23','UNSPECIFIED'],['mañana por la tarde','2026-09-23','AFTERNOON'],['el 24 de septiembre','2026-09-24','UNSPECIFIED'],['24 de septiembre por la mañana','2026-09-24','MORNING'],['el viernes hasta las 16','2026-09-25','UNTIL_TIME']])test(`requested parser regression: ${text}`,()=>{
 const r=interpretAbsentResponse({raw_text:text,created_at:now});assert.equal(r.requested_date,date);assert.equal(r.requested_time_window,window);assert.equal(r.unambiguous,true);
});
test('time only needs a date and corrected PM keeps the correlated date',()=>{
 assert.equal(interpretAbsentResponse({raw_text:'después de las 18',created_at:now}).unambiguous,false);
 const r=interpretAbsentResponse({raw_text:'por la mañana no, por la tarde sí',created_at:now,correlated_requested_date:'2026-09-24'});assert.equal(r.requested_time_window,'AFTERNOON');assert.equal(r.requested_date,'2026-09-24');
});

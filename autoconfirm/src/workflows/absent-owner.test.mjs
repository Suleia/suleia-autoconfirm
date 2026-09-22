import test from 'node:test';
import assert from 'node:assert/strict';
import {absentOwnedByNativeChatby} from './absent-owner.mjs';
import {processIncidentNotification,incidentTemplateNameForType} from './incident-notifications.mjs';
test('exclusive native absent owner leaves all other incident mappings and lanes unchanged',()=>{
 for(const type of ['rejected_goods','address','missing_data','confirmation','cancellation','no_response'])assert.equal(absentOwnedByNativeChatby({incidentType:type},{AUSENTE_NOTIFICATION_OWNER:'chatby_native'}),false);
 assert.equal(absentOwnedByNativeChatby({incidentType:'absent'},{}),false);
 assert.equal(absentOwnedByNativeChatby({incidentType:'absent'},{AUSENTE_NOTIFICATION_OWNER:'chatby_native'}),true);
 assert.equal(incidentTemplateNameForType('address'),'es_ES dropea_incidencia_direccion_v1');
 assert.equal(incidentTemplateNameForType('rejected_goods'),'es_ES dropea_incidencia_mercancia_v1');
});
test('native owner blocks absent before any lookup, claim or send, without requiring unrelated flags',async()=>{
 const previous=process.env.AUSENTE_NOTIFICATION_OWNER;process.env.AUSENTE_NOTIFICATION_OWNER='chatby_native';
 try{assert.equal((await processIncidentNotification({incident:{incidentType:'absent'}})).reason,'absent_native_chatby_owner');}
 finally{if(previous===undefined)delete process.env.AUSENTE_NOTIFICATION_OWNER;else process.env.AUSENTE_NOTIFICATION_OWNER=previous;}
});

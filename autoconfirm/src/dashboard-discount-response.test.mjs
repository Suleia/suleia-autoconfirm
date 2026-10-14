import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cachedDiscountResponse} from './dashboard-discount-response.mjs';
const now=Date.parse('2026-10-14T12:00:00Z'),at='2026-10-14T10:00:00Z';
const ledger={order_id:'fixture',chatby_user_ns:'fixture-chat',template_name:'fixture-template',sent_at:at};
const incident={orderId:'fixture',chatbyUserNs:'fixture-chat',incidentDiscountTemplate:'fixture-template',incidentDiscountSentAt:at,chatbyReadVerified:true,incidentDiscountVerified:true,incidentDiscountResponseStatus:'DISCOUNT_ACCEPTED',incidentDiscountRespondedAt:'2026-10-14T11:00:00Z'};
const cache={updatedAt:'2026-10-14T11:50:00Z',incidents:[incident]};
test('dashboard displays only the fresh exact-order and exact-offer response',()=>{
 assert.equal(cachedDiscountResponse(ledger,cache,now).status,'DISCOUNT_ACCEPTED');
 for(const change of [{orderId:'other'},{chatbyUserNs:'other'},{incidentDiscountTemplate:'other'},{incidentDiscountSentAt:'2026-10-13T10:00:00Z'},{chatbyReadVerified:false},{incidentDiscountVerified:false}])
  assert.equal(cachedDiscountResponse(ledger,{...cache,incidents:[{...incident,...change}]},now).status,'STATUS_UNAVAILABLE');
 assert.equal(cachedDiscountResponse(ledger,{...cache,updatedAt:at},now).status,'STATUS_UNAVAILABLE');
 assert.equal(cachedDiscountResponse(ledger,{},now).status,'STATUS_UNAVAILABLE');
});
test('opening the discount panel cannot trigger Chatby history reads',()=>{
 const source=fs.readFileSync(new URL('./dashboard.mjs',import.meta.url),'utf8');
 const builder=source.slice(source.indexOf('async function buildIncidentDiscountRows'),source.indexOf('function numberFrom'));
 assert.doesNotMatch(builder,/getChatMessages|classifyIncidentDiscountResponse/);
 assert.match(builder,/cachedDiscountResponse/);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {absentOrdersPollAlert} from './absent-orders-alert.mjs';
test('orders poll alert uses successful polling, not the age of business events',()=>{
 const now=new Date('2026-09-25T12:00:00Z');const row={connector:'dropea:ES:orders',last_success_at:'2026-09-25T11:59:00Z',pagination_complete:true,source_event_at:'2026-01-01T00:00:00Z'};
 assert.equal(absentOrdersPollAlert([row],now).health_status,'HEALTHY');
 assert.equal(absentOrdersPollAlert([{...row,last_success_at:'2026-09-25T11:45:00Z'}],now).health_status,'HEALTHY');
 assert.equal(absentOrdersPollAlert([{...row,last_success_at:'2026-09-25T11:39:00Z'}],now).health_status,'UNHEALTHY');
});

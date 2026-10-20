import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, completed } from './contact-retention-policy.mjs';
const contact = { user_ns: 'synthetic', phone: '600000000', user_fields: [{ name: '#Pedido', value: '#12' }] };
const order = { id: 1, external_order_id: '12', status: 'FINISH', sub_status: 'DELIVERED', shipping_address: { phone_number: '+34600000000' } };
test('completed delivery with exact phone and reference qualifies', () => assert.equal(decide(contact, [order], []).eligible, true));
test('paid delivery qualifies', () => assert.equal(completed({ ...order, sub_status: 'PAID' }), 'delivered'));
test('return requires completed timestamp', () => {
  assert.equal(completed({ ...order, status: 'ERROR', sub_status: 'REJECTED' }), 'rejected_closed');
  assert.equal(completed({ ...order, status: 'FINISH', sub_status: 'RETURNED', returned_at: '2026-10-01T10:00:00Z' }), 'returned');
  assert.equal(completed({ ...order, status: 'SHIPPING', sub_status: 'RETURNED', returned_at: '2026-10-01T10:00:00Z' }), null);
});
test('rejected contacts remain protected while an issue or other order is active',()=>{
  const rejected={...order,status:'ERROR',sub_status:'REJECTED'};
  assert.equal(decide(contact,[rejected],[]).eligible,true);
  assert.equal(decide(contact,[rejected],[{order_id:1,status:'PENDING'}]).eligible,false);
  assert.equal(decide(contact,[rejected,{...order,id:2,status:'PENDING'}],[]).eligible,false);
});
test('return requests and unproven refusals never qualify', () => {
  for (const sub_status of ['RETURN_REQUESTED', 'REFUSED']) assert.equal(completed({ ...order, sub_status }), null);
});
test('owner-authorized definitive cancellations qualify but active states do not',()=>{
  assert.equal(completed({...order,sub_status:'CANCELLED'}),'cancelled');
  assert.equal(completed({...order,status:'PENDING',sub_status:'CANCELLED'}),null);
  assert.equal(decide(contact,[{...order,sub_status:'CANCELLED'}],[{order_id:1,status:'PENDING'}]).eligible,false);
});
test('completed delivery supersedes only older incidents with known timestamps',()=>{
  const delivered={...order,delivered_at:'2026-10-19T10:00:00Z'};
  assert.equal(decide(contact,[delivered],[{order_id:1,status:'PENDING',updated_at:'2026-10-18T10:00:00Z'}]).eligible,true);
  for(const updated_at of [undefined,'invalid','2026-10-20T10:00:00Z']){
    assert.equal(decide(contact,[delivered],[{order_id:1,status:'PENDING',updated_at}]).eligible,false);
  }
});
test('another active order protects contact', () => {
  assert.equal(decide(contact, [order, { ...order, id: 2, external_order_id: '13', status: 'PENDING' }], []).reason, 'other_nonterminal_order');
});
test('unresolved and unknown issue states protect contact', () => {
  for (const status of ['PENDING', 'INFO', undefined]) assert.equal(decide(contact, [order], [{ order_id: 1, status }]).reason, 'unresolved_issue');
  assert.equal(decide(contact, [order], [{ order_id: 1, status: 'RESOLVED' }]).eligible, true);
});
test('fieldless contacts require exclusively completed orders; conflicting references cannot qualify', () => {
  assert.equal(decide({ ...contact, user_fields: [] }, [order], []).eligible, true);
  assert.equal(decide({ ...contact, user_fields: [] }, [order,{...order,id:2,status:'PENDING'}], []).eligible, false);
  assert.equal(decide({ ...contact, phone: '600000001' }, [order], []).eligible, false);
  assert.equal(decide(contact, [order, { ...order, id: 2 }], []).eligible, false);
  assert.equal(decide({ ...contact, user_fields: [{ name: '#Pedido', value: 'wrong' }, { name: 'LOG-Payload', value: '{"resource_id":1}' }] }, [order], []).eligible, false);
});

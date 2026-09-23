import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processIncidentDiscountRecovery,
  warmIncidentDiscountTemplateCache
} from './incident-discount-service.mjs';

const initial = {
  type: 'agent',
  created_at: '2026-08-28T08:00:00.000Z',
  mid: 'wamid.INITIAL_FIXTURE',
  content: { name: 'dropea_incidencia_mercancia_v1' }
};

function fixture() {
  const sent = [];
  const finished = [];
  const incident = {
    orderId: '1357848',
    incidenceId: '1252293',
    incidenceDate: '2026-08-28T07:55:00.000Z',
    incidentType: 'rejected_goods',
    issueStatus: 'PENDING',
    customerName: 'Persona Fixture',
    phone: '600000001',
    chatbyUserNs: 'fixture-conversation',
    chatbyReadVerified: true
  };
  const order = {
    orderId: incident.orderId,
    customerPhone: incident.phone,
    createdAt: '2026-08-27T10:00:00.000Z',
    raw: { created_at: '2026-08-27T10:00:00.000Z', external_order_id: '#2007' }
  };
  const dependencies = {
    inspectPrior: async () => ({ verified: false, blocked: false }),
    readCurrent: async () => ({ issue: { id: incident.incidenceId, order_id: incident.orderId, status: 'PENDING', is_active: true, type: 'REFUSED_BY_RECIPIENT' }, order: { ...order, status: 'ERROR' } }),
    getTemplate: async () => ({
      name: 'es_es_dropea_incidencia_descuento_5_v1',
      language: 'es_ES',
      namespace: 'fixture-namespace',
      status: 'APPROVED',
      defaultParams: {},
      bodyFields: ['BODY_{{1}}', 'BODY_{{2}}', 'BODY_{{3}}']
    }),
    getMessages: async () => [initial],
    getShopifyOrders: async () => [{
      id: 'gid://shopify/Order/fixture',
      name: '#2007',
      createdAt: '2026-08-27T10:01:00.000Z',
      totalAmount: 29.99,
      currencyCode: 'EUR',
      customerName: 'Persona Fixture',
      customerPhone: incident.phone,
      products: [{ title: 'Producto Fixture', quantity: 1 }]
    }],
    claim: async () => ({ acquired: true }),
    getDelivery: async () => null,
    finish: async (value) => { finished.push(value); return { ok: true }; },
    send: async (value) => { sent.push(value); return { message_id: 'wamid.DISCOUNT_FIXTURE' }; }
  };
  return { incident, order, dependencies, sent, finished };
}

test('sends exactly once after 24 hours with name, product and current total minus 5 EUR', async () => {
  const data = fixture();
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    messages: [initial],
    realEnabled: true,
    now: Date.parse('2026-08-29T08:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.status, 'sent');
  assert.equal(result.verified, true);
  assert.equal(result.discountAmountEur, 5);
  assert.equal(data.sent.length, 1);
  assert.equal(data.sent[0].content.params['BODY_{{1}}'], 'Persona');
  assert.equal(data.sent[0].content.params['BODY_{{2}}'], 'Producto Fixture');
  assert.match(data.sent[0].content.params['BODY_{{3}}'], /24,99/);
  assert.equal(data.finished.length, 1);
  assert.equal(data.finished[0].raw.discountAmountEur, 5);
  assert.equal(data.finished[0].raw.originalAmount, 29.99);
  assert.equal(data.finished[0].raw.finalAmount, 24.99);
});

test('does not send before 24 hours or after any customer interaction', async () => {
  const early = fixture();
  const earlyResult = await processIncidentDiscountRecovery({
    incident: early.incident,
    order: early.order,
    realEnabled: true,
    now: Date.parse('2026-08-29T07:59:59.000Z'),
    dependencies: early.dependencies
  });
  assert.equal(earlyResult.reason, 'waiting_discount_window');
  assert.equal(early.sent.length, 0);

  const replied = fixture();
  replied.dependencies.getTemplate = async () => {
    throw new Error('catalogue quota must not mask a definitive customer interaction');
  };
  replied.dependencies.getMessages = async () => [
    initial,
    { direction: 'inbound', created_at: '2026-08-28T09:00:00.000Z', text: 'Cualquier respuesta' }
  ];
  const repliedResult = await processIncidentDiscountRecovery({
    incident: replied.incident,
    order: replied.order,
    realEnabled: true,
    now: Date.parse('2026-08-29T09:00:00.000Z'),
    dependencies: replied.dependencies
  });
  assert.equal(repliedResult.reason, 'customer_interaction_after_merchandise_template');
  assert.equal(replied.sent.length, 0);
});

test('uses an older verified batch snapshot to skip an ineligible case without another Chatby read', async () => {
  const data = fixture();
  data.incident.chatbyReadAt = '2026-08-28T08:01:00.000Z';
  let reads = 0;
  data.dependencies.getMessages = async () => {
    reads += 1;
    throw new Error('an ineligible case must not spend another provider read');
  };
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    messages: [initial],
    realEnabled: true,
    now: Date.parse('2026-08-29T07:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.reason, 'waiting_discount_window');
  assert.equal(reads, 0);
  assert.equal(data.sent.length, 0);
});

test('performs only one fresh Chatby read when a verified batch case is eligible', async () => {
  const data = fixture();
  data.incident.chatbyReadAt = '2026-08-28T08:01:00.000Z';
  let reads = 0;
  data.dependencies.getMessages = async () => {
    reads += 1;
    return [initial];
  };
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    messages: [initial],
    realEnabled: true,
    now: Date.parse('2026-08-29T08:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.status, 'sent');
  assert.equal(reads, 1);
  assert.equal(data.sent.length, 1);
});

test('persistent claim blocks duplicates across restarts', async () => {
  const data = fixture();
  data.dependencies.claim = async () => ({
    acquired: false,
    reason: 'already_claimed',
    existing: { status: 'sent', sent_at: '2026-08-29T08:00:00.000Z' }
  });
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    realEnabled: true,
    now: Date.parse('2026-08-29T09:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.status, 'persistent_sent');
  assert.equal(result.verified, true);
  assert.equal(data.sent.length, 0);
});

test('explicit one-time authorization advances only the 24-hour timer', async () => {
  const eligible = fixture();
  const eligibleResult = await processIncidentDiscountRecovery({
    incident: eligible.incident,
    order: eligible.order,
    realEnabled: true,
    authorizedImmediate: true,
    now: Date.parse('2026-08-28T09:00:00.000Z'),
    dependencies: eligible.dependencies
  });
  assert.equal(eligibleResult.status, 'sent');
  assert.equal(eligible.sent.length, 1);
  assert.equal(eligible.finished[0].raw.mode, 'INCIDENT_DISCOUNT_AUTHORIZED_IMMEDIATE_REAL');

  const replied = fixture();
  replied.dependencies.getMessages = async () => [
    initial,
    { direction: 'inbound', created_at: '2026-08-28T08:30:00.000Z', text: 'Ya he respondido' }
  ];
  const repliedResult = await processIncidentDiscountRecovery({
    incident: replied.incident,
    order: replied.order,
    realEnabled: true,
    authorizedImmediate: true,
    now: Date.parse('2026-08-28T09:00:00.000Z'),
    dependencies: replied.dependencies
  });
  assert.equal(repliedResult.reason, 'customer_interaction_after_merchandise_template');
  assert.equal(replied.sent.length, 0);
});

test('reuses a verified same-cycle Chatby read to avoid duplicate provider reads', async () => {
  const data = fixture();
  data.incident.chatbyReadAt = new Date().toISOString();
  data.dependencies.getMessages = async () => {
    throw new Error('same-cycle snapshot should be authoritative');
  };
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    messages: [initial],
    realEnabled: true,
    authorizedImmediate: true,
    dependencies: data.dependencies
  });
  assert.equal(result.status, 'sent');
  assert.equal(data.sent.length, 1);
});

test('uses a verified persistent initial send and still performs the final no-response read', async () => {
  const data = fixture();
  data.dependencies.getMessages = async () => [];
  data.dependencies.getDelivery = async ({ templateName }) => (
    templateName.includes('mercancia')
      ? { status: 'sent', sent_at: '2026-08-28T08:00:00.000Z' }
      : null
  );
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    realEnabled: true,
    now: Date.parse('2026-08-29T08:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.status, 'sent');
  assert.equal(data.sent.length, 1);
});

test('fails closed when the persistent delivery ledger cannot be read', async () => {
  const data = fixture();
  data.dependencies.getDelivery = async () => { throw new Error('ledger unavailable'); };
  const result = await processIncidentDiscountRecovery({
    incident: data.incident,
    order: data.order,
    realEnabled: true,
    now: Date.parse('2026-08-29T08:00:00.000Z'),
    dependencies: data.dependencies
  });
  assert.equal(result.reason, 'template_delivery_ledger_read_failed');
  assert.equal(data.sent.length, 0);
});

test('exposes one shared template warm-up entry point for an incident batch', () => {
  assert.equal(typeof warmIncidentDiscountTemplateCache, 'function');
});


test('fresh Dropea state blocks a discount if delivery, identity or rejection changed', async () => {
  for (const patch of [
    { order: { orderId:'1357848',status:'DELIVERED',customerPhone:'600000001' } },
    { issue: { id:'1252293',order_id:'1357848',status:'RESOLVED',is_active:false,type:'REFUSED_BY_RECIPIENT' } },
    { issue: { id:'1252293',order_id:'999',status:'PENDING',is_active:true,type:'REFUSED_BY_RECIPIENT' } }
  ]) {
    const data=fixture();const current=await data.dependencies.readCurrent();
    data.dependencies.readCurrent=async()=>({...current,...patch});
    const result=await processIncidentDiscountRecovery({...data,realEnabled:true,now:Date.parse('2026-08-30T08:00:00Z')});
    assert.equal(result.reason,'dropea_pre_send_state_changed');assert.equal(data.sent.length,0);
  }
});
test('a verified prior return prevents a new discount, and a failed fresh read fails closed', async () => {
  for (const reason of ['order_return_already_requested','dropea_pre_send_read_failed']) {
    const data=fixture();
    if(reason==='order_return_already_requested')data.dependencies.inspectPrior=async()=>({verified:true,priorIncidenceId:'51'});
    else data.dependencies.readCurrent=async()=>{throw Error('offline');};
    const result=await processIncidentDiscountRecovery({...data,realEnabled:true,now:Date.parse('2026-08-30T08:00:00Z')});
    assert.equal(result.reason,reason);assert.equal(data.sent.length,0);
  }
});

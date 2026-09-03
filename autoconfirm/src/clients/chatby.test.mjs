import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CHATBY_TOKEN = 'test-token';
process.env.CHATBY_BASE_URL = 'https://chatby.test/api';
process.env.CHATBY_REQUEST_MIN_INTERVAL_MS = '0';
process.env.CHATBY_READ_RETRY_BASE_MS = '1';

const {
  chatbyLifecycleTemplateOwner,
  chatbyNativeOwnsLifecycleTemplate,
  chatbyRepositoryOwnsIncidentTemplate,
  checkChatbyConnection,
  findSubscribersByPhone,
  findSubscriberInIndexForExactOrder,
  findSubscriberInIndexForOrder,
  getChatMessages,
  invalidateSubscriberIndexCache,
  sendWhatsappTemplate
} = await import('./chatby.mjs');

test('reports the single lifecycle owner without exposing credentials', () => {
  const previousOwner = process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
  const previousIncidentOwner = process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
  try {
    process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = ' chatby_native ';
    delete process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
    assert.equal(chatbyLifecycleTemplateOwner(), 'chatby_native');
    assert.equal(chatbyNativeOwnsLifecycleTemplate('es_ES dropea_pedido_nuevo_v1'), false);
    assert.equal(chatbyNativeOwnsLifecycleTemplate('es_ES dropea_pedido_preparado_v1'), true);
    assert.equal(chatbyNativeOwnsLifecycleTemplate('es_ES dropea_incidencia_mercancia_v1'), true);
    assert.equal(chatbyNativeOwnsLifecycleTemplate('dropea_incidencia_descuento_5_v1'), false);
  } finally {
    if (previousOwner === undefined) delete process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
    else process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = previousOwner;
    if (previousIncidentOwner === undefined) delete process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
    else process.env.CHATBY_INCIDENT_TEMPLATE_OWNER = previousIncidentOwner;
  }
});

test('incident sender ownership can be restored without changing prepared-order ownership', () => {
  const previousOwner = process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
  const previousIncidentOwner = process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
  try {
    process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = 'chatby_native';
    process.env.CHATBY_INCIDENT_TEMPLATE_OWNER = 'repository';
    assert.equal(chatbyRepositoryOwnsIncidentTemplate(), true);
    assert.equal(chatbyNativeOwnsLifecycleTemplate('es_ES dropea_pedido_preparado_v1'), true);
    assert.equal(chatbyNativeOwnsLifecycleTemplate('es_ES dropea_incidencia_mercancia_v1'), false);
  } finally {
    if (previousOwner === undefined) delete process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
    else process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = previousOwner;
    if (previousIncidentOwner === undefined) delete process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
    else process.env.CHATBY_INCIDENT_TEMPLATE_OWNER = previousIncidentOwner;
  }
});

test('incident repository ownership is fail-closed unless explicitly configured', () => {
  const previousIncidentOwner = process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
  try {
    delete process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
    assert.equal(chatbyRepositoryOwnsIncidentTemplate(), false);
    process.env.CHATBY_INCIDENT_TEMPLATE_OWNER = 'chatby_native';
    assert.equal(chatbyRepositoryOwnsIncidentTemplate(), false);
  } finally {
    if (previousIncidentOwner === undefined) delete process.env.CHATBY_INCIDENT_TEMPLATE_OWNER;
    else process.env.CHATBY_INCIDENT_TEMPLATE_OWNER = previousIncidentOwner;
  }
});

test('exact incident lookup accepts only the explicit Dropea order field', () => {
  const explicit = {
    phone: '+34600000000',
    user_fields: [{ name: 'Dropea: Numero', value: 'current-order' }]
  };
  const incidental = {
    phone: '+34600000000',
    notes: 'current-order',
    user_fields: [{ name: 'Dropea: Numero', value: 'older-order' }]
  };
  const index = { byPhone: new Map([['600000000', [incidental, explicit]]]) };
  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: 'current-order'
  }), explicit);
  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: 'missing-order'
  }), null);
});

test('exact incident lookup treats the Chatby ES prefix as the same Dropea order', () => {
  const current = {
    phone: '+34600000000',
    user_fields: [{ name: 'Dropea: Número', value: 'ES1381873' }]
  };
  const other = {
    phone: '+34600000000',
    user_fields: [{ name: 'Dropea: Número', value: 'ES1381874' }]
  };
  const index = { byPhone: new Map([['600000000', [other, current]]]) };

  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: '1381873'
  }), current);
  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: '138187'
  }), null);
  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000001', orderId: '1381873'
  }), null);
});

test('exact incident lookup accepts the live Chatby #Pedido field without falling back to phone only', () => {
  const current = {
    phone: '+34600000000',
    user_fields: [
      { name: '#Pedido', value: '1381873' },
      { name: 'Incidencia: Motivo', value: 'fixture' }
    ]
  };
  const older = {
    phone: '+34600000000',
    user_fields: [{ name: '#Pedido', value: '1370000' }]
  };
  const index = { byPhone: new Map([['600000000', [older, current]]]) };

  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: '1381873'
  }), current);
  assert.equal(findSubscriberInIndexForExactOrder(index, {
    phone: '+34600000000', orderId: '1381874'
  }), null);
});

test('strict order lookup never reuses a confirmed subscriber from another order', () => {
  const subscriber = {
    phone: '+34600000000',
    lead_status: 'CONFIRMADO',
    user_fields: [{ name: 'Dropea: Numero', value: 'older-order' }]
  };
  const index = { byPhone: new Map([['600000000', [subscriber]]]) };

  assert.equal(findSubscriberInIndexForOrder(index, {
    phone: '+34600000000',
    orderId: 'current-order',
    allowConfirmedPhoneFallback: false
  }), null);
  assert.equal(findSubscriberInIndexForOrder(index, {
    phone: '+34600000000',
    orderId: 'current-order'
  })?.lead_status, 'CONFIRMADO');
});

test('returns every Chatby conversation for a phone so delivery checks cannot miss an older thread', async () => {
  const originalFetch = globalThis.fetch;
  invalidateSubscriberIndexCache();
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      { user_ns: 'thread-current', phone: '+34 600 000 000' },
      { user_ns: 'thread-older', user_id: '0034600000000' },
      { user_ns: 'other-phone', phone: '+34 600 000 001' }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const subscribers = await findSubscribersByPhone({ phone: '600 000 000', maxPages: 1 });
    assert.deepEqual(subscribers.map((item) => item.user_ns), ['thread-current', 'thread-older']);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateSubscriberIndexCache();
  }
});

test('never retries a template delivery after a rate-limit response', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.001' }
        })
      : new Response(JSON.stringify({ ok: true, mid: 'wamid.should-not-exist' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
  };

  try {
    await assert.rejects(
      sendWhatsappTemplate({
        user_ns: 'test-user',
        user_id: 'test-recipient',
        content: { name: 'dropea_pedido_nuevo_v1', lang: 'es_ES', params: {} }
      }),
      /429/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps bounded retries for read-only Chatby requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.001' }
        })
      : new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
  };

  try {
    assert.deepEqual(await getChatMessages('test-user'), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a read-only Chatby timeout but never exceeds the attempt bound', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('fixture timeout');
      error.name = 'AbortError';
      throw error;
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    assert.deepEqual(await getChatMessages('test-user'), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a transient Chatby 503 only for read-only requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      : new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
  };

  try {
    assert.deepEqual(await getChatMessages('test-user'), []);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('blocks every repository path for Chatby-owned lifecycle templates', async () => {
  const originalFetch = globalThis.fetch;
  const previousOwner = process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
  let calls = 0;
  process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = 'chatby_native';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    for (const name of [
      'dropea_pedido_preparado_v1',
      'dropea_incidencia_mercancia_v1'
    ]) {
      await assert.rejects(
        sendWhatsappTemplate({
          user_ns: 'test-user',
          user_id: 'test-recipient',
          content: { name, lang: 'es_ES', params: {} }
        }),
        (error) => error?.code === 'CHATBY_NATIVE_LIFECYCLE_TEMPLATE_OWNER'
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOwner === undefined) delete process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
    else process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = previousOwner;
  }
});

test('allows the repository to request the initial order template through Chatby', async () => {
  const originalFetch = globalThis.fetch;
  const previousOwner = process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
  let calls = 0;
  process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = 'chatby_native';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, mid: 'wamid.initial' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await sendWhatsappTemplate({
      user_ns: 'test-user',
      user_id: 'test-recipient',
      content: { name: 'dropea_pedido_nuevo_v1', lang: 'es_ES', params: {} }
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOwner === undefined) delete process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
    else process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = previousOwner;
  }
});

test('does not block unrelated templates when Chatby owns lifecycle sends', async () => {
  const originalFetch = globalThis.fetch;
  const previousOwner = process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
  let calls = 0;
  process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = 'chatby_native';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, mid: 'wamid.allowed' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await sendWhatsappTemplate({
      user_ns: 'test-user',
      user_id: 'test-recipient',
      content: { name: 'suleia_otro_aviso_v1', lang: 'es_ES', params: {} }
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOwner === undefined) delete process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER;
    else process.env.CHATBY_LIFECYCLE_TEMPLATE_OWNER = previousOwner;
  }
});

test('a long Chatby Retry-After fails fast and does not block the automation queue', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '6' }
    });
  };

  try {
    const startedAt = Date.now();
    await assert.rejects(checkChatbyConnection(), /429/);
    await assert.rejects(
      getChatMessages('test-user'),
      (error) => error?.code === 'CHATBY_RATE_LIMITED'
    );
    assert.equal(calls, 1);
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

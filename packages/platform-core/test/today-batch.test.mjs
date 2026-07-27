import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDayBounds, isWithinBusinessDay } from '../src/business-day.mjs';
import { collectPaginated, createReadOnlyTransport } from '../src/read-only-transport.mjs';
import { containsDirectPii, maskRecord } from '../src/masking.mjs';
import { runTodayBatch } from '../src/today-batch.mjs';

test('Europe/Madrid business day uses exact summer UTC boundaries', () => {
  const bounds = businessDayBounds({ businessDate: '2026-07-27', timeZone: 'Europe/Madrid' });
  assert.equal(bounds.utc_start, '2026-07-26T22:00:00.000Z');
  assert.equal(bounds.utc_end_exclusive, '2026-07-27T22:00:00.000Z');
  assert.equal(bounds.duration_hours, 24);
  assert.equal(isWithinBusinessDay(bounds.utc_start, bounds), true);
  assert.equal(isWithinBusinessDay('2026-07-27T21:59:59.999Z', bounds), true);
  assert.equal(isWithinBusinessDay(bounds.utc_end_exclusive, bounds), false);
});

test('Europe/Madrid business day handles winter and DST durations', () => {
  const winter = businessDayBounds({ businessDate: '2026-01-15', timeZone: 'Europe/Madrid' });
  assert.equal(winter.utc_start, '2026-01-14T23:00:00.000Z');
  assert.equal(winter.utc_end_exclusive, '2026-01-15T23:00:00.000Z');
  const spring = businessDayBounds({ businessDate: '2026-03-29', timeZone: 'Europe/Madrid' });
  assert.equal(spring.duration_hours, 23);
  const autumn = businessDayBounds({ businessDate: '2026-10-25', timeZone: 'Europe/Madrid' });
  assert.equal(autumn.duration_hours, 25);
});

test('read-only transport blocks every mutating method before fetch', async () => {
  let calls = 0;
  const transport = createReadOnlyTransport({
    allowedHosts: ['example.test'],
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}');
    }
  });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(() => transport('https://example.test/orders', { method }), {
      code: 'WRITE_METHOD_BLOCKED'
    });
  }
  await assert.rejects(() => transport('https://example.test/orders', { method: 'GET', body: '{}' }), {
    code: 'REQUEST_BODY_BLOCKED'
  });
  assert.equal(calls, 0);
});

test('pagination detects repeated pages and never declares completeness', async () => {
  const result = await collectPaginated({
    firstCursor: 1,
    maxPages: 10,
    fetchPage: async (cursor) => ({
      items: [{ id: 'same' }],
      next_cursor: Number(cursor) + 1
    })
  });
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'REPEATED_PAGE');
  assert.equal(result.page_count, 1);
});

test('masking redacts sensitive keys and free-text identifiers', () => {
  const masked = maskRecord({
    customer_name: 'Example Person',
    phone: '+34612345678',
    email: 'person@example.com',
    address: 'Street 1',
    notes: 'IBAN ES9121000418450200051332 and DNI 12345678Z'
  });
  assert.equal(containsDirectPii(masked), false);
  assert.equal(masked.customer_name, '[NAME REDACTED]');
  assert.equal(masked.phone, '*** *** 678');
  assert.equal(masked.notes, '[FREE TEXT REDACTED]');
});

test('today batch masks before persistence, uses current clock and executes zero actions', () => {
  const bounds = businessDayBounds({ businessDate: '2026-07-27', timeZone: 'Europe/Madrid' });
  const report = runTodayBatch({
    bounds,
    now: new Date('2026-07-27T10:30:00.000Z'),
    sourceStatus: {
      shopify: { consultable: true, complete: true, page_count: 1 },
      chatby: { consultable: true, complete: true, page_count: 1 },
      dropea: { consultable: false, complete: false, error: 'POST_BLOCKED', page_count: 0 },
      gls: { consultable: false, complete: false, error: 'POST_BLOCKED', page_count: 0 }
    },
    sourceOrders: [{
      identity_key: 'SHOPIFY:123',
      identity_references: ['123', 'S-100'],
      created_at: '2026-07-27T08:00:00.000Z',
      updated_at: '2026-07-27T08:10:00.000Z',
      status: 'PENDING',
      financial_status: 'PENDING',
      fulfillment_status: 'UNFULFILLED',
      currency: 'EUR',
      item_count: 1,
      raw_ephemeral: {
        customer_name: 'Example Person',
        phone: '+34612345678',
        email: 'person@example.com'
      },
      chatby_signal: {
        intent: 'CONFIRM',
        occurred_at: '2026-07-27T10:00:00.000Z',
        evidence_type: 'CHATBY_INBOUND_SEMANTIC'
      }
    }],
    currentSystemOrders: [{
      identity_references: ['S-100'],
      action: 'WAIT_CONFIRMATION_WINDOW',
      status: 'PENDING'
    }]
  });
  assert.equal(report.batch.status, 'INCOMPLETE');
  assert.equal(report.batch.total_actions_executed, 0);
  assert.equal(report.batch.pii_persisted_count, 0);
  assert.equal(report.orders[0].masked_order_id, 'TODAY-MASKED-0001');
  assert.equal(report.orders[0].proposed_action, 'WAIT_CONFIRMATION_WINDOW');
  assert.equal(report.orders[0].timer_status, 'ACTIVE');
  assert.equal(report.orders[0].route, 'BLOCKED');
  assert.ok(report.orders[0].blocking_reasons.includes('BATCH_SOURCE_INCOMPLETE'));
  assert.equal(containsDirectPii(report), false);
  assert.doesNotMatch(JSON.stringify(report), /Example Person|612345678|person@example\.com/);
});

test('orders at next-day boundary are excluded', () => {
  const bounds = businessDayBounds({ businessDate: '2026-07-27', timeZone: 'Europe/Madrid' });
  const preview = runTodayBatch({
    bounds,
    preview: true,
    sourceStatus: { shopify: { consultable: true, complete: true, page_count: 1 } },
    sourceOrders: [
      { identity_key: 'inside', created_at: '2026-07-27T21:59:59.999Z' },
      { identity_key: 'outside', created_at: '2026-07-27T22:00:00.000Z' }
    ]
  });
  assert.equal(preview.estimated_orders, 1);
  assert.equal(preview.outside_interval_rejected, 1);
});

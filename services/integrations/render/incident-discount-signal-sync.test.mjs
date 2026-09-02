import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRenderIncidentDiscountSignal,
  syncRenderIncidentDiscountSignals
} from './incident-discount-signal-sync.mjs';

const row = (overrides = {}, rowOverrides = {}) => ({
  incidence_id: '1252293', order_id: '1355049', updated_at: '2026-09-02T12:00:00Z',
  ...rowOverrides,
  raw: {
    incidenceId: '1252293', orderId: '1355049', incidentType: 'rejected_goods',
    incidentDiscountRecoveryStatus: 'already_sent',
    incidentDiscountSentAt: '2026-09-01T10:00:00Z', incidentDiscountVerified: true,
    incidentDiscountResponseStatus: 'DISCOUNT_ACCEPTED',
    incidentDiscountRespondedAt: '2026-09-01T11:00:00Z',
    incidentDiscountOriginalPrice: 29.99, incidentDiscountFinalPrice: 24.99,
    incidentDiscountAmountEur: 5, incidentDiscountCrossSourceVerified: true,
    ...overrides
  }
});

test('acceptance requires exact incident linkage, verified delivery and a later reply', () => {
  const result = normalizeRenderIncidentDiscountSignal(row());
  assert.equal(result.response_status, 'DISCOUNT_ACCEPTED');
  assert.equal(result.delivery_verified, true);
  assert.equal(result.discount_amount, 5);
  assert.equal(result.responded_at, '2026-09-01T11:00:00.000Z');
  assert.equal(normalizeRenderIncidentDiscountSignal(row({ incidenceId: 'other' })), null);
  assert.equal(normalizeRenderIncidentDiscountSignal(row({ incidentType: 'address' })), null);
});

test('unverified, early and excessive values fail closed without inventing acceptance', () => {
  const unverified = normalizeRenderIncidentDiscountSignal(row({ incidentDiscountVerified: false }));
  assert.equal(unverified.response_status, 'NOT_VERIFIABLE');
  assert.equal(unverified.responded_at, null);
  const early = normalizeRenderIncidentDiscountSignal(row({ incidentDiscountRespondedAt: '2026-09-01T09:59:59Z' }));
  assert.equal(early.response_status, 'NOT_VERIFIABLE');
  const excessive = normalizeRenderIncidentDiscountSignal(row({ incidentDiscountAmountEur: 6 }));
  assert.equal(excessive.discount_amount, null);
});

test('sync projects only eligible rejected-goods signals and reports unmatched records', async () => {
  const pages = [[row(), row(
    { incidenceId: '1252294', orderId: '1355050', incidentDiscountResponseStatus: 'NO_RESPONSE', incidentDiscountRespondedAt: null },
    { incidence_id: '1252294', order_id: '1355050' }
  )], []];
  let pageIndex = 0;
  const projected = [];
  const result = await syncRenderIncidentDiscountSignals({
    source: { page: async () => ({ rows: pages[pageIndex++], missing: false }) },
    projector: { upsertIncidentDiscountRecoverySignal: async (signal) => {
      projected.push(signal); return { matched: signal.dropea_issue_id === '1252293' };
    } },
    pageSize: 2
  });
  assert.equal(result.seen, 2);
  assert.equal(result.eligible, 2);
  assert.equal(result.projected, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(projected[1].response_status, 'NO_RESPONSE');
});

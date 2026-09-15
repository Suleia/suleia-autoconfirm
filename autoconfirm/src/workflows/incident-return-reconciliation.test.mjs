import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticIncidentReturnReconciliationDue, executeIncidentDiscountNoResponseReturn } from './incidents.mjs';

test('reconciles only stale persistent claims or old transient action failures', () => {
  const current = Date.parse('2026-07-16T17:00:00.000Z');
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:45:00.000Z' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'reconciliation_claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_503' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_400' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'applied_unverified', attempted_at: '2026-07-16T16:00:00.000Z' }, { now: current }), false);
});

test('an automatic cycle atomically reclaims one stale claim and calls Dropea once', async () => {
  let reclaimed = 0;
  let returned = 0;
  const result = await executeIncidentDiscountNoResponseReturn({
    incidenceId: 'fixture-stale-claim',
    orderId: 'fixture-order',
    incidentType: 'rejected_goods',
    chatbyUserNs: 'fixture-chat',
    chatbyReadVerified: true
  }, {
    templateName: 'fixture-discount',
    sentAt: '2026-07-15T16:00:00.000Z',
    verified: true,
    responseStatus: 'NO_RESPONSE'
  }, {
    now: Date.parse('2026-07-16T17:00:00.000Z'),
    realEnabled: true,
    automaticEnabled: true,
    credentialAvailable: true,
    readCurrent: async () => ({ issue: { status: 'PENDING', raw: { status: 'PENDING', is_active: true, allowed_resolution_options: ['RETURN_REQUESTED'] } } }),
    readMessages: async () => [],
    claimReturn: async () => ({ acquired: false, persistent: true, reason: 'already_claimed', existing: { status: 'claimed', attempted_at: '2026-07-16T16:29:00.000Z' } }),
    reclaimReturn: async ({ expectedStatus }) => { reclaimed += 1; assert.equal(expectedStatus, 'claimed'); return { acquired: true, persistent: true }; },
    returnIssue: async () => { returned += 1; return { status: 'RESOLVED', resolution_status: 'RETURN_REQUESTED' }; },
    verifyReturn: async () => ({ verified: true }),
    finishReturn: async () => null,
    auditReturn: async () => null
  });
  assert.equal(result.status, 'RETURN_REQUESTED_VERIFIED');
  assert.equal(reclaimed, 1);
  assert.equal(returned, 1);
});


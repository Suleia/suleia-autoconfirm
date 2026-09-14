import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticIncidentReturnReconciliationDue } from './incidents.mjs';

test('reconciles only stale persistent claims or old transient action failures', () => {
  const current = Date.parse('2026-07-16T17:00:00.000Z');
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'claimed', attempted_at: '2026-07-16T16:45:00.000Z' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'reconciliation_claimed', attempted_at: '2026-07-16T16:29:00.000Z' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_503' }, { now: current }), true);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'manual_reconciliation_required', attempted_at: '2026-07-16T16:29:00.000Z', last_error: 'DROPEA_V2_ISSUE_ACTION_HTTP_400' }, { now: current }), false);
  assert.equal(automaticIncidentReturnReconciliationDue({ status: 'applied_unverified', attempted_at: '2026-07-16T16:00:00.000Z' }, { now: current }), false);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGlsDeliveryDate } from '../src/incident/gls-calendar.mjs';
import { createIncidentTimer } from '../src/incident/incident-timers.mjs';
import { prepareDiscountEmailDraft, prepareDiscountOffer } from '../src/incident/discount-workflow.mjs';
import { simulateIncidentProcess } from '../src/incident/incident-processor.mjs';
import { GLS_POLICY_IDS } from '../src/incident/gls-policies.mjs';

const AT = new Date('2026-08-03T12:00:00.000Z');
const base = (overrides = {}) => ({
  market: 'ES',
  sourceEventId: 'event-fixture',
  identity: { status: 'EXACT' },
  order: { canonical_order_id: 'order-fixture', total_amount: 29.99 },
  issue: {
    canonical_issue_id: 'issue-fixture', carrier: 'GLS', type: 'RECIPIENT_ABSENT',
    status: 'PENDING', is_active: true, allowed_resolution_options: ['RETRY', 'RETURN_REQUESTED'],
    updated_at: '2026-08-03T10:00:00.000Z'
  },
  chatby: { customer_response_status: 'NO_RESPONSE', intent: 'UNKNOWN', fresh: true, contradiction_status: 'NONE' },
  gls: { delivery_attempt_number: 1 },
  ...overrides
});

test('GLS calendar never promises same day or next day after cutoff', () => {
  assert.deepEqual(GLS_POLICY_IDS, Array.from({ length: 18 }, (_, index) => `GLS-${String(index + 1).padStart(2, '0')}`));
  const before = evaluateGlsDeliveryDate({ now: new Date('2026-08-03T12:00:00Z') });
  const after = evaluateGlsDeliveryDate({ now: new Date('2026-08-03T16:30:00Z') });
  assert.equal(before.earliest_operational_date, '2026-08-04');
  assert.equal(after.earliest_operational_date, '2026-08-05');
  assert.equal(after.guarantee, false);
  const friday = evaluateGlsDeliveryDate({ now: new Date('2026-08-07T16:30:00Z') });
  assert.equal(friday.earliest_operational_date, '2026-08-11');
});

test('incident timer is versioned, independent, stable and supersedes an older issue version', () => {
  const input = { orderId: 'o', issueId: 'i', issueVersion: 'v1', relevantEventId: 'e1', policyVersion: 'p1', startedAt: '2026-08-03T10:00:00Z' };
  const first = createIncidentTimer(input);
  const duplicate = createIncidentTimer(input);
  const next = createIncidentTimer({ ...input, issueVersion: 'v2', relevantEventId: 'e2', previousTimer: first });
  assert.equal(first.timer_id, duplicate.timer_id);
  assert.equal(first.due_at, '2026-08-05T10:00:00.000Z');
  assert.equal(next.supersedes, first.timer_id);
  assert.equal(first.actions_executed, 0);
});

test('absent with current receive evidence prepares an allowed RETRY simulation', () => {
  const result = simulateIncidentProcess(base({
    chatby: { customer_response_status: 'RESPONDED', intent: 'RECEIVE', fresh: true, contradiction_status: 'NONE', requested_time_window: 'afternoon' }
  }), { now: AT });
  assert.equal(result.proposed_resolution, 'RETRY');
  assert.equal(result.proposed_payload.resolution_data.time_window, 'afternoon');
  assert.equal(result.actions_executed, 0);
  assert.equal(result.issues_resolved, 0);
});

test('a resolution not exposed by Dropea is blocked for human review', () => {
  const result = simulateIncidentProcess(base({
    issue: { ...base().issue, allowed_resolution_options: [] },
    chatby: { customer_response_status: 'RESPONDED', intent: 'RECEIVE', fresh: true, contradiction_status: 'NONE' }
  }), { now: AT });
  assert.equal(result.process_status, 'HUMAN_REVIEW');
  assert.equal(result.proposed_resolution, null);
  assert.ok(result.blocking_reasons.includes('PROPOSED_RESOLUTION_NOT_ALLOWED'));
});

test('inactive or non-pending issue is recorded and closed without processing', () => {
  const result = simulateIncidentProcess(base({ issue: { ...base().issue, is_active: false } }), { now: AT });
  assert.equal(result.process_status, 'RECORDED_CLOSED');
  assert.equal(result.actions_executed, 0);
});

test('refusal without response prepares but never sends a strict 5 EUR offer', () => {
  const result = simulateIncidentProcess(base({
    issue: { ...base().issue, type: 'REFUSED_BY_RECIPIENT' },
    chatby: { customer_response_status: 'NO_RESPONSE', intent: 'UNKNOWN', fresh: true, contradiction_status: 'NONE' }
  }), { now: AT });
  assert.equal(result.discount.status, 'OFFER_PREPARED');
  assert.equal(result.discount.discount_amount, 5);
  assert.equal(result.discount.email_sent, false);
  assert.equal(result.discounts_applied, 0);
});

test('explicit refusal proposes return and never prepares a discount', () => {
  const result = simulateIncidentProcess(base({
    issue: { ...base().issue, type: 'REFUSED_BY_RECIPIENT' },
    chatby: { customer_response_status: 'RESPONDED', intent: 'RETURN', rejection_explicit: true, fresh: true, contradiction_status: 'NONE' }
  }), { now: AT });
  assert.equal(result.proposed_resolution, 'RETURN_REQUESTED');
  assert.equal(result.discount, null);
});

test('email draft is deterministic, sanitized and remains unsent until COD verification', () => {
  const offer = prepareDiscountOffer({ orderId: 'order-fixture', originalAmount: 29.99, reason: 'REFUSED_NO_RESPONSE', createdAt: AT });
  const input = { offer, dropeaOrderId: '24', customerAcceptanceMessageIdHash: 'a'.repeat(64), acceptedAt: AT, createdAt: AT };
  const first = prepareDiscountEmailDraft(input);
  const second = prepareDiscountEmailDraft(input);
  assert.equal(first.draft_hash, second.draft_hash);
  assert.equal(first.discount_amount, 5);
  assert.equal(first.email_prepared, true);
  assert.equal(first.email_sent, false);
  assert.equal(first.ready_for_retry, false);
  assert.equal(first.actions_executed, 0);
});

test('address proposal never exposes the supplied address in the durable simulation', () => {
  const result = simulateIncidentProcess(base({
    issue: { ...base().issue, type: 'ADDRESS_INCORRECT', allowed_resolution_options: ['CHANGE_ADDRESS'] },
    chatby: {
      customer_response_status: 'RESPONDED', intent: 'CHANGE_ADDRESS', fresh: true,
      contradiction_status: 'NONE', address_validated: true,
      supplied_address: { street: 'Fixture Street', postal_code: '28000', city: 'Fixture City', country: 'ES' }
    }
  }), { now: AT });
  assert.equal(result.proposed_payload.ephemeral_rebuild_required, true);
  assert.equal(result.proposed_payload.resolution_data.address.street, '[ADDRESS REDACTED]');
  assert.doesNotMatch(JSON.stringify(result), /Fixture Street|28000/);
});

test('partial identity, stale Chatby or unverified GLS solution support blocks', () => {
  const partial = simulateIncidentProcess(base({ identity: { status: 'PARTIAL' } }), { now: AT });
  assert.ok(partial.blocking_reasons.includes('IDENTITY_NOT_EXACT_OR_VERIFIED'));
  const pendingData = simulateIncidentProcess(base({
    issue: { ...base().issue, type: 'PENDING_DATA', allowed_resolution_options: ['PROVIDE_SOLUTION'] },
    chatby: { customer_response_status: 'RESPONDED', intent: 'PROVIDE_DATA', fresh: true, contradiction_status: 'NONE', required_data_validated: true, solution_note_sanitized: 'Fixture safe note' }
  }), { now: AT });
  assert.ok(pendingData.blocking_reasons.includes('RUNTIME_UNVERIFIED_FOR_GLS_ES'));
});

test('TIPSA has no operational policy and is always blocked', () => {
  const result = simulateIncidentProcess(base({ issue: { ...base().issue, carrier: 'TIPSA' } }), { now: AT });
  assert.ok(result.blocking_reasons.includes('CARRIER_POLICY_NOT_GLS'));
  assert.equal(result.actions_executed, 0);
});

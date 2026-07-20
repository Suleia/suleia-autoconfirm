import assert from 'node:assert/strict';
import test from 'node:test';
import {
  incidentHistoryRowsForSupabase,
  incidentRowForSupabase
} from './supabase-store.mjs';

test('maps the current carrier incident and preserves its complete history', () => {
  const incident = {
    incidenceId: '1159554',
    orderId: '1290754',
    carrierReason: 'DIRECCION INCORRECTA',
    carrierReasonCode: 'WRONG_ADDRESS',
    carrierAnnotatedAt: '2026-07-13T10:14:22.000Z',
    carrierObservation: 'esta mal',
    carrierLastUpdatedAt: '2026-07-13T10:14:22.000Z',
    carrierIncidenceId: '1159554',
    carrierIncidentHistory: [
      {
        incidenceId: '1159508',
        reasonCode: 'ABSENT',
        reason: 'AUSENTE',
        annotatedAt: '2026-07-13T08:37:47.000Z',
        observation: '',
        resolved: true,
        lastUpdatedAt: '2026-07-13T08:37:47.000Z'
      },
      {
        incidenceId: '1159554',
        reasonCode: 'WRONG_ADDRESS',
        reason: 'DIRECCION INCORRECTA',
        annotatedAt: '2026-07-13T10:14:22.000Z',
        observation: 'esta mal',
        resolved: false,
        lastUpdatedAt: '2026-07-13T10:14:22.000Z'
      }
    ]
  };

  const current = incidentRowForSupabase(incident);
  const history = incidentHistoryRowsForSupabase(incident);

  assert.equal(current.carrier_reason, 'DIRECCION INCORRECTA');
  assert.equal(current.carrier_reason_code, 'WRONG_ADDRESS');
  assert.equal(current.carrier_observation, 'esta mal');
  assert.equal(current.carrier_incidence_id, '1159554');
  assert.equal(current.carrier_annotated_at, '2026-07-13T10:14:22.000Z');
  assert.equal(current.carrier_last_updated_at, '2026-07-13T10:14:22.000Z');
  assert.equal(history.length, 2);
  assert.equal(history[0].reason, 'AUSENTE');
  assert.equal(history[1].reason, 'DIRECCION INCORRECTA');
  assert.equal(history[1].observation, 'esta mal');
});

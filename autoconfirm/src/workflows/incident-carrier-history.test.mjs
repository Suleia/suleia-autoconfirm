import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carrierIncidentDisplay,
  parseDropeaCarrierHistory,
  selectCurrentDropeaCarrierIncident
} from './incident-carrier-history.mjs';

test('selects the newest unresolved Dropea carrier incident and keeps history', () => {
  const history = parseDropeaCarrierHistory({ incidences: [
    { I_ID: 10, D_FEC_HORA_ALTA: '19/07/2026 11:00:00', V_COD_TIPO_INC: 'AUSENTE', T_OBS: 'No estaba', B_RESUELTA: true },
    { I_ID: 11, D_FEC_HORA_ALTA: '20/07/2026 12:09:41', V_COD_TIPO_INC: 'NO ACEPTA EXPEDICION', T_OBS: 'dice no Aver pedido nada', B_RESUELTA: false }
  ] });
  assert.equal(history.length, 2);
  const current = selectCurrentDropeaCarrierIncident(history);
  assert.equal(current.incidenceId, '11');
  assert.equal(current.reason, 'NO ACEPTA EXPEDICION');
  assert.equal(current.observation, 'dice no Aver pedido nada');
});

test('always prefers the newest unresolved incidence over a stale active id', () => {
  const history = parseDropeaCarrierHistory({ incidences: [
    { I_ID: 20, D_FEC_HORA_ALTA: '20/07/2026 09:22:21', V_COD_TIPO_INC: 'FALTAN DATOS', B_RESUELTA: false },
    { I_ID: 21, D_FEC_HORA_ALTA: '20/07/2026 10:22:21', V_COD_TIPO_INC: 'AUSENTE', B_RESUELTA: false }
  ] });
  assert.equal(selectCurrentDropeaCarrierIncident(history, 20).reason, 'AUSENTE');
});

test('parses nested Dropea response shapes and converts Madrid local time exactly', () => {
  const history = parseDropeaCarrierHistory({ data: { result: { incidences: [
    { I_ID: 50, D_FEC_HORA_ALTA: '20/07/2026 09:22:21', V_COD_TIPO_INC: 'FALTAN DATOS', B_RESUELTA: false }
  ] } } });
  assert.equal(history.length, 1);
  assert.equal(history[0].annotatedAt, '2026-07-20T07:22:21.000Z');
  assert.equal(history[0].annotatedAtRaw, '20/07/2026 09:22:21');
});

test('keeps the complete carrier fields used by the panel and Supabase', () => {
  const current = selectCurrentDropeaCarrierIncident(parseDropeaCarrierHistory({ data: [
    {
      I_ID: 60,
      D_FEC_HORA_ALTA: '20/07/2026 12:09:41',
      V_COD_TIPO_INC: 'NAM',
      V_DES_TIPO_INC: 'NO ACEPTA EXPEDICION',
      T_OBS: 'dice no Aver pedido nada',
      B_RESUELTA: false,
      ACT: [{ I_ID: 61, D_FEC_HORA_ALTA: '20/07/2026 12:10:00', V_DES_TIPO_ACTU: 'ANOTACION' }]
    }
  ] }));
  const display = carrierIncidentDisplay(current);
  assert.deepEqual({
    id: display.incidenceId,
    reason: display.reason,
    code: display.reasonCode,
    observation: display.observation,
    annotatedAt: display.annotatedAt,
    lastUpdatedAt: display.lastUpdatedAt
  }, {
    id: '60',
    reason: 'NO ACEPTA EXPEDICION',
    code: 'NAM',
    observation: 'dice no Aver pedido nada',
    annotatedAt: '2026-07-20T10:09:41.000Z',
    lastUpdatedAt: '2026-07-20T10:10:00.000Z'
  });
});

test('handles missing observations without creating null text', () => {
  const current = selectCurrentDropeaCarrierIncident(parseDropeaCarrierHistory({ incidences: [
    { I_ID: 30, D_FEC_HORA_ALTA: '20/07/2026 09:22:21', V_COD_TIPO_INC: 'FALTAN DATOS', B_RESUELTA: false }
  ] }));
  assert.equal(current.observation, null);
  assert.equal(carrierIncidentDisplay(current).reason, 'FALTAN DATOS');
});

test('preserves abbreviated or misspelled carrier observations verbatim', () => {
  const current = selectCurrentDropeaCarrierIncident(parseDropeaCarrierHistory({ incidences: [
    { I_ID: 40, D_FEC_HORA_ALTA: '14/07/2026 15:48:38', V_COD_TIPO_INC: 'FALTAN DATOS', T_OBS: 'nk ok cogeovil', B_RESUELTA: false }
  ] }));
  assert.equal(current.observation, 'nk ok cogeovil');
});

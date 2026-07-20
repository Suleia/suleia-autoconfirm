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

test('prefers the active incidence id even when another historical row is newer', () => {
  const history = parseDropeaCarrierHistory({ incidences: [
    { I_ID: 20, D_FEC_HORA_ALTA: '20/07/2026 09:22:21', V_COD_TIPO_INC: 'FALTAN DATOS', B_RESUELTA: false },
    { I_ID: 21, D_FEC_HORA_ALTA: '20/07/2026 10:22:21', V_COD_TIPO_INC: 'AUSENTE', B_RESUELTA: false }
  ] });
  assert.equal(selectCurrentDropeaCarrierIncident(history, 20).reason, 'FALTAN DATOS');
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

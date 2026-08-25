import test from 'node:test';
import assert from 'node:assert/strict';
import { addressInstructionFromText, interpretChatbyCustomerReply } from '../src/operational-truth/chatby-customer-instruction.mjs';

test('short affirmative answer inherits the exact receive question intent', () => {
  const result = interpretChatbyCustomerReply({
    customerText: 'Sí',
    precedingOperatorText: 'Nos informan de que no quiere el pedido. ¿Quiere recibir el pedido?'
  });
  assert.equal(result.intent, 'CUSTOMER_STILL_WANTS_ORDER');
  assert.equal(result.interpretation_basis, 'AFFIRMATIVE_REPLY_TO_RECEIVE_QUESTION');
});

test('short affirmative answer confirms an unambiguously framed rejection question', () => {
  const result = interpretChatbyCustomerReply({
    customerText: 'Sí',
    precedingOperatorText: '¿Confirma que quiere devolver el pedido?'
  });
  assert.equal(result.intent, 'FINAL_REJECTION');
  assert.equal(result.interpretation_basis, 'AFFIRMATIVE_REPLY_TO_REJECTION_QUESTION');
});

test('ambiguous short answers remain unknown instead of inventing intent', () => {
  const result = interpretChatbyCustomerReply({ customerText: 'Sí', precedingOperatorText: '¿Está todo correcto?' });
  assert.equal(result.intent, 'UNKNOWN');
  assert.equal(result.interpretation_basis, 'AMBIGUOUS_OPERATOR_QUESTION');
});

test('a concrete weekday and early slot is understood as a delivery instruction', () => {
  const result = interpretChatbyCustomerReply({ customerText: 'Miércoles temprano mejor' });
  assert.equal(result.intent, 'DELIVERY_RETRY');
  assert.equal(result.delivery.requested_day, 'WEDNESDAY');
  assert.equal(result.delivery.requested_window, 'MORNING');
  assert.equal(result.interpretation_basis, 'DIRECT_CUSTOMER_TEXT');
});

test('address data inherits the exact operator request without guessing from an unrelated reply', () => {
  const result = interpretChatbyCustomerReply({
    customerText: 'Calle Ejemplo 31, 28001 Madrid',
    precedingOperatorText: 'Por favor, indíquenos la dirección completa y el código postal.'
  });
  assert.equal(result.intent, 'CHANGE_ADDRESS');
  assert.equal(result.interpretation_basis, 'ADDRESS_DATA_REPLY_TO_ADDRESS_REQUEST');
  assert.equal(result.address.complete, true);
  assert.equal(result.address.fields.street_number, '31');
  assert.equal(result.address.fields.postal_code, '28001');
  assert.equal(result.address.fields.locality, 'Madrid');
});

test('address extraction reports exactly which delivery fields are still missing', () => {
  const result = addressInstructionFromText('La nueva es Calle Ejemplo 31');
  assert.equal(result.has_address_data, true);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing_fields, ['POSTAL_CODE', 'LOCALITY']);
  assert.equal(result.fields.postal_code, null);
  assert.equal(result.fields.locality, null);
});

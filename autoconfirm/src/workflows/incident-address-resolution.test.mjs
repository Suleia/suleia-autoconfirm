import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incorrectAddressOperationalDecision,
  prepareIncorrectAddressSolution
} from './incident-address-resolution.mjs';

test('prepares an actionable dictated address without inventing postal data', () => {
  const result = prepareIncorrectAddressSolution({
    customerText: 'calle ejemplo por tal dos primero d hay una varberia al frente',
    orderPhone: '+34600111222'
  });
  assert.equal(result.eligible, true);
  assert.match(result.text, /^Calle ejemplo portal 2 1ºD hay una barbería al frente\./);
  assert.match(result.text, /Llamar antes al 600111222\.$/);
  assert.doesNotMatch(result.text, /c[oó]digo postal|localidad/i);
});

test('leaves missing, partial or untrusted address content for manual review', () => {
  assert.equal(prepareIncorrectAddressSolution({ customerText: '', orderPhone: '+34600111222' }).status, 'MANUAL_REVIEW_NO_RESPONSE');
  assert.equal(prepareIncorrectAddressSolution({ customerText: 'Es en la calle Ejemplo', orderPhone: '+34600111222' }).status, 'MANUAL_REVIEW_INCOMPLETE_ADDRESS');
  assert.equal(prepareIncorrectAddressSolution({ customerText: 'Calle Ejemplo portal 2 https://invalid.example', orderPhone: '+34600111222' }).status, 'MANUAL_REVIEW_AMBIGUOUS_ADDRESS');
});

test('requires exact order association, a verified read and a post-incident customer response', () => {
  const base = {
    classification: { type: 'address' },
    phone: '+34600111222',
    chatby: { orderAssociation: 'EXACT_ORDER', chatbyReadVerified: true, customerMessages: 1, lastCustomerMessage: 'Calle Ejemplo portal 2 piso 1 D' }
  };
  assert.equal(incorrectAddressOperationalDecision(base).eligible, true);
  assert.equal(incorrectAddressOperationalDecision({ ...base, chatby: { ...base.chatby, orderAssociation: 'PHONE_FALLBACK' } }).status, 'MANUAL_REVIEW_NO_EXACT_CONVERSATION');
  assert.equal(incorrectAddressOperationalDecision({ ...base, chatby: { ...base.chatby, chatbyReadVerified: false } }).status, 'MANUAL_REVIEW_CHATBY_UNVERIFIED');
  assert.equal(incorrectAddressOperationalDecision({ ...base, chatby: { ...base.chatby, customerMessages: 0, lastCustomerMessage: '' } }).status, 'MANUAL_REVIEW_NO_RESPONSE');
});

test('uses the latest actionable address before a harmless acknowledgement', () => {
  const decision = incorrectAddressOperationalDecision({
    classification: { type: 'address' },
    phone: '+34612345678',
    chatby: {
      orderAssociation: 'EXACT_ORDER',
      chatbyReadVerified: true,
      customerMessages: 2,
      lastCustomerMessage: 'Gracias',
      customerTextsAfterIncident: ['Calle Fixture portal dos primero D', 'Gracias']
    }
  });
  assert.equal(decision.eligible, true);
  assert.match(decision.text, /Calle Fixture portal 2 1ºD/);
});

test('a later rejection or a newer incomplete correction blocks an earlier address', () => {
  const base = {
    classification: { type: 'address' },
    phone: '+34612345678'
  };
  for (const customerTextsAfterIncident of [
    ['Calle Fixture 12', 'No lo quiero'],
    ['Calle Fixture 12', 'La dirección es calle Nueva']
  ]) {
    const decision = incorrectAddressOperationalDecision({
      ...base,
      chatby: {
        orderAssociation: 'EXACT_ORDER',
        chatbyReadVerified: true,
        customerMessages: 2,
        lastCustomerMessage: customerTextsAfterIncident.at(-1),
        customerTextsAfterIncident
      }
    });
    assert.equal(decision.eligible, false);
    assert.match(decision.status, /MANUAL_REVIEW/);
  }
});

test('never applies the address rule to another incident type', () => {
  const result = incorrectAddressOperationalDecision({
    classification: { type: 'absent' },
    phone: '+34600111222',
    chatby: { orderAssociation: 'EXACT_ORDER', chatbyReadVerified: true, customerMessages: 1, lastCustomerMessage: 'Calle Ejemplo portal 2' }
  });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'NOT_APPLICABLE');
});

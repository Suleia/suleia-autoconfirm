import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIncidentDiscountTemplateDisabled,
  calculateIncidentDiscount,
  INCIDENT_DISCOUNT_FIELD_NAME,
  INCIDENT_DISCOUNT_TEMPLATE_BINDINGS,
  incidentDiscountTemplateData,
  incidentDiscountTemplatePayload
} from './incident-discount-template.mjs';

test('calculates 29.99 EUR minus 5 EUR as 24.99 EUR', () => {
  const result = calculateIncidentDiscount({ totalAmount: 29.99, currencyCode: 'EUR' });
  assert.equal(result.finalAmount, 24.99);
  assert.match(result.finalFormatted, /24,99/);
});

test('is idempotent because it always starts from the Shopify source total', () => {
  const order = { totalAmount: 29.99, currencyCode: 'EUR' };
  assert.equal(calculateIncidentDiscount(order).finalAmount, 24.99);
  assert.equal(calculateIncidentDiscount(order).finalAmount, 24.99);
});

test('fails closed when Shopify has no valid amount', () => {
  assert.throws(() => calculateIncidentDiscount({ totalAmount: 'invalid' }), { code: 'SHOPIFY_ORDER_AMOUNT_INVALID' });
});

test('never allows a discount above the strict 5 EUR limit', () => {
  assert.throws(
    () => calculateIncidentDiscount({ totalAmount: 29.99 }, 5.01),
    { code: 'INCIDENT_DISCOUNT_AMOUNT_NOT_ALLOWED' }
  );
});

test('accepts a localized Shopify amount and blocks totals below the offer', () => {
  assert.equal(calculateIncidentDiscount({ totalAmount: '29,99 EUR' }).finalAmount, 24.99);
  assert.throws(
    () => calculateIncidentDiscount({ totalAmount: 3 }),
    { code: 'INCIDENT_DISCOUNT_EXCEEDS_ORDER_TOTAL' }
  );
});

test('rejects an already discounted order to prevent a duplicate discount', () => {
  assert.throws(
    () => calculateIncidentDiscount({ totalAmount: 29.99, incidentDiscountApplied: true }),
    { code: 'INCIDENT_DISCOUNT_ALREADY_APPLIED' }
  );
});

test('builds three ordered dynamic body values and stable internal button actions', () => {
  const data = incidentDiscountTemplateData({
    order: {
      totalAmount: 29.99,
      currencyCode: 'EUR',
      customerName: 'Ana Garcia',
      products: [{ title: 'NIDA premium' }]
    }
  });
  assert.equal(data.variables.length, 3);
  assert.deepEqual(data.variables.slice(0, 2), ['Ana', 'NIDA premium']);
  assert.equal(data.params['BODY_{{1}}'], 'Ana');
  assert.equal(data.params['BODY_{{2}}'], 'NIDA premium');
  assert.match(data.params['BODY_{{3}}'], /24,99/);
  assert.equal(data.subscriberField.name, INCIDENT_DISCOUNT_FIELD_NAME);
  assert.equal(data.subscriberField.value, data.finalPrice);
  assert.equal(data.defaultBindings['BODY_{{1}}'], '{{first_name}}');
  assert.equal(data.defaultBindings['BODY_{{2}}'], '{{f273883v13996841}}');
  assert.equal(data.defaultBindings['BODY_{{3}}'], INCIDENT_DISCOUNT_TEMPLATE_BINDINGS['BODY_{{3}}']);
  assert.equal(data.buttonActions.ACCEPT, 'ACCEPT_DISCOUNT_5');
  assert.equal(data.buttonActions.REJECT, 'REJECT_ORDER');
  assert.match(data.dedupeKey, /es_es_dropea_incidencia_descuento_5_v1$/);
});

test('extracts the product from a raw Dropea order when products is absent', () => {
  const data = incidentDiscountTemplateData({
    order: {
      totalAmount: '34,99 EUR',
      customerName: 'Maria Luisa',
      raw: {
        items: [{ product_name: 'Polvo Dental de Colageno Colla Gum' }]
      }
    }
  });
  assert.equal(data.params['BODY_{{1}}'], 'Maria');
  assert.equal(data.params['BODY_{{2}}'], 'Polvo Dental de Colageno Colla Gum');
  assert.match(data.params['BODY_{{3}}'], /29,99/);
});

test('keeps the feature disabled and validates the isolated Meta payload', () => {
  assert.equal(assertIncidentDiscountTemplateDisabled({ enableIncidentDiscountTemplate: false }), true);
  const payload = incidentDiscountTemplatePayload();
  assert.equal(payload.category, 'MARKETING');
  assert.equal(payload.components[1].buttons.length, 2);
  assert.deepEqual(payload.components[1].buttons.map((button) => button.text), [
    'Quiero el descuento',
    'No quiero el pedido'
  ]);
});

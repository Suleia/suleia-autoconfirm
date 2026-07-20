import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIncidentDiscountTemplateDisabled,
  calculateIncidentDiscount,
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

test('builds three ordered variables and stable internal button actions', () => {
  const data = incidentDiscountTemplateData({
    order: { totalAmount: 29.99, currencyCode: 'EUR', customerName: 'Ana', products: [{ title: 'NIDA premium' }] }
  });
  assert.equal(data.variables.length, 3);
  assert.equal(data.buttonActions.ACCEPT, 'ACCEPT_DISCOUNT_5');
  assert.equal(data.buttonActions.REJECT, 'REJECT_ORDER');
});

test('keeps the feature disabled and validates the isolated Meta payload', () => {
  assert.equal(assertIncidentDiscountTemplateDisabled({ enableIncidentDiscountTemplate: false }), true);
  const payload = incidentDiscountTemplatePayload();
  assert.equal(payload.category, 'MARKETING');
  assert.equal(payload.components[1].buttons.length, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPurchaseRoas, selectWebsitePurchaseMetric } from './purchase-roas.mjs';

test('Purchase ROAS selects the exact website purchase action, never the first generic object', () => {
  const result = selectPurchaseRoas({
    website_purchase_roas: [
      { action_type: 'add_to_cart', value: '99' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5.42' }
    ],
    purchase_roas: [{ action_type: 'omni_purchase', value: '6.00' }]
  });
  assert.deepEqual(result, {
    value: 5.42,
    action_type: 'offsite_conversion.fb_pixel_purchase',
    status: 'AVAILABLE',
    field: 'website_purchase_roas'
  });
});
test('missing or invalid Purchase ROAS remains NO_DATA and never becomes zero', () => {
  assert.deepEqual(selectPurchaseRoas({}), {
    value: null, action_type: null, status: 'NO_DATA', field: null
  });
  assert.deepEqual(selectPurchaseRoas({ purchase_roas: [{ action_type: 'omni_purchase', value: 'invalid' }] }), {
    value: null, action_type: null, status: 'NO_DATA', field: null
  });
});

test('conflicting duplicate purchase values fail closed as AMBIGUOUS', () => {
  const result = selectPurchaseRoas({
    purchase_roas: [
      { action_type: 'omni_purchase', value: '4' },
      { action_type: 'omni_purchase', value: '5' }
    ]
  });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.value, null);
});

test('purchase counts and values ignore non-purchase actions', () => {
  const result = selectWebsitePurchaseMetric([
    { action_type: 'link_click', value: '100' },
    { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }
  ]);
  assert.deepEqual(result, {
    value: 2, action_type: 'offsite_conversion.fb_pixel_purchase', status: 'AVAILABLE'
  });
});

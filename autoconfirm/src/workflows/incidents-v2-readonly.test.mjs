import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePendingIncidentsForAnalysis } from './incidents.mjs';

test('Chatby 401 while loading the subscriber index preserves V2 incidents for the cache', async () => {
  const pending = [{
    order: { orderId: '41' },
    issue: { id: 9, orderId: '41', status: 'PENDING' }
  }];
  const result = await preparePendingIncidentsForAnalysis({
    pending,
    indexLoader: async () => {
      const error = new Error('Chatby request failed: 401');
      error.status = 401;
      throw error;
    }
  });

  assert.equal(result.pending, pending);
  assert.equal(result.pending.length, 1);
  assert.equal(result.subscriberIndex, null);
  assert.match(result.subscriberIndexError, /401/);
});

test('available Chatby index is passed through without changing V2 incidents', async () => {
  const pending = [{ order: { orderId: '42' }, issue: { id: 10 } }];
  const index = new Map([['masked', { user_ns: 'masked' }]]);
  const result = await preparePendingIncidentsForAnalysis({
    pending,
    indexLoader: async () => index
  });

  assert.equal(result.pending, pending);
  assert.equal(result.subscriberIndex, index);
  assert.equal(result.subscriberIndexError, null);
});

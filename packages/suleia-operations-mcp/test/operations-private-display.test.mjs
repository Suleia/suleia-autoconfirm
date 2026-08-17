import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decryptOperationsPrivateJson, privateOrderDisplay } from '../src/operations/private-display.mjs';

const KEY = 'test-private-key-that-is-longer-than-thirty-two-characters';

function encrypt(value) {
  const key = crypto.createHash('sha256').update(`suleia-private-v1|${KEY}`).digest();
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

test('private display decrypts only with the Operations API key and never returns ciphertext', () => {
  const row = privateOrderDisplay({
    dropea_order_id: '1234',
    external_order_id_ciphertext: encrypt({ value: '#2006' }),
    shipping_address_ciphertext: encrypt({ full_name: 'Cliente de Prueba' })
  }, KEY);
  assert.equal(row.external_order_reference, '#2006');
  assert.equal(row.customer_name, 'Cliente de Prueba');
  assert.equal('external_order_id_ciphertext' in row, false);
  assert.equal('shipping_address_ciphertext' in row, false);
});

test('private display fails closed with a missing or incorrect key', () => {
  const ciphertext = encrypt({ full_name: 'Cliente de Prueba' });
  assert.equal(decryptOperationsPrivateJson(ciphertext, 'incorrect-key-that-is-long-enough-for-this-test'), null);
  const row = privateOrderDisplay({ shipping_address_ciphertext: ciphertext }, '');
  assert.equal(row.customer_name, null);
  assert.equal('shipping_address_ciphertext' in row, false);
});

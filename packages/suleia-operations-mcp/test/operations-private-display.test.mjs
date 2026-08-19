import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decryptOperationsPrivateJson, privateIncidentDisplay, privateIncidentMessages, privateOrderDisplay } from '../src/operations/private-display.mjs';

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
    shipping_address_ciphertext: encrypt({ full_name: 'Cliente de Prueba', phone_number: '+34600111222' })
  }, KEY);
  assert.equal(row.external_order_reference, '#2006');
  assert.equal(row.customer_name, 'Cliente de Prueba');
  assert.equal(row.customer_phone, '+34600111222');
  assert.equal('external_order_id_ciphertext' in row, false);
  assert.equal('shipping_address_ciphertext' in row, false);
});

test('incident private display exposes clear customer context but never ciphertext', () => {
  const incident = privateIncidentDisplay({
    canonical_issue_id: 'issue-safe',
    shipping_address_ciphertext: encrypt({ first_name: 'Ana', last_name: 'Prueba', phone_number: '+34600999888' }),
    latest_customer_message_ciphertext: encrypt({ text: 'Mañana puedo recibirlo por la tarde.' })
  }, KEY);
  assert.equal(incident.customer_name, 'Ana Prueba');
  assert.equal(incident.customer_phone, '+34600999888');
  assert.equal(incident.latest_customer_message, 'Mañana puedo recibirlo por la tarde.');
  assert.equal('latest_customer_message_ciphertext' in incident, false);
  const messages = privateIncidentMessages([{ message_text_ciphertext: encrypt({ text: 'Confirmo la dirección.' }), occurred_at: '2026-08-19T10:00:00Z' }], KEY);
  assert.equal(messages[0].text, 'Confirmo la dirección.');
  assert.equal('message_text_ciphertext' in messages[0], false);
});

test('private display fails closed with a missing or incorrect key', () => {
  const ciphertext = encrypt({ full_name: 'Cliente de Prueba' });
  assert.equal(decryptOperationsPrivateJson(ciphertext, 'incorrect-key-that-is-long-enough-for-this-test'), null);
  const row = privateOrderDisplay({ shipping_address_ciphertext: ciphertext }, '');
  assert.equal(row.customer_name, null);
  assert.equal('shipping_address_ciphertext' in row, false);
});

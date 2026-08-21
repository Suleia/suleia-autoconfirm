import crypto from 'node:crypto';

function cleanDisplayText(value, maxLength = 160) {
  if (value === undefined || value === null) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength) || null;
}

function cleanMessageText(value, maxLength = 1000) {
  const cleaned = cleanDisplayText(value, maxLength);
  if (!cleaned) return null;
  const words = cleaned.split(' ');
  if (words.length < 4 || words.length % 2 !== 0) return cleaned;
  const midpoint = words.length / 2;
  const first = words.slice(0, midpoint).join(' ');
  const second = words.slice(midpoint).join(' ');
  return first.localeCompare(second, 'es', { sensitivity: 'base' }) === 0 ? first : cleaned;
}

export function decryptOperationsPrivateJson(ciphertext, privateDataKey) {
  if (!ciphertext || typeof privateDataKey !== 'string' || privateDataKey.length < 32) return null;
  try {
    const [version, iv, tag, encrypted] = String(ciphertext).split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) return null;
    const key = crypto.createHash('sha256').update(`suleia-private-v1|${privateDataKey}`).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const clear = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]);
    const value = JSON.parse(clear.toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function privateOrderDisplay(row = {}, privateDataKey) {
  const {
    external_order_id_ciphertext: externalCiphertext,
    shipping_address_ciphertext: addressCiphertext,
    ...safe
  } = row;
  const external = decryptOperationsPrivateJson(externalCiphertext, privateDataKey);
  const address = decryptOperationsPrivateJson(addressCiphertext, privateDataKey) || {};
  const composedName = [address.first_name, address.last_name].map((part) => cleanDisplayText(part, 80)).filter(Boolean).join(' ');
  const phone = address.phone_number || address.phone || address.mobile || address.telephone;
  return {
    ...safe,
    external_order_reference: cleanDisplayText(external?.value, 80),
    customer_name: cleanDisplayText(address.full_name || address.name || address.recipient_name || composedName, 160),
    customer_phone: cleanDisplayText(phone, 40),
    private_display_source: externalCiphertext || addressCiphertext ? 'DROPEA_V2_ENCRYPTED' : 'UNAVAILABLE'
  };
}

export function privateIncidentDisplay(row = {}, privateDataKey) {
  const {
    latest_customer_message_ciphertext: messageCiphertext,
    latest_operator_message_ciphertext: operatorMessageCiphertext,
    ...orderFields
  } = row;
  const display = privateOrderDisplay(orderFields, privateDataKey);
  const message = decryptOperationsPrivateJson(messageCiphertext, privateDataKey);
  const operatorMessage = decryptOperationsPrivateJson(operatorMessageCiphertext, privateDataKey);
  return {
    ...display,
    latest_customer_message: cleanMessageText(message?.text, 1000),
    latest_operator_message: cleanMessageText(operatorMessage?.text, 1000)
  };
}

export function privateIncidentMessages(rows = [], privateDataKey) {
  return rows.map((row) => {
    const { message_text_ciphertext: ciphertext, ...safe } = row;
    const message = decryptOperationsPrivateJson(ciphertext, privateDataKey);
    return { ...safe, text: cleanMessageText(message?.text, 1000) };
  }).filter((row) => row.text);
}

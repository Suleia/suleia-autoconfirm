const DEFAULT_BLOCKED_CUSTOMER_PHONES = ['671405901'];

export function phoneDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function phoneKey(value) {
  const digits = phoneDigits(value);
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function configuredBlockedPhones(store = {}) {
  const values = [
    ...DEFAULT_BLOCKED_CUSTOMER_PHONES,
    ...(Array.isArray(store.blockedCustomerPhones) ? store.blockedCustomerPhones : [])
  ];

  return [...new Set(values.map(phoneKey).filter(Boolean))];
}

export function blockedCustomerMatch(phone, store = {}) {
  const customerKey = phoneKey(phone);
  if (!customerKey) return null;

  const matched = configuredBlockedPhones(store).find((blockedPhone) => customerKey.endsWith(blockedPhone));
  return matched || null;
}

export function isBlockedCustomerOrder(order, store = {}) {
  return Boolean(blockedCustomerMatch(order?.customerPhone, store));
}

export function blockedCustomerReason(order, store = {}) {
  const matched = blockedCustomerMatch(order?.customerPhone, store);
  return matched
    ? `Cliente vetado por telefono terminado en ${matched}. No enviar mensajes por Chatby y cancelar automaticamente el pedido.`
    : '';
}

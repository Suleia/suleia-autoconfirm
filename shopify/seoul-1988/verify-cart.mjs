// Isolated anonymous cart. Never uses browser cookies, customer data or checkout.
import fs from 'node:fs/promises';
const cookies = new Map();
async function request(path, body) {
  const response = await fetch(`https://suleia.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]; const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  if (!response.ok) throw new Error(`Cart API HTTP ${response.status}`);
  return response.json();
}
const expected = { 1: 2900, 2: 3599, 3: 4299 };
const results = [];
try {
  const initial = await request('/cart.js');
  if (initial.item_count !== 0) throw new Error('New isolated cart was not empty');
  await request('/cart/add.js', { items: [{ id: 58939591852364, quantity: 1 }] });
  for (const quantity of [1, 2, 3, 2, 1]) {
    const cart = await request('/cart/change.js', { line: 1, quantity });
    const result = { quantity, actual: cart.total_price, expected: expected[quantity], currency: cart.currency, discount: cart.total_discount, passed: cart.total_price === expected[quantity] && cart.item_count === quantity };
    results.push(result);
    if (!result.passed) throw new Error(`Incorrect total for quantity ${quantity}: ${cart.total_price}`);
  }
} finally {
  await request('/cart/clear.js', {});
  const clean = await request('/cart.js');
  const report = { checkedAt: new Date().toISOString(), isolatedCart: true, noOrderCreated: true, cleanupPassed: clean.item_count === 0, results };
  await fs.writeFile(new URL('./cart-verification.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

const baseUrl = process.env.AUTOCONFIRM_BASE_URL || 'https://suleia-autoconfirm.onrender.com';
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error('Missing CRON_SECRET for unanswered cancellation cron.');
  process.exit(1);
}

const endpoint = new URL('/api/cron/unanswered-cancellations', baseUrl);

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${cronSecret}`
  }
});

const text = await response.text();
let body = null;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  body = text;
}

if (!response.ok) {
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    body
  }, null, 2));
  process.exit(1);
}

const result = body?.result || body;
const rows = Array.isArray(result?.results) ? result.results : [];
const cancelled = rows.filter((item) => item.action === 'cancelled_unanswered');
const failed = rows.filter((item) => item.reason === 'dropea_cancellation_failed');

console.log(JSON.stringify({
  ok: true,
  checked: rows.length,
  cancelled: cancelled.length,
  failed: failed.length,
  cancelledOrders: cancelled.map((item) => item.orderId),
  ranAt: new Date().toISOString()
}, null, 2));

if (failed.length) {
  process.exit(1);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), `suleia-confirmation-regression-${process.pid}-`));
// Always replace inherited paths. A regression runner must never be able to
// reuse (and therefore mutate) a developer or production data file.
process.env.STORE_CONFIG_PATH = path.join(isolated, 'stores.json');
process.env.STATE_PATH = path.join(isolated, 'state.json');
process.env.ORDERS_PATH = path.join(isolated, 'orders.json');
process.env.WEBHOOK_EVENTS_PATH = path.join(isolated, 'webhooks.json');
process.env.SUPABASE_ENABLED = 'false';
process.env.GOOGLE_SHEETS_ENABLED = 'false';
process.env.AUTO_POLL_ENABLED = 'false';
process.env.AGENT_ENABLED = 'false';
process.env.AGENT_DRY_RUN = 'true';
process.env.DELAYED_CONFIRM_REAL_ENABLED = 'false';
process.env.UNANSWERED_REJECT_REAL_ENABLED = 'false';
process.env.INCIDENT_RESOLUTION_REAL_ENABLED = 'false';

for (const credential of [
  'CHATBY_TOKEN',
  'DROPEA_API_KEY',
  'DROPEA_ACCESS_TOKEN',
  'DROPEA_STORES_CONFIG',
  'DROPEA_ACTIONS_STORES_CONFIG',
  'SHOPIFY_ADMIN_ACCESS_TOKEN',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_CLIENT_ID',
  'SHOPIFY_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'META_ACCESS_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY'
]) delete process.env[credential];

process.env.CHATBY_BASE_URL = 'https://blocked.fixture.invalid';

globalThis.fetch = async (input) => {
  const target = (() => {
    try { return new URL(String(input)).origin; } catch { return 'invalid-url'; }
  })();
  throw new Error(`CONFIRMATION_REGRESSION_EGRESS_BLOCKED:${target}`);
};

process.on('exit', () => {
  fs.rmSync(isolated, { recursive: true, force: true });
});

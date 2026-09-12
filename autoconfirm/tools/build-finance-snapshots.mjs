import fs from 'node:fs';
import path from 'node:path';
import { buildFinanceReport } from '../src/finance.mjs';
import { getCampaignInsights } from '../src/clients/meta.mjs';

const sourceDirectory = path.resolve(process.argv[2] || '.tmp-finance-current');
const targetDirectory = path.resolve(process.argv[3] || 'autoconfirm/data/finance/snapshots');
const token = process.env.DROPEA_PUBLIC_API_TOKEN;
if (!token) throw new Error('DROPEA_PUBLIC_API_TOKEN_MISSING');

const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const expiresAt = new Date(Number(claims.exp) * 1000).toISOString();
const fallbackMetaRows = [];
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
for (const month of months) {
  const sourceFile = path.join(sourceDirectory, `${month}.json`);
  const fallbackFile = path.join(targetDirectory, `${month}.json`);
  const stored = fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
  const finance = stored.finance || stored;
  for (const day of finance.days || []) {
    if (day.metaSpend !== null && day.metaSpend !== undefined) fallbackMetaRows.push({ dateStart: day.day, spend: day.metaSpend });
  }
}

let metaRows = fallbackMetaRows;
if (process.env.META_ACCESS_TOKEN && (process.env.META_AD_ACCOUNT_ID || process.env.META_ACT_ID)) {
  try {
    metaRows = await getCampaignInsights({ since: '2026-05-01', until: new Date().toISOString().slice(0, 10), level: 'campaign', limit: 500, timeIncrement: 1 });
  } catch (error) {
    console.warn(`Meta live refresh failed; using the last reconciled daily snapshot (${error instanceof Error ? error.message : String(error)}).`);
  }
}

const env = {
  DROPEA_STORES_CONFIG: JSON.stringify([{
    store_id: '16088',
    market: 'ES',
    base_url: 'https://es.public-api.dropea.com',
    jwt_secret_reference: 'DROPEA_FINANCE_READ_TOKEN',
    jwt_expires_at: expiresAt
  }]),
  DROPEA_FINANCE_READ_TOKEN: token
};

fs.mkdirSync(targetDirectory, { recursive: true });
for (const month of months) {
  const report = await buildFinanceReport({ month, force: true, env, metaLoader: async () => metaRows });
  const text = JSON.stringify(report, null, 2);
  if (/"(?:customer|phone|email|address|tracking)[^"]*"\s*:/i.test(text)) throw new Error(`PERSONAL_DATA_BLOCKED:${month}`);
  fs.writeFileSync(path.join(targetDirectory, `${month}.json`), `${text}\n`, 'utf8');
  console.log(`${month}: ${report.counts.created} created, ${report.counts.delivered} delivered, ${report.totals.exactNetProfit ?? 'pending'} EUR net`);
}

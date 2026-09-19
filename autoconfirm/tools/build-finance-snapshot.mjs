import { buildFinanceReport } from '../src/finance.mjs';

const token = process.env.DROPEA_PUBLIC_API_TOKEN;
const market = String(process.env.DROPEA_PUBLIC_API_MARKET || 'ES').toUpperCase();
const storeId = process.env.DROPEA_STORE_ID;
const month = process.argv[2];

if (!token || !storeId || !/^\d+$/.test(storeId)) throw new Error('FINANCE_SNAPSHOT_DROPEA_CONFIG_MISSING');
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new Error('FINANCE_SNAPSHOT_MONTH_INVALID');

const options = {
  month,
  force: true,
  env: process.env,
  configLoader: () => [{ store_id: storeId, market, token }]
};
if (process.env.FINANCE_META_ROWS_JSON) {
  const metaRows = JSON.parse(process.env.FINANCE_META_ROWS_JSON);
  options.metaLoader = async () => metaRows;
}
const report = await buildFinanceReport(options);

process.stdout.write(JSON.stringify(report));

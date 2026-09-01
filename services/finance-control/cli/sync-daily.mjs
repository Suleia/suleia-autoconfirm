import { loadMetaAdsConfig } from '../../meta-ads/config.mjs';
import { createMetaAdsReadClient } from '../../meta-ads/meta-ads-client.mjs';
import { previousBusinessDateInTimezone, runMetaAdsFinanceSpendReadCycle } from '../../meta-ads/read-cycle.mjs';
import { MetaSpendWriter } from '../../../packages/suleia-operations-mcp/src/finance/meta-spend-writer.mjs';
import { assertDedicatedMetaReadScope, loadFinanceSyncConfig } from '../config.mjs';

const finance = loadFinanceSyncConfig(); const meta = loadMetaAdsConfig();
const writer = await MetaSpendWriter.connect(finance.databaseUrl);
try {
  const result = await runMetaAdsFinanceSpendReadCycle({ config: meta, client: createMetaAdsReadClient(meta), businessDate: finance.businessDate });
  assertDedicatedMetaReadScope(result);
  const persisted = await writer.persistDay({ storeId: finance.storeId, sourceRecordKey: finance.sourceRecordKey, result });
  process.stdout.write(`${JSON.stringify({ ok: true, business_date: persisted.business_date, campaigns: persisted.campaigns, internal_ledger_writes: persisted.internal_writes, external_writes: 0 })}\n`);
} catch (error) {
  const businessDate = finance.businessDate || previousBusinessDateInTimezone(new Date(), meta.expectedTimezone);
  const failureCode = /^[A-Z0-9_:-]{1,80}$/.test(String(error?.message || '')) ? error.message : 'FINANCE_SYNC_FAILED';
  await writer.persistFailure({ storeId: finance.storeId, businessDate, failureCode });
  throw error;
} finally { await writer.close(); }

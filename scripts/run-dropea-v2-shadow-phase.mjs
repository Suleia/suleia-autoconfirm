import { pathToFileURL } from 'node:url';
import { loadShadowConfig } from '../packages/suleia-operations-mcp/src/shadow/config.mjs';
import { ShadowRepository } from '../packages/suleia-operations-mcp/src/shadow/repository.mjs';
import { OperationsProjector } from '../packages/suleia-operations-mcp/src/operations/projector.mjs';
import { createDropeaPublicApiClient } from '../services/integrations/dropea/public-api-client.mjs';
import { syncDropeaPublicApi } from '../services/integrations/dropea/shadow-sync.mjs';
import { loadDropeaStoreConfigs } from '../services/integrations/dropea/store-config.mjs';
import { tokenScopes } from '../services/integrations/dropea/contract.mjs';

const ALLOWED_PHASES = new Set(['CANARY', 'TODAY', 'BACKFILL', 'INCREMENTAL']);

function shopIdentifier(value) {
  return String(value?.id ?? value?.shop_id ?? value?.store_id ?? '');
}

export async function runDropeaShadowPhase({ env = process.env } = {}) {
  if (env.CONFIRM_DROPEA_SHADOW_PHASE !== 'yes') throw new Error('DROPEA_SHADOW_PHASE_CONFIRMATION_REQUIRED');
  const phase = String(env.DROPEA_INGESTION_PHASE || 'CANARY').toUpperCase();
  if (!ALLOWED_PHASES.has(phase)) throw new Error('DROPEA_INGESTION_PHASE_INVALID');
  const dryRun = String(env.DROPEA_INGESTION_DRY_RUN || 'true').toLowerCase() === 'true';
  if (!dryRun && env.CONFIRM_SHADOW_MIRROR_WRITE !== 'yes') {
    throw new Error('DROPEA_SHADOW_MIRROR_WRITE_CONFIRMATION_REQUIRED');
  }

  const config = loadShadowConfig(env);
  const stores = loadDropeaStoreConfigs(env);
  const repository = new ShadowRepository(config.databaseUrl);
  const projector = new OperationsProjector(repository.pool);
  const results = [];
  try {
    for (const store of stores) {
      const client = createDropeaPublicApiClient({
        token: store.token,
        market: store.market,
        rateLimitPerMinute: Number(env.DROPEA_PUBLIC_API_RATE_LIMIT || 45)
      });
      await client.request('getMe');
      const shops = await client.listAll('listShops', {}, {
        requestedLimit: 100,
        maxPages: 20,
        maxRecords: 2_000,
        pagePauseMs: 400
      });
      const storeFound = shops.items.some((shop) => shopIdentifier(shop) === store.store_id);
      if (!storeFound) throw new Error('DROPEA_CONFIGURED_STORE_NOT_VISIBLE');
      if (!dryRun) await projector.upsertStoreConfig(store);
      const sync = await syncDropeaPublicApi({
        client,
        storeConfig: store,
        phase,
        dryRun,
        projector,
        hmacKey: config.hashKey,
        testPhoneNormalized: env.TEST_PHONE_NORMALIZED || null,
        maxPages: Number(env.DROPEA_PUBLIC_API_MAX_PAGES || 200),
        maxRecords: Number(env.DROPEA_PUBLIC_API_MAX_RECORDS || 20_000)
      });
      results.push({
        market: store.market,
        store_id: store.store_id,
        jwt_expires_at: store.jwt_expires_at,
        scopes: tokenScopes(store.token),
        identity_read_ok: true,
        visible_shop_count: shops.items.length,
        configured_store_found: true,
        ...sync
      });
    }
    return {
      ok: results.every((result) => result.ok),
      phase,
      dry_run: dryRun,
      stores: results,
      actions_executed: 0,
      production_writes: 0,
      messages_sent: 0,
      external_mutations: 0
    };
  } finally {
    await repository.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDropeaShadowPhase()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ ok: false, error: error.code || error.message,
        actions_executed: 0, production_writes: 0, messages_sent: 0, external_mutations: 0 })}\n`);
      process.exitCode = 1;
    });
}

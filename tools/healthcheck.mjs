import { getAppConfig } from '../src/config.mjs';
import { listOrders, loadState } from '../src/storage.mjs';

const config = getAppConfig();
const state = loadState();

console.log(JSON.stringify({
  ok: true,
  store: config.defaultStore.name,
  webhookTokenSuffix: config.defaultStore.webhookToken?.slice(-6) || null,
  agentEnabled: config.defaultStore.agentEnabled,
  agentDryRun: config.defaultStore.agentDryRun,
  autoPollEnabled: config.defaultStore.autoPollEnabled,
  autoPollIntervalMinutes: config.defaultStore.autoPollIntervalMinutes,
  confidenceThreshold: config.defaultStore.confidenceThreshold,
  cooldownHours: config.defaultStore.cooldownHours,
  lastPollAt: state.lastPollAt,
  lastAutoConfirmAt: state.lastAutoConfirmAt,
  lastAutomationCycleAt: state.lastAutomationCycleAt,
  lastWebhookAt: state.lastWebhookAt,
  lastWebhookError: state.lastWebhookError,
  orders: {
    total: listOrders({ storeId: config.defaultStore.id }).length,
    pending: listOrders({ storeId: config.defaultStore.id, status: 'PENDING' }).length
  }
}, null, 2));

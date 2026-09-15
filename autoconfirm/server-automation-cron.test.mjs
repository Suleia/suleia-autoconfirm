import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

test('persistent automation cron reuses the complete governed cycle', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/automation-cycle'/);
  assert.match(source, /\/api\/cron\/automation-cycle'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /runAutomationAndUnansweredSweep\('cron_automation_cycle'\)/);
  assert.match(source, /async function runAutomationAndUnansweredSweep[\s\S]*runStoreAutomationCycle[\s\S]*runUnansweredCancellationSweep/);
  assert.match(source, /async function runAutomationAndUnansweredSweep[\s\S]*syncOperationalOrders\(\)/);
  assert.match(source, /operationalOrders = \{ ok: false, error: message \}/);
});

test('existing confirmation and cancellation entry points remain present', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/auto-confirm'/);
  assert.match(source, /url\.pathname === '\/api\/cron\/unanswered-cancellations'/);
  assert.match(source, /confirmationDelayHours/);
});

test('prepared-template recovery can be limited to one exact Dropea order', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/backfill-prepared-messages'/);
  assert.match(source, /backfill-prepared-messages'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /orderIds:\s*url\.searchParams\.get\('orderId'\)/);
});

test('critical template repair can be restricted to one authenticated exact order', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/template-delivery'/);
  assert.match(source, /template-delivery'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /requestedOrderId && !\/\^\\d\+\$\//);
  assert.match(source, /orderIds:\s*\[requestedOrderId\]/);
});

test('Dropea webhooks reconcile only their exact order instead of starting a global Chatby sweep', () => {
  assert.match(source, /const webhookOrderId = String\(webhookResult\?\.orderId/);
  assert.match(source, /orderIds:\s*\[webhookOrderId\]/);
  assert.doesNotMatch(source, /runCriticalTemplateDeliverySweep\('dropea_webhook'\)/);
});

test('immediate rejected-discount batch requires cron auth and an explicit one-time authorization', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/send-pending-rejected-discounts-now'/);
  assert.match(source, /send-pending-rejected-discounts-now'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /body\.authorization !== 'SEND_PENDING_REJECTED_DISCOUNTS_NOW'/);
  assert.match(source, /syncPendingIncidents\(\{ authorizedImmediateDiscounts: true \}\)/);

  assert.match(source, /url\.pathname === '\/api\/cron\/reconcile-dropea-incident-returns'/);
  assert.match(source, /reconcile-dropea-incident-returns'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /RECONCILE_AMBIGUOUS_RETURN_REQUESTS/);
});

test('targeted incident returns require auth, explicit authorization and the runtime allowlist', () => {
  assert.match(source, /url\.pathname === '\/api\/logistics\/return-dropea-incidents'/);
  assert.match(source, /return-dropea-incidents'[\s\S]{0,180}isAuthorizedDashboardAction\(req\)/);
  assert.match(source, /body\.authorization !== 'RETURN_REQUESTED_AUTHORIZED'/);
  assert.match(source, /incident_not_in_runtime_allowlist/);
  assert.match(source, /authorizedReturnIncidentIds: incidentIds/);
  assert.match(source, /returnOnly: true/);
  assert.match(source, /persist: false/);
});

test('return status inspection is authenticated and exposes only sanitized ledger fields', () => {
  assert.match(source, /url\.pathname === '\/api\/logistics\/incident-return-status'/);
  assert.match(source, /incident-return-status'[\s\S]{0,180}isAuthorizedDashboardAction\(req\)/);
  assert.match(source, /getTemplateDelivery\(\{/);
  assert.match(source, /lastError: row\.last_error \|\| null/);
  assert.doesNotMatch(source, /incident-return-status'[\s\S]{0,1800}customer_phone/);
});

test('dashboard retry accepts only an exact persisted transient return failure', () => {
  assert.match(source, /url\.pathname === '\/api\/logistics\/reconcile-transient-incident-return'/);
  assert.match(source, /reconcile-transient-incident-return'[\s\S]{0,180}isAuthorizedDashboardAction\(req\)/);
  assert.match(source, /RETRY_TRANSIENT_RETURN_REQUEST/);
  assert.match(source, /DROPEA_V2_ISSUE_ACTION_HTTP_5\\d\\d/);
  assert.match(source, /reconcileAmbiguousReturnIncidentIds: \[incidenceId\]/);
  assert.doesNotMatch(source, /reconcile-transient-incident-return'[\s\S]{0,2600}customer_phone/);
});


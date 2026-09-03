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

test('immediate rejected-discount batch requires cron auth and an explicit one-time authorization', () => {
  assert.match(source, /url\.pathname === '\/api\/cron\/send-pending-rejected-discounts-now'/);
  assert.match(source, /send-pending-rejected-discounts-now'[\s\S]{0,180}isAuthorizedCron\(req\)/);
  assert.match(source, /body\.authorization !== 'SEND_PENDING_REJECTED_DISCOUNTS_NOW'/);
  assert.match(source, /syncPendingIncidents\(\{ authorizedImmediateDiscounts: true \}\)/);
});

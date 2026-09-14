import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

test('finance snapshots can refresh autonomously and remain explicitly disableable', () => {
  assert.match(source, /FINANCE_BACKGROUND_REFRESH_ENABLED !== 'false'/);
  assert.match(source, /financeSnapshotNeedsRefresh\(finance\)/);
  assert.match(source, /financeBackgroundRefreshEnabled && \(force \|\| !finance \|\| stale\)/);
  assert.match(source, /unresolved > 0/);
  assert.match(source, /buildFinanceReport\(\{ month, force: true, leanRefresh: true \}\)/);
  assert.match(source, /FINANCE_REFRESH_INTERVAL_MINUTES \|\| 60/);
  assert.match(source, /startFinanceReportRefreshScheduler\(\)/);
  assert.doesNotMatch(source, /const backgroundRefreshEnabled = false/);
});

test('the dashboard polls a background refresh while continuing to show the stored snapshot', () => {
  const dashboard = fs.readFileSync(new URL('./dashboard/main.js', import.meta.url), 'utf8');
  assert.match(dashboard, /if \(payload\.refreshing\)[^]*setTimeout\(\(\) => loadFinanceReport\(\), 5000\)/);
});


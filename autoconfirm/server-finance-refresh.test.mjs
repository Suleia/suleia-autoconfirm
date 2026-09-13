import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

test('finance snapshots can refresh autonomously and remain explicitly disableable', () => {
  assert.match(source, /FINANCE_BACKGROUND_REFRESH_ENABLED !== 'false'/);
  assert.match(source, /financeBackgroundRefreshEnabled && \(force \|\| !finance\)/);
  assert.match(source, /FINANCE_REFRESH_INTERVAL_MINUTES \|\| 60/);
  assert.match(source, /startFinanceReportRefreshScheduler\(\)/);
  assert.doesNotMatch(source, /const backgroundRefreshEnabled = false/);
});

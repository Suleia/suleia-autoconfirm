import assert from 'node:assert/strict';
import { loadOperationsConfig } from '../apps/api/server.mjs';
import { createFinanceReportClient } from '../apps/api/finance-report-client.mjs';
import { OperationsRepository } from '../packages/suleia-operations-mcp/src/operations/repository.mjs';

const requestedMonths = process.argv.slice(2);
const months = requestedMonths.length ? requestedMonths : ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
for (const month of months) assert.match(month, /^\d{4}-(0[1-9]|1[0-2])$/, `Invalid month: ${month}`);

const config = loadOperationsConfig();
const repository = await OperationsRepository.connect(config.databaseUrl, { privateDataKey: config.privateDataKey });
const financeClient = createFinanceReportClient(config);

try {
  const supplementalReports = financeClient ? await financeClient.getMonthlyBundle(months.at(-1)) : [];
  for (const month of months) {
    const report = await repository.financialSummary(new URLSearchParams({ month }), supplementalReports);
    const recurringDailyValues = new Set(report.days.map((day) => Number(day.fixedCosts || 0).toFixed(2)));
    const issueCategories = Object.entries(report.quality.issues.reduce((counts, issue) => {
      const category = String(issue).split(':', 1)[0] || 'UNKNOWN';
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right));
    const summary = {
      month,
      status: report.status,
      dataAvailability: report.dataAvailability,
      counts: report.counts,
      eventCounts: report.eventCounts,
      totals: report.totals,
      dailyRows: report.days.length,
      distinctDisplayedFixedDailyValues: [...recurringDailyValues],
      quality: {
        status: report.quality.status,
        score: report.quality.score,
        issueCount: report.quality.issues.length,
        issueCategories: Object.fromEntries(issueCategories),
        sample: report.quality.issues.slice(0, 10)
      },
      controls: report.controls,
      productionWrites: report.productionWrites,
      actionsExecuted: report.actions_executed
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);

    assert.equal(report.source, 'operations_canonical_finance_v3');
    assert.equal(report.temporalModels.pnl, 'REALIZED_EVENT_DATE');
    assert.equal(report.productionWrites, 0);
    assert.equal(report.actions_executed, 0);
    assert.equal(report.controls.confirmationCohortReconciled, true);
    assert.equal(report.controls.deliveryOutcomeReconciled, true);
    assert.equal(report.eventCounts.delivered, report.days.reduce((sum, day) => sum + Number(day.delivered || 0), 0));
    assert.equal(report.eventCounts.returned, report.days.reduce((sum, day) => sum + Number(day.returned || 0), 0));
    assert.equal(report.totals.returnCost, Number((report.eventCounts.returned * 5.26).toFixed(2)));
    assert.equal(report.totals.exactNetProfit,
      Number((report.totals.realRevenue - report.totals.totalCosts).toFixed(2)));

    const dailyNet = Number(report.days.reduce((sum, day) => sum + Number(day.netProfit || 0), 0).toFixed(2));
    assert.equal(dailyNet, report.totals.exactNetProfit);
  }
} finally {
  await repository.close();
}

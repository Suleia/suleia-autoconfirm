import fs from 'node:fs';

const rulesUrl = new URL('../data/finance/cost-rules.json', import.meta.url);
const expensesUrl = new URL('../data/finance/expenses.json', import.meta.url);

function readJson(url) {
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}

export function loadFinanceCostRules() {
  return structuredClone(readJson(rulesUrl));
}

export function loadFinanceExpenses() {
  return structuredClone(readJson(expensesUrl));
}

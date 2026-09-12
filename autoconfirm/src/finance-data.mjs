import fs from 'node:fs';

const rulesUrl = new URL('../data/finance/cost-rules.json', import.meta.url);
const expensesUrl = new URL('../data/finance/expenses.json', import.meta.url);

function readJson(url) {
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}

export function loadFinanceCostRules() {
  const rules = readJson(rulesUrl);
  if (!rules.version || !Array.isArray(rules.rates)) throw new Error('FINANCE_COST_RULES_INVALID');
  for (const rate of rules.rates) {
    if (!rate.cost_type || !Number.isSafeInteger(rate.amount_cents) || rate.amount_cents < 0 || rate.currency !== 'EUR' || !rate.source || !rate.effective_from) {
      throw new Error(`FINANCE_COST_RATE_INVALID:${rate.cost_type || 'UNKNOWN'}`);
    }
  }
  const returnRate = rules.rates.find((rate) => rate.cost_type === 'RETURN_LOGISTICS_COMBINED');
  if (!returnRate || returnRate.amount_cents !== 526 || returnRate.unit !== 'PER_RETURNED_ORDER') {
    throw new Error('FINANCE_RETURN_RATE_MUST_BE_526_PER_RETURNED_ORDER');
  }
  return structuredClone(rules);
}

export function loadFinanceExpenses() {
  return structuredClone(readJson(expensesUrl));
}

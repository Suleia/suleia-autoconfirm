export class MetaMoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MetaMoneyError';
    this.code = 'META_MONEY_INVALID';
  }
}
export function parseMetaMinorUnits(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new MetaMoneyError('Meta money must be a non-negative integer in minor units');
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount)) throw new MetaMoneyError('Meta money exceeds the safe integer range');
  return amount;
}

export function minorUnitsToCurrency(minorUnits, exponent = 2) {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) throw new MetaMoneyError('Invalid minor-unit amount');
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 6) throw new MetaMoneyError('Invalid currency exponent');
  return minorUnits / (10 ** exponent);
}

export function readBudgetFields(entity) {
  const daily = parseMetaMinorUnits(entity?.daily_budget);
  const lifetime = parseMetaMinorUnits(entity?.lifetime_budget);
  if (daily !== null && daily > 0) return { budget_period: 'DAILY', budget_minor: daily };
  if (lifetime !== null && lifetime > 0) return { budget_period: 'LIFETIME', budget_minor: lifetime };
  return { budget_period: 'NONE', budget_minor: null };
}

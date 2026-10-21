const WEBSITE_PURCHASE = 'offsite_conversion.fb_pixel_purchase';
const PURCHASE_TYPES = new Set([WEBSITE_PURCHASE, 'omni_purchase', 'purchase']);

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function exactEntries(rows, types) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => types.has(String(row?.action_type || '')))
    .map((row) => ({ action_type: String(row.action_type), value: finiteNonNegative(row.value) }))
    .filter((row) => row.value !== null);
}

function selectUnique(rows, preferredTypes) {
  for (const actionType of preferredTypes) {
    const matches = rows.filter((row) => row.action_type === actionType);
    if (!matches.length) continue;
    const values = [...new Set(matches.map((row) => row.value))];
    if (values.length !== 1) return { value: null, action_type: actionType, status: 'AMBIGUOUS' };
    return { value: values[0], action_type: actionType, status: 'AVAILABLE' };
  }
  return { value: null, action_type: null, status: 'NO_DATA' };
}

export function selectPurchaseRoas(insight = {}) {
  const website = exactEntries(insight.website_purchase_roas, new Set([WEBSITE_PURCHASE]));
  const websiteResult = selectUnique(website, [WEBSITE_PURCHASE]);
  if (websiteResult.status !== 'NO_DATA') {
    return { ...websiteResult, field: 'website_purchase_roas' };
  }
  const purchase = exactEntries(insight.purchase_roas, PURCHASE_TYPES);
  const result = selectUnique(purchase, [WEBSITE_PURCHASE, 'omni_purchase', 'purchase']);
  return { ...result, field: result.status === 'NO_DATA' ? null : 'purchase_roas' };
}

export function selectWebsitePurchaseMetric(rows) {
  const entries = exactEntries(rows, PURCHASE_TYPES);
  return selectUnique(entries, [WEBSITE_PURCHASE, 'omni_purchase', 'purchase']);
}

export function parseSpend(value) {
  return finiteNonNegative(value);
}

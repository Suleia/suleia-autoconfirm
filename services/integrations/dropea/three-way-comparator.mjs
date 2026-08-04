const COMPARED_FIELDS = Object.freeze([
  'status', 'sub_status', 'total_amount', 'market', 'store_id', 'product_key',
  'created_at', 'updated_at', 'active_issue'
]);

function identity(record) {
  return record ? `${record.market}:${record.store_id}:${record.dropea_order_id}` : null;
}

function normalize(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'number' ? String(value) : String(value);
}

export function compareThreeWay({ dropea, currentSystem, mirror, paginationComplete = true, now = new Date(), staleAfterMs = 15 * 60_000 }) {
  if (!dropea) return Object.freeze({ status: 'SOURCE_UNAVAILABLE', critical: true, differences: ['DROPEA_SOURCE_UNAVAILABLE'] });
  if (!paginationComplete) return Object.freeze({ status: 'PAGINATION_INCOMPLETE', critical: true, differences: ['PAGINATION_INCOMPLETE'] });
  const identities = [identity(dropea), identity(currentSystem), identity(mirror)].filter(Boolean);
  if (new Set(identities).size > 1) return Object.freeze({ status: 'DUPLICATE_IDENTITY', critical: true, differences: ['CANONICAL_IDENTITY_CONFLICT'] });
  if (!mirror || !currentSystem) {
    return Object.freeze({ status: 'MISSING_RECORD', critical: true, differences: [!mirror ? 'MIRROR_MISSING' : 'CURRENT_SYSTEM_MISSING'] });
  }
  const differences = [];
  for (const field of COMPARED_FIELDS) {
    const expected = normalize(dropea[field]);
    for (const [source, record] of [['CURRENT', currentSystem], ['MIRROR', mirror]]) {
      if (normalize(record[field]) !== expected) differences.push(`${source}_${field.toUpperCase()}_DIFFERS`);
    }
  }
  const updatedAt = new Date(mirror.updated_at || mirror.source_updated_at || 0).getTime();
  if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt > staleAfterMs) {
    return Object.freeze({ status: 'STALE', critical: true, differences: [...differences, 'MIRROR_STALE'] });
  }
  return Object.freeze({
    status: differences.length ? 'UNEXPECTED_DIFFERENCE' : 'MATCH',
    critical: differences.length > 0,
    differences
  });
}

export const THREE_WAY_COMPARISON_STATUSES = Object.freeze([
  'MATCH','EXPECTED_DIFFERENCE','UNEXPECTED_DIFFERENCE','STALE','MISSING_RECORD',
  'DUPLICATE_IDENTITY','OUT_OF_ORDER','PAGINATION_INCOMPLETE','SOURCE_UNAVAILABLE','BLOCKED'
]);

export const ACTIVE_DROPEA_SOURCE_STATUSES = Object.freeze([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPING',
  'ERROR'
]);

const ACTIVE_COMPATIBLE_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'PREPARING',
  'PREPARED',
  'SHIPPING',
  'SHIPPED',
  'TRANSIT',
  'IN_TRANSIT',
  'ERROR',
  'REVIEW',
  'INCIDENCE',
  'RECLAIM'
]);

const AUTO_CANCEL_PRIOR_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'PREPARING',
  'PREPARED',
  'SHIPPING',
  'SHIPPED',
  'TRANSIT',
  'IN_TRANSIT',
  'INCIDENCE',
  'RECLAIM'
]);

const TERMINAL_ISSUE_STATUSES = new Set([
  'CLOSED',
  'RESOLVED',
  'SOLVED',
  'CANCELLED',
  'INACTIVE'
]);

function normalizedStatus(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function orderCreatedAt(order = {}) {
  const value = order.createdAt
    || order.raw?.created_at
    || order.raw?.createdAt
    || order.raw?.date
    || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function issueLooksOpen(issue) {
  if (!issue) return false;
  if (Array.isArray(issue)) return issue.some(issueLooksOpen);
  if (typeof issue !== 'object') {
    const status = normalizedStatus(issue);
    return Boolean(status) && !TERMINAL_ISSUE_STATUSES.has(status);
  }
  if (!Object.keys(issue).length) return false;
  if (issue.is_active === true || issue.isActive === true || issue.active === true) return true;
  if (issue.is_active === false || issue.isActive === false || issue.active === false) return false;
  const status = normalizedStatus(
    issue.status || issue.state || issue.incidence_status || issue.incidenceStatus
  );
  if (status) return !TERMINAL_ISSUE_STATUSES.has(status);
  return Boolean(issue.id || issue.issue_id || issue.incidence_id || issue.incidence_code || issue.code);
}

function productRows(order = {}) {
  const raw = order.raw || {};
  for (const value of [
    raw.line_items,
    raw.items,
    raw.products,
    raw.lines,
    raw.raw?.line_items,
    raw.raw?.items,
    raw.raw?.products,
    order.products,
    order.items
  ]) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

export function normalizedCustomerPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

export function productIdentityKeys(order = {}) {
  const keys = new Set();
  for (const item of productRows(order)) {
    for (const [prefix, value] of [
      ['sku', item?.sku],
      ['product', item?.product_id ?? item?.productId],
      ['variant', item?.variant_id ?? item?.variantId],
      ['handle', item?.handle ?? item?.product?.handle]
    ]) {
      const normalized = normalizedText(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
    }
    const name = normalizedText(
      item?.external_name
        || item?.product_name
        || item?.productName
        || item?.title
        || item?.name
        || item?.variant_name
        || item?.product?.title
    );
    if (name) keys.add(`name:${name}`);
  }
  return [...keys];
}

export function ordersShareProduct(left, right) {
  const leftKeys = new Set(productIdentityKeys(left));
  const rightKeys = productIdentityKeys(right);
  if (!leftKeys.size || !rightKeys.length) return null;
  return rightKeys.some((key) => leftKeys.has(key));
}

export function orderHasActiveOperationalState(order = {}) {
  if (ACTIVE_COMPATIBLE_STATUSES.has(normalizedStatus(order.status))) return true;
  return issueLooksOpen(order.raw?.issues || order.raw?.issue || order.issues || order.issue);
}

function compareOrderSequence(candidate, current) {
  const candidateAt = orderCreatedAt(candidate);
  const currentAt = orderCreatedAt(current);
  if (candidateAt && currentAt) {
    if (candidateAt.getTime() < currentAt.getTime()) return 'PRIOR';
    if (candidateAt.getTime() > currentAt.getTime()) return 'NEWER';
  }
  const candidateId = Number(candidate.orderId);
  const currentId = Number(current.orderId);
  if (Number.isSafeInteger(candidateId) && Number.isSafeInteger(currentId) && candidateId !== currentId) {
    return candidateId < currentId ? 'PRIOR' : 'NEWER';
  }
  return 'AMBIGUOUS';
}

function newestFirst(left, right) {
  return (orderCreatedAt(right)?.getTime() || 0) - (orderCreatedAt(left)?.getTime() || 0);
}

export function findBlockingActivePriorOrder(currentOrder, orders = []) {
  const phone = normalizedCustomerPhone(currentOrder?.customerPhone || currentOrder?.phone);
  if (!phone) {
    return { kind: 'UNVERIFIABLE', reason: 'CURRENT_ORDER_PHONE_MISSING', order: null };
  }

  const currentId = String(currentOrder?.orderId || '');
  const samePhoneActive = orders.filter((order) => (
    String(order?.orderId || '') !== currentId
    && normalizedCustomerPhone(order?.customerPhone || order?.phone) === phone
    && orderHasActiveOperationalState(order)
  ));

  const sameProduct = samePhoneActive.filter((candidate) => ordersShareProduct(candidate, currentOrder) === true);
  const prior = sameProduct
    .filter((candidate) => compareOrderSequence(candidate, currentOrder) === 'PRIOR')
    .sort(newestFirst);
  if (prior.length) {
    const priorStatus = normalizedStatus(prior[0]?.status);
    const hasOpenIncident = issueLooksOpen(
      prior[0]?.raw?.issues || prior[0]?.raw?.issue || prior[0]?.issues || prior[0]?.issue
    );
    if (!AUTO_CANCEL_PRIOR_STATUSES.has(priorStatus) && !hasOpenIncident) {
      return {
        kind: 'UNVERIFIABLE',
        reason: 'ACTIVE_PRIOR_SAME_PRODUCT_STATUS_REQUIRES_REVIEW',
        order: prior[0]
      };
    }
    return {
      kind: 'ACTIVE_PRIOR_SAME_PRODUCT_ORDER',
      reason: 'OLDER_ACTIVE_ORDER_FOR_SAME_PHONE_AND_PRODUCT',
      order: prior[0]
    };
  }

  const ambiguous = sameProduct.find((candidate) => compareOrderSequence(candidate, currentOrder) === 'AMBIGUOUS');
  if (ambiguous) {
    return {
      kind: 'UNVERIFIABLE',
      reason: 'ACTIVE_SAME_PRODUCT_ORDER_SEQUENCE_AMBIGUOUS',
      order: ambiguous
    };
  }

  const unverifiableProduct = samePhoneActive.find((candidate) => ordersShareProduct(candidate, currentOrder) === null);
  if (unverifiableProduct) {
    return {
      kind: 'UNVERIFIABLE',
      reason: 'ACTIVE_ORDER_PRODUCT_IDENTITY_MISSING',
      order: unverifiableProduct
    };
  }
  return null;
}

export async function collectActiveOrderSnapshot({
  listByStatus,
  listPendingIncidents = null,
  statuses = ACTIVE_DROPEA_SOURCE_STATUSES,
  limit = 100,
  maxPagesPerStatus = 50
}) {
  if (typeof listByStatus !== 'function') throw new Error('ACTIVE_ORDER_READER_MISSING');
  const byIdentity = new Map();
  for (const status of statuses) {
    let completed = false;
    for (let page = 1; page <= maxPagesPerStatus; page += 1) {
      const rows = await listByStatus({ status, limit, page });
      if (!Array.isArray(rows)) throw new Error('ACTIVE_ORDER_SCAN_INVALID_RESPONSE');
      for (const order of rows) {
        const market = String(order?.raw?.market || 'UNKNOWN');
        byIdentity.set(`${market}:${String(order?.orderId || '')}`, order);
      }
      if (rows.length < limit) {
        completed = true;
        break;
      }
    }
    if (!completed) {
      const error = new Error('ACTIVE_ORDER_SCAN_INCOMPLETE');
      error.code = 'ACTIVE_ORDER_SCAN_INCOMPLETE';
      throw error;
    }
  }

  if (listPendingIncidents !== null) {
    if (typeof listPendingIncidents !== 'function') throw new Error('ACTIVE_INCIDENT_READER_INVALID');
    const incidentRows = await listPendingIncidents();
    if (!Array.isArray(incidentRows)) throw new Error('ACTIVE_INCIDENT_SCAN_INVALID_RESPONSE');
    for (const row of incidentRows) {
      const incidentOrder = row?.order || row;
      if (!incidentOrder?.orderId) throw new Error('ACTIVE_INCIDENT_ORDER_MISSING');
      const market = String(row?.issue?.raw?.market || incidentOrder?.raw?.market || 'UNKNOWN');
      byIdentity.set(`${market}:${String(incidentOrder.orderId)}`, {
        ...incidentOrder,
        status: 'INCIDENCE',
        raw: {
          ...(incidentOrder.raw || {}),
          issues: row?.issue || incidentOrder.raw?.issues || null
        }
      });
    }
  }
  return [...byIdentity.values()];
}

export async function scanForBlockingActivePriorOrder({ currentOrder, ...snapshotOptions }) {
  const snapshot = await collectActiveOrderSnapshot(snapshotOptions);
  return findBlockingActivePriorOrder(currentOrder, snapshot);
}

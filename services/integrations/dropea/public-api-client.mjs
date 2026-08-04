import {
  assertExactReadOnlyScopes,
  loadDropeaContract,
  marketHost,
  operationDefinition,
  DropeaContractError
} from './contract.mjs';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RATE_LIMIT = 45;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeErrorBody(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    success: value.success === true,
    message: typeof value.message === 'string' ? value.message.slice(0, 300) : null,
    failure_present: value.failure !== undefined && value.failure !== null
  };
}

export class DropeaReadError extends Error {
  constructor(message, code, { status = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = 'DropeaReadError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

class SlidingWindowLimiter {
  constructor({ limit = DEFAULT_RATE_LIMIT, windowMs = 60_000, now = Date.now, wait = sleep } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.wait = wait;
    this.timestamps = [];
  }

  async acquire() {
    while (true) {
      const current = this.now();
      this.timestamps = this.timestamps.filter((timestamp) => current - timestamp < this.windowMs);
      if (this.timestamps.length < this.limit) {
        this.timestamps.push(current);
        return;
      }
      const delay = Math.max(1, this.windowMs - (current - this.timestamps[0]));
      await this.wait(delay);
    }
  }
}

class CircuitBreaker {
  constructor({ threshold = 5, cooldownMs = 30_000, now = Date.now } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
  }

  assertClosed() {
    if (this.openedAt === null) return;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.openedAt = null;
      this.failures = 0;
      return;
    }
    throw new DropeaReadError('Dropea read circuit is open', 'DROPEA_CIRCUIT_OPEN', { retryable: true });
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}

function substitutePath(template, params = {}) {
  const used = new Set();
  const route = template.replace(/\{([^}]+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new DropeaContractError(`Missing Dropea path parameter ${name}`, 'DROPEA_PATH_PARAMETER_MISSING');
    }
    used.add(name);
    return encodeURIComponent(String(value));
  });
  return { route, used };
}

function queryValue(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function validateScalar(name, value, schema = {}) {
  if (schema.type === 'integer' && !Number.isInteger(Number(value))) {
    throw new DropeaContractError(`Invalid integer parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.type === 'number' && !Number.isFinite(Number(value))) {
    throw new DropeaContractError(`Invalid numeric parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw new DropeaContractError(`Invalid boolean parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new DropeaContractError(`Invalid enum parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.minimum !== undefined && Number(value) < schema.minimum) {
    throw new DropeaContractError(`Parameter below minimum ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.maximum !== undefined && Number(value) > schema.maximum) {
    throw new DropeaContractError(`Parameter above maximum ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.minLength !== undefined && String(value).length < schema.minLength) {
    throw new DropeaContractError(`Parameter too short ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.maxLength !== undefined && String(value).length > schema.maxLength) {
    throw new DropeaContractError(`Parameter too long ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(String(value))) {
    throw new DropeaContractError(`Parameter pattern mismatch ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
  if (schema.format === 'date-time' && Number.isNaN(new Date(value).getTime())) {
    throw new DropeaContractError(`Invalid date-time parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
  }
}

function validateOperationParams(document, operation, params) {
  const definition = document.paths?.[operation.path]?.get;
  const declared = new Map((definition?.parameters || []).map((parameter) => [parameter.name, parameter]));
  for (const parameter of declared.values()) {
    if (parameter.required && (params[parameter.name] === undefined || params[parameter.name] === null || params[parameter.name] === '')) {
      throw new DropeaContractError(`Missing Dropea parameter ${parameter.name}`, 'DROPEA_PARAMETER_REQUIRED');
    }
  }
  for (const [name, value] of Object.entries(params)) {
    const parameter = declared.get(name);
    if (!parameter) throw new DropeaContractError(`Unknown Dropea parameter ${name}`, 'DROPEA_PARAMETER_NOT_DECLARED');
    const candidates = parameter.schema?.oneOf || [parameter.schema || {}];
    const candidate = candidates.find((schema) => schema.type === (Array.isArray(value) ? 'array' : typeof value)) || candidates[0];
    if (Array.isArray(value)) {
      if (candidate.type !== 'array') throw new DropeaContractError(`Invalid array parameter ${name}`, 'DROPEA_PARAMETER_SCHEMA_INVALID');
      for (const item of value) validateScalar(name, item, candidate.items || {});
    } else {
      validateScalar(name, value, candidate);
    }
  }
}

function buildUrl(host, template, params = {}) {
  const { route, used } = substitutePath(template, params);
  const url = new URL(`https://${host}${route}`);
  for (const [name, raw] of Object.entries(params)) {
    if (used.has(name) || raw === undefined || raw === null || raw === '') continue;
    const values = queryValue(raw);
    for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(name, value);
  }
  return url;
}

function validateEnvelope(payload, paginated) {
  if (!payload || typeof payload !== 'object' || payload.success !== true || typeof payload.message !== 'string' || !('data' in payload)) {
    throw new DropeaReadError('Dropea response violates the success envelope', 'DROPEA_RESPONSE_SCHEMA_INVALID');
  }
  if (paginated) {
    const data = payload.data;
    const pagination = data?.pagination;
    if (!Array.isArray(data?.items)
      || !pagination
      || !['total', 'page', 'limit', 'total_pages'].every((key) => Number.isInteger(pagination[key]))) {
      throw new DropeaReadError('Dropea response violates the pagination schema', 'DROPEA_PAGINATION_SCHEMA_INVALID');
    }
  }
  return payload;
}

function isPaginatedOperation(name) {
  return ['listIssues', 'listOrders', 'listProducts', 'listShops', 'listShopOrders', 'listShopProducts'].includes(name);
}

export function createDropeaPublicApiClient({
  token,
  market,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  maxRetries = 2,
  retryBaseMs = 250,
  rateLimitPerMinute = DEFAULT_RATE_LIMIT,
  now = Date.now,
  wait = sleep,
  circuitThreshold = 5,
  circuitCooldownMs = 30_000,
  audit = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const { document } = loadDropeaContract();
  assertExactReadOnlyScopes(token);
  const host = marketHost(market);
  const limiter = new SlidingWindowLimiter({ limit: rateLimitPerMinute, now, wait });
  const circuit = new CircuitBreaker({ threshold: circuitThreshold, cooldownMs: circuitCooldownMs, now });

  async function request(name, params = {}) {
    const operation = operationDefinition(name);
    validateOperationParams(document, operation, params);
    const url = buildUrl(host, operation.path, params);
    circuit.assertClosed();
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await limiter.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          body: undefined,
          redirect: 'error',
          signal: controller.signal
        });
        const remaining = response.headers.get('x-ratelimit-remaining');
        const body = await response.json().catch(() => null);
        if (response.ok) {
          const payload = validateEnvelope(body, isPaginatedOperation(name));
          circuit.success();
          audit({ source: 'DROPEA_PUBLIC_API', operation: operation.operationId, result: 'READ_OK', status: response.status, rate_limit_remaining: remaining });
          return payload;
        }

        const retryable = RETRYABLE.has(response.status);
        lastError = new DropeaReadError('Dropea read request failed', `DROPEA_HTTP_${response.status}`, {
          status: response.status,
          retryable,
          details: safeErrorBody(body)
        });
        if (!retryable || attempt === maxRetries) throw lastError;
        const retryAfter = Number(response.headers.get('retry-after'));
        await wait(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : retryBaseMs * (2 ** attempt));
      } catch (error) {
        lastError = error instanceof DropeaReadError
          ? error
          : new DropeaReadError('Dropea transport failed', 'DROPEA_TRANSPORT_FAILED', { retryable: true });
        if (!lastError.retryable || attempt === maxRetries) {
          circuit.failure();
          audit({ source: 'DROPEA_PUBLIC_API', operation: operation.operationId, result: 'READ_FAILED', code: lastError.code, status: lastError.status });
          throw lastError;
        }
        await wait(retryBaseMs * (2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    circuit.failure();
    throw lastError;
  }

  async function listAll(name, params = {}, {
    maxPages = 200,
    maxRecords = 20_000,
    requestedLimit = 100,
    pagePauseMs = 0,
    onCheckpoint = async () => {}
  } = {}) {
    if (!isPaginatedOperation(name)) {
      throw new DropeaContractError('Operation is not paginated', 'DROPEA_OPERATION_NOT_PAGINATED');
    }
    const items = [];
    const seenKeys = new Set();
    const seenPageFingerprints = new Set();
    let page = Number(params.page || 1);
    const firstPage = page;
    const limit = Math.min(Number(params.limit || requestedLimit), 100);
    let duplicateCount = 0;
    let recordsRead = 0;
    let terminationReason = null;
    while (true) {
      if (page > maxPages) throw new DropeaReadError('Dropea pagination exceeded safety limit', 'DROPEA_MAX_PAGES_EXCEEDED');
      const payload = await request(name, { ...params, page, limit });
      const data = payload.data;
      if (data.pagination.page !== page) throw new DropeaReadError('Dropea pagination page mismatch', 'DROPEA_PAGE_MISMATCH');
      const fingerprint = JSON.stringify(data.items.map((item) => item?.id ?? item?.order_id ?? item));
      if (seenPageFingerprints.has(fingerprint) && data.items.length > 0) {
        throw new DropeaReadError('Dropea pagination repeated a page', 'DROPEA_PAGE_REPEATED');
      }
      seenPageFingerprints.add(fingerprint);
      recordsRead += data.items.length;
      for (const item of data.items) {
        const resourceId = item?.id ?? item?.order_id;
        if (resourceId === undefined || resourceId === null) {
          throw new DropeaReadError('Dropea paginated item has no stable identity', 'DROPEA_ITEM_ID_MISSING');
        }
        const storeId = item?.store_id ?? params.store_id ?? params.id ?? 'NO_STORE';
        const key = `${String(market).toUpperCase()}:${storeId}:${resourceId}`;
        if (seenKeys.has(key)) {
          duplicateCount += 1;
          continue;
        }
        seenKeys.add(key);
        items.push(item);
      }
      if (items.length > maxRecords) throw new DropeaReadError('Dropea pagination exceeded record safety limit', 'DROPEA_MAX_RECORDS_EXCEEDED');
      await onCheckpoint(Object.freeze({
        operation: name,
        market: String(market).toUpperCase(),
        page,
        requested_limit: limit,
        items_received: data.items.length,
        records_read: recordsRead,
        unique_records: items.length,
        duplicates_skipped: duplicateCount
      }));
      if (data.items.length === 0) {
        terminationReason = 'EMPTY_PAGE';
        break;
      }
      if (data.items.length < limit) {
        terminationReason = 'SHORT_PAGE';
        break;
      }
      page += 1;
      if (pagePauseMs > 0) await wait(pagePauseMs);
    }
    return {
      items,
      page_count: page - firstPage + 1,
      complete: true,
      termination_reason: terminationReason,
      records_read: recordsRead,
      duplicates_skipped: duplicateCount,
      requested_limit: limit,
      reported_total_pages: null
    };
  }

  return Object.freeze({
    market: String(market).toUpperCase(),
    host,
    mode: 'SHADOW_READ_ONLY',
    request,
    listAll
  });
}

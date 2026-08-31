import crypto from 'node:crypto';

const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const FORBIDDEN_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export class ReadOnlyViolation extends Error {
  constructor(message, code = 'READ_ONLY_VIOLATION') {
    super(message);
    this.name = 'ReadOnlyViolation';
    this.code = code;
  }
}

export function assertReadOnlyRequest(url, options = {}, allowedHosts = []) {
  const parsed = new URL(url);
  const method = String(options.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new ReadOnlyViolation(
      `Blocked HTTP method ${method}`,
      FORBIDDEN_METHODS.has(method) ? 'WRITE_METHOD_BLOCKED' : 'METHOD_NOT_ALLOWLISTED'
    );
  }
  if (options.body !== undefined && options.body !== null) {
    throw new ReadOnlyViolation('GET/HEAD requests cannot include a body', 'REQUEST_BODY_BLOCKED');
  }
  if (parsed.username || parsed.password) {
    throw new ReadOnlyViolation('Credentials in URLs are forbidden', 'URL_CREDENTIALS_BLOCKED');
  }
  if (allowedHosts.length && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new ReadOnlyViolation('Destination host is not allowlisted', 'HOST_NOT_ALLOWLISTED');
  }
  return { parsed, method };
}

export function createReadOnlyTransport({
  fetchImpl = globalThis.fetch,
  allowedHosts = [],
  timeoutMs = 15_000,
  maxRetries = 3,
  retryBaseMs = 250,
  maxRetryDelayMs = 60_000,
  minRequestIntervalMs = 0,
  waitImpl = wait,
  now = Date.now
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const hosts = allowedHosts.map((host) => String(host).toLowerCase());
  let nextRequestAt = 0;

  return async function readOnlyFetch(url, options = {}) {
    const { method } = assertReadOnlyRequest(url, options, hosts);
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const pacingDelay = Math.max(0, nextRequestAt - now());
      if (pacingDelay > 0) await waitImpl(pacingDelay);
      nextRequestAt = now() + Math.max(0, minRequestIntervalMs);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          ...options,
          method,
          body: undefined,
          signal: controller.signal,
          redirect: 'error'
        });
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxRetries) {
          return response;
        }
        const exponentialDelay = retryBaseMs * (2 ** attempt);
        const providerDelay = retryAfterMilliseconds(response.headers.get('retry-after'), now());
        await waitImpl(Math.min(maxRetryDelayMs, Math.max(exponentialDelay, providerDelay || 0)));
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) throw error;
        await waitImpl(Math.min(maxRetryDelayMs, retryBaseMs * (2 ** attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('Read-only request failed');
  };
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function collectPaginated({
  firstCursor = null,
  fetchPage,
  maxPages = 200,
  maxRuntimeMs = 10 * 60_000
}) {
  const started = Date.now();
  const items = [];
  const cursors = new Set();
  const pages = new Set();
  let cursor = firstCursor;
  let pageCount = 0;

  while (true) {
    if (pageCount >= maxPages) {
      return { complete: false, reason: 'MAX_PAGES_PER_SOURCE', items, page_count: pageCount };
    }
    if (Date.now() - started > maxRuntimeMs) {
      return { complete: false, reason: 'MAX_BATCH_RUNTIME', items, page_count: pageCount };
    }
    const cursorKey = cursor === null ? '__FIRST__' : String(cursor);
    if (cursors.has(cursorKey)) {
      return { complete: false, reason: 'REPEATED_CURSOR', items, page_count: pageCount };
    }
    cursors.add(cursorKey);

    const page = await fetchPage(cursor, pageCount + 1);
    const rows = Array.isArray(page?.items) ? page.items : [];
    const pageHash = fingerprint(rows);
    if (rows.length && pages.has(pageHash)) {
      return { complete: false, reason: 'REPEATED_PAGE', items, page_count: pageCount };
    }
    pages.add(pageHash);
    items.push(...rows);
    pageCount += 1;

    if (page?.next_cursor === null || page?.next_cursor === undefined || page?.next_cursor === '') {
      return { complete: true, reason: null, items, page_count: pageCount };
    }
    cursor = page.next_cursor;
  }
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACT_ROOT = path.resolve(HERE, '../../../contracts/external/dropea/public-api-v2/0.1.0');
export const CONTRACT_PATH = path.join(CONTRACT_ROOT, 'openapi.json');
export const MANIFEST_PATH = path.join(CONTRACT_ROOT, 'manifest.json');

export const APPROVED_READ_SCOPES = Object.freeze([
  'dp:issues:read',
  'dp:orders:read',
  'dp:products:read',
  'dp:stores:read',
  'dp:users:read',
  'dp:webhooks:read'
]);

export const APPROVED_MARKET_HOSTS = Object.freeze({
  ES: 'es.public-api.dropea.com',
  IT: 'it.public-api.dropea.com',
  PT: 'pt.public-api.dropea.com'
});

export const READ_OPERATIONS = Object.freeze({
  listCarriers: { operationId: 'dropshipperListCarriers', path: '/dropshipper/catalogs/carriers' },
  listOrderStatuses: { operationId: 'dropshipperListOrderStatuses', path: '/dropshipper/catalogs/order-statuses' },
  listIssues: { operationId: 'dropshipperListIssues', path: '/dropshipper/issues' },
  getIssue: { operationId: 'dropshipperGetIssueById', path: '/dropshipper/issues/{id}' },
  getMe: { operationId: 'dropshipperGetMe', path: '/dropshipper/me' },
  getOperation: { operationId: 'dropshipperGetOperationById', path: '/dropshipper/operations/{operation_id}' },
  listOrders: { operationId: 'dropshipperListOrders', path: '/dropshipper/orders' },
  getOrder: { operationId: 'dropshipperGetOrderById', path: '/dropshipper/orders/{id}' },
  listProducts: { operationId: 'dropshipperListProducts', path: '/dropshipper/products' },
  getProduct: { operationId: 'dropshipperGetProductById', path: '/dropshipper/products/{id}' },
  listShops: { operationId: 'dropshipperListShops', path: '/dropshipper/shops' },
  getShop: { operationId: 'dropshipperGetShopById', path: '/dropshipper/shops/{id}' },
  listShopOrders: { operationId: 'dropshipperListShopOrders', path: '/dropshipper/shops/{id}/orders' },
  listShopProducts: { operationId: 'dropshipperListShopProducts', path: '/dropshipper/shops/{id}/products' },
  listWebhooks: { operationId: 'dropshipperListWebhooks', path: '/dropshipper/webhooks' }
});

export class DropeaContractError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = 'DropeaContractError';
    this.code = code;
    this.details = details;
  }
}

export function loadDropeaContract() {
  const source = fs.readFileSync(CONTRACT_PATH);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const checksum = crypto.createHash('sha256').update(source).digest('hex');
  if (checksum !== manifest.sha256) {
    throw new DropeaContractError('Dropea OpenAPI checksum mismatch', 'DROPEA_CONTRACT_CHECKSUM_MISMATCH');
  }
  const document = JSON.parse(source.toString('utf8'));
  if (document.openapi !== manifest.openapi_version || document.info?.version !== manifest.contract_version) {
    throw new DropeaContractError('Dropea OpenAPI version mismatch', 'DROPEA_CONTRACT_VERSION_MISMATCH');
  }
  validateReadOperations(document);
  return { document, manifest, checksum };
}

function validateReadOperations(document) {
  for (const operation of Object.values(READ_OPERATIONS)) {
    const definition = document.paths?.[operation.path]?.get;
    if (!definition || definition.operationId !== operation.operationId) {
      throw new DropeaContractError(
        `Missing approved read operation ${operation.operationId}`,
        'DROPEA_READ_OPERATION_MISMATCH'
      );
    }
  }
}

function base64UrlJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new DropeaContractError('Dropea token claims cannot be inspected safely', 'DROPEA_TOKEN_CLAIMS_INVALID');
  }
}

export function tokenScopes(token) {
  const value = String(token || '').trim();
  const segments = value.split('.');
  if (segments.length !== 3) {
    throw new DropeaContractError('Dropea read token must be an inspectable JWT', 'DROPEA_TOKEN_NOT_INSPECTABLE');
  }
  const payload = base64UrlJson(segments[1]);
  const raw = payload.scope ?? payload.scopes ?? payload.permissions ?? payload.permission;
  const scopes = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
  return [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))].sort();
}

export function assertExactReadOnlyScopes(scopesOrToken) {
  const actual = Array.isArray(scopesOrToken)
    ? [...new Set(scopesOrToken.map(String))].sort()
    : tokenScopes(scopesOrToken);
  const approved = [...APPROVED_READ_SCOPES].sort();
  const unexpected = actual.filter((scope) => !approved.includes(scope));
  const missing = approved.filter((scope) => !actual.includes(scope));
  if (unexpected.length || missing.length) {
    throw new DropeaContractError(
      'Dropea token permissions are not the exact approved read-only set',
      unexpected.length ? 'DROPEA_WRITE_OR_UNKNOWN_SCOPE_BLOCKED' : 'DROPEA_REQUIRED_READ_SCOPE_MISSING',
      { unexpected, missing }
    );
  }
  return actual;
}

export function marketHost(market) {
  const normalized = String(market || '').trim().toUpperCase();
  const host = APPROVED_MARKET_HOSTS[normalized];
  if (!host) throw new DropeaContractError('Dropea market is not approved', 'DROPEA_MARKET_NOT_APPROVED');
  return host;
}

export function operationDefinition(name) {
  const operation = READ_OPERATIONS[name];
  if (!operation) throw new DropeaContractError('Dropea operation is not approved for reads', 'DROPEA_OPERATION_BLOCKED');
  return operation;
}

export function contractInventory(document = loadDropeaContract().document) {
  const inventory = [];
  for (const [route, pathItem] of Object.entries(document.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = pathItem[method];
      if (!operation) continue;
      inventory.push({
        method: method.toUpperCase(),
        path: route,
        operation_id: operation.operationId,
        permissions: operation['x-dropea-permissions'] || []
      });
    }
  }
  return inventory;
}

function schemaReference(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.$ref) return value.$ref;
  if (value.schema?.$ref) return value.schema.$ref;
  return value.schema?.type || value.type || null;
}

function canonicalTarget(route) {
  if (route.includes('/issues')) return 'canonical_incidents';
  if (route.includes('/orders')) return 'canonical_orders';
  if (route.includes('/operations')) return 'integration_dropea_operations';
  if (route.includes('/webhooks')) return 'integration_dropea_webhook_catalog';
  if (route.includes('/catalogs')) return 'integration_dropea_catalog_cache';
  if (route.includes('/products')) return 'integration_dropea_products';
  if (route.includes('/shops')) return 'integration_dropea_shops';
  if (route.endsWith('/me')) return 'integration_dropea_identity';
  return 'documented_external_capability';
}

export function contractOperationMatrix(document = loadDropeaContract().document) {
  const implementedReadIds = new Set(Object.values(READ_OPERATIONS).map((item) => item.operationId));
  return contractInventory(document).map((item) => {
    const operation = document.paths[item.path]?.[item.method.toLowerCase()] || {};
    const parameters = operation.parameters || [];
    const success = Object.entries(operation.responses || {}).find(([status]) => /^2\d\d$/.test(status))?.[1];
    const requestBody = operation.requestBody?.content?.['application/json'];
    const responseBody = success?.content?.['application/json'];
    const errorCodes = Object.keys(operation.responses || {}).filter((status) => !/^2\d\d$/.test(status));
    return Object.freeze({
      operation_id: item.operation_id,
      method: item.method,
      path: item.path,
      scope: item.permissions,
      request_schema: schemaReference(requestBody),
      response_schema: schemaReference(responseBody),
      pagination: parameters.some((parameter) => ['page', 'limit'].includes(parameter.name)),
      idempotency: parameters.some((parameter) => /idempot/i.test(parameter.name)),
      async_behavior: item.path.includes('/operations') || Boolean(operation.responses?.['202']),
      errors: errorCodes,
      suleia_mode: item.method === 'GET' ? 'SHADOW_READ_ONLY' : 'DOCUMENTED_NOT_IMPLEMENTED',
      canonical_target: canonicalTarget(item.path),
      implemented: item.method === 'GET' && implementedReadIds.has(item.operation_id),
      verified_live: false
    });
  });
}

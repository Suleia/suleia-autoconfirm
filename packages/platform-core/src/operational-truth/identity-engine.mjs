import { C0_SCHEMA_VERSION, IDENTITY_STATUSES, stableId } from './contracts.mjs';

const ALLOWED_NAMESPACES = new Set([
  'shopify_order_id', 'shopify_gid', 'shopify_order_number', 'dropea_order_id',
  'dropea_external_reference', 'chatby_conversation_id', 'gls_tracking_hash',
  'shipment_reference', 'system_current_order_id', 'event_store_aggregate_id', 'digital_twin_id'
]);

export function validateCanonicalIdentity(input = {}) {
  const links = Array.isArray(input.links) ? input.links : [];
  const invalidNamespaces = links.filter((link) => !ALLOWED_NAMESPACES.has(link.namespace));
  const grouped = new Map();
  for (const link of links) {
    if (!grouped.has(link.namespace)) grouped.set(link.namespace, new Set());
    grouped.get(link.namespace).add(String(link.value_hash || ''));
  }
  const conflicts = [...grouped].filter(([, values]) => values.size > 1).map(([namespace]) => namespace);
  const exactLinks = links.filter((link) => link.verification === 'EXACT');
  const verifiedLinks = links.filter((link) => link.verification === 'VERIFIED');
  let status = 'UNKNOWN';
  if (invalidNamespaces.length || conflicts.length) status = 'CONFLICTING';
  else if (exactLinks.length >= 2) status = 'EXACT';
  else if (exactLinks.length + verifiedLinks.length >= 2) status = 'VERIFIED';
  else if (links.length) status = 'PARTIAL';
  if (!IDENTITY_STATUSES.includes(status)) throw new Error('Invalid identity status');
  return Object.freeze({
    canonical_identity_id: stableId('identity', links),
    canonical_order_id: String(input.canonical_order_id || ''),
    status,
    namespaces: [...new Set(links.map((link) => link.namespace))].toSorted(),
    conflicting_namespaces: conflicts.toSorted(),
    invalid_namespaces: invalidNamespaces.map((link) => link.namespace).toSorted(),
    comparison_allowed: ['EXACT', 'VERIFIED'].includes(status),
    shadow_eligible: ['EXACT', 'VERIFIED'].includes(status),
    schema_version: C0_SCHEMA_VERSION
  });
}

export { ALLOWED_NAMESPACES };


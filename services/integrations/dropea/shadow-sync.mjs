import { mapDropeaIssue, mapDropeaOrder } from '../../../packages/platform-core/src/operational-truth/dropea-canonical.mjs';

function zeroActionResult(values = {}) {
  return Object.freeze({
    ...values,
    run_mode: 'SHADOW_READ_ONLY',
    actions_executed: 0,
    production_writes: 0
  });
}

export async function syncDropeaPublicApi({
  client,
  projector,
  hmacKey,
  now = () => new Date(),
  maxPages = 200,
  maxRecords = 20_000
}) {
  const startedAt = now().toISOString();
  try {
    const [orderPage, issuePage] = await Promise.all([
      client.listAll('listOrders', {}, { maxPages, maxRecords }),
      client.listAll('listIssues', {}, { maxPages, maxRecords })
    ]);
    const observedAt = now().toISOString();
    const orders = orderPage.items.map((order) => mapDropeaOrder(order, { hmacKey, observedAt }));
    const orderIdentity = new Map(orders.map((order) => [order.dropea_order_id, order.canonical_order_id]));
    const orphanIssues = issuePage.items.filter((issue) => !orderIdentity.has(String(issue.order_id)));
    const issues = issuePage.items
      .filter((issue) => orderIdentity.has(String(issue.order_id)))
      .map((issue) => mapDropeaIssue(issue, {
        hmacKey,
        canonicalOrderId: orderIdentity.get(String(issue.order_id)),
        observedAt
      }));

    for (const order of orders) await projector.upsertOrder(order);
    for (const issue of issues) await projector.upsertIssue(issue);

    const dataHealth = orphanIssues.length === 0 ? 'HEALTHY' : 'DEGRADED';
    await projector.connectorHealth({
      connector: `DROPEA_PUBLIC_API_${client.market}`,
      transport_health: 'HEALTHY',
      data_health: dataHealth,
      last_success_at: observedAt,
      last_failure_at: null,
      lag_seconds: 0,
      pagination_complete: orderPage.complete && issuePage.complete,
      checked_at: observedAt
    });

    return zeroActionResult({
      ok: orphanIssues.length === 0,
      started_at: startedAt,
      completed_at: observedAt,
      orders_projected: orders.length,
      issues_projected: issues.length,
      orphan_issues_blocked: orphanIssues.length,
      pages_read: orderPage.page_count + issuePage.page_count,
      pagination_complete: orderPage.complete && issuePage.complete
    });
  } catch (error) {
    const failedAt = now().toISOString();
    await projector.connectorHealth({
      connector: `DROPEA_PUBLIC_API_${client.market}`,
      transport_health: 'FAILED',
      data_health: 'UNKNOWN',
      last_success_at: null,
      last_failure_at: failedAt,
      lag_seconds: null,
      pagination_complete: false,
      checked_at: failedAt
    }).catch(() => {});
    throw error;
  }
}

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
  storeConfig = null,
  phase = 'INCREMENTAL',
  dryRun = false,
  hmacKey,
  testPhoneNormalized = null,
  now = () => new Date(),
  maxPages = 200,
  maxRecords = 20_000
}) {
  const startedAt = now().toISOString();
  try {
    const storeId = storeConfig?.store_id || null;
    const upperPhase = String(phase).toUpperCase();
    const current = now();
    const todayStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())).toISOString();
    const persistedIncrementalStart = upperPhase === 'INCREMENTAL' && storeConfig && projector.latestSyncSourceUpdatedAt
      ? await projector.latestSyncSourceUpdatedAt({
        market: client.market, storeId, resourceType: 'orders', phase: upperPhase
      })
      : null;
    const incrementalStart = persistedIncrementalStart || storeConfig?.migration_cutover_at;
    const orderParams = storeConfig ? {
      store_id: Number(storeId), sort_by: 'created_at', sort_order: 'desc',
      ...(upperPhase === 'CANARY' ? { date_from: storeConfig.native_v2_activation_at, date_to: current.toISOString(), date_type: 'created_at' } : {}),
      ...(upperPhase === 'TODAY' ? { date_from: todayStart, date_to: current.toISOString(), date_type: 'created_at' } : {}),
      ...(upperPhase === 'BACKFILL' && !storeConfig.historical_reingestion_allowed
        ? { date_from: storeConfig.migration_cutover_at, date_to: current.toISOString(), date_type: 'created_at' }
        : {}),
      ...(upperPhase === 'BACKFILL' && storeConfig.historical_reingestion_allowed
        ? { date_to: current.toISOString(), date_type: 'created_at' }
        : {}),
      ...(upperPhase === 'INCREMENTAL' ? { date_from: incrementalStart, date_to: current.toISOString(), date_type: 'updated_at' } : {})
    } : {};
    const orderPage = upperPhase === 'CANARY'
      ? await client.request('listOrders', { ...orderParams, page: 1, limit: 5 }).then((payload) => ({
        items: payload.data.items, page_count: 1, complete: true, records_read: payload.data.items.length,
        duplicates_skipped: 0, requested_limit: 5, termination_reason: 'CANARY_LIMIT'
      }))
      : await client.listAll('listOrders', orderParams, {
        maxPages, maxRecords, requestedLimit: 100, pagePauseMs: 400,
        onCheckpoint: async (checkpoint) => {
          if (!dryRun && projector.syncCheckpoint && storeConfig) await projector.syncCheckpoint({
            ...checkpoint, store_id: storeId, resource_type: 'orders', phase: upperPhase,
            sync_started_at: startedAt, checkpoint_masked: { page: checkpoint.page },
            freshness: 'SYNCING', pagination_complete: false
          });
        }
      });
    const issueParams = upperPhase === 'BACKFILL' ? {} : { only_pending_to_resolve: true };
    const issuePage = await client.listAll('listIssues', issueParams, {
      maxPages, maxRecords, requestedLimit: 100, pagePauseMs: 400
    });
    const observedAt = now().toISOString();
    const initiallyMapped = orderPage.items.map((order) => mapDropeaOrder(order, {
      hmacKey, market: client.market, migrationCutoverAt: storeConfig?.migration_cutover_at || null,
      observedAt, testPhoneNormalized
    }));
    const orders = [];
    let historicalOrdersBlocked = 0, identitiesReused = 0, identityConflictsBlocked = 0;
    for (const order of initiallyMapped) {
      if (!projector.resolveCanonicalOrder) { orders.push(order); continue; }
      const resolution = await projector.resolveCanonicalOrder(order);
      if (resolution.status === 'CONFLICT') { identityConflictsBlocked += 1; continue; }
      if (order.historical_pre_cutover && resolution.status === 'NOT_FOUND'
          && storeConfig?.historical_reingestion_allowed !== true) {
        historicalOrdersBlocked += 1; continue;
      }
      if (resolution.canonical_order_id && resolution.canonical_order_id !== order.canonical_order_id) {
        identitiesReused += 1;
        orders.push(Object.freeze({ ...order, canonical_order_id: resolution.canonical_order_id,
          identity_status: 'VERIFIED', duplicate_status: 'V1_V2_IDENTITY_REUSED' }));
      } else orders.push(order);
    }
    const orderIdentity = new Map(orders.map((order) => [order.dropea_order_id, order]));
    const issueCandidates = upperPhase === 'CANARY'
      ? issuePage.items.filter((issue) => orderIdentity.has(String(issue.order_id)))
      : issuePage.items;
    const issuesOutOfScope = issuePage.items.length - issueCandidates.length;
    const orphanIssues = [];
    for (const issue of issueCandidates) {
      const dropeaOrderId = String(issue.order_id);
      if (orderIdentity.has(dropeaOrderId)) continue;
      if (!projector.resolveCanonicalOrderByDropeaId || !storeConfig) {
        orphanIssues.push(issue);
        continue;
      }
      const resolution = await projector.resolveCanonicalOrderByDropeaId({
        market: client.market,
        storeId,
        dropeaOrderId
      });
      if (resolution.status !== 'FOUND') {
        orphanIssues.push(issue);
        continue;
      }
      orderIdentity.set(dropeaOrderId, {
        canonical_order_id: resolution.canonical_order_id,
        store_id: storeId
      });
    }
    const orphanIds = new Set(orphanIssues.map((issue) => String(issue.id)));
    const issues = issueCandidates
      .filter((issue) => !orphanIds.has(String(issue.id)))
      .map((issue) => mapDropeaIssue(issue, {
        hmacKey,
        canonicalOrderId: orderIdentity.get(String(issue.order_id)).canonical_order_id,
        market: client.market,
        storeId: orderIdentity.get(String(issue.order_id)).store_id,
        observedAt
      }));

    let ordersInserted = 0, ordersUpdated = 0, issuesInserted = 0, issuesUpdated = 0;
    if (!dryRun) {
      for (const order of orders) {
        const result = await projector.upsertOrder(order);
        if (result?.inserted) ordersInserted += 1; else ordersUpdated += 1;
      }
      for (const issue of issues) {
        const result = await projector.upsertIssue(issue);
        if (result?.inserted) issuesInserted += 1; else issuesUpdated += 1;
      }
    }

    const dataHealth = orphanIssues.length === 0 ? 'HEALTHY' : 'DEGRADED';
    if (!dryRun) await projector.connectorHealth({
      connector: `DROPEA_PUBLIC_API_${client.market}`,
      transport_health: 'HEALTHY',
      data_health: dataHealth,
      last_success_at: observedAt,
      last_failure_at: null,
      lag_seconds: 0,
      pagination_complete: orderPage.complete && issuePage.complete,
      checked_at: observedAt
    });
    if (!dryRun && projector.syncCheckpoint && storeConfig) {
      await projector.syncCheckpoint({
        market: client.market, store_id: storeId, resource_type: 'orders', phase: upperPhase,
        page: orderPage.page_count, requested_limit: orderPage.requested_limit || 100,
        records_read: orderPage.records_read ?? orderPage.items.length,
        records_inserted_to_shadow: ordersInserted, records_updated_in_shadow: ordersUpdated,
        duplicates_skipped: orderPage.duplicates_skipped || 0, errors: 0,
        checkpoint_masked: { termination_reason: orderPage.termination_reason },
        sync_started_at: startedAt, sync_completed_at: observedAt,
        source_updated_at: orders.reduce((latest, order) => !latest || order.updated_at > latest ? order.updated_at : latest, null),
        freshness: 'FRESH', pagination_complete: orderPage.complete
      });
      await projector.syncCheckpoint({
        market: client.market, store_id: storeId, resource_type: 'issues', phase: upperPhase,
        page: issuePage.page_count, requested_limit: issuePage.requested_limit || 100,
        records_read: issuePage.records_read ?? issuePage.items.length,
        records_inserted_to_shadow: issuesInserted, records_updated_in_shadow: issuesUpdated,
        duplicates_skipped: issuePage.duplicates_skipped || 0, errors: 0,
        checkpoint_masked: { termination_reason: issuePage.termination_reason },
        sync_started_at: startedAt, sync_completed_at: observedAt,
        source_updated_at: issues.reduce((latest, issue) => !latest || issue.updated_at > latest ? issue.updated_at : latest, null),
        freshness: 'FRESH', pagination_complete: issuePage.complete
      });
    }

    return zeroActionResult({
      ok: orphanIssues.length === 0,
      started_at: startedAt,
      completed_at: observedAt,
      orders_projected: orders.length,
      issues_projected: issues.length,
      orders_inserted_to_shadow: ordersInserted,
      orders_updated_in_shadow: ordersUpdated,
      issues_inserted_to_shadow: issuesInserted,
      issues_updated_in_shadow: issuesUpdated,
      dry_run: dryRun,
      phase: upperPhase,
      orphan_issues_blocked: orphanIssues.length,
      issues_out_of_scope: issuesOutOfScope,
      historical_orders_blocked: historicalOrdersBlocked,
      identities_reused: identitiesReused,
      identity_conflicts_blocked: identityConflictsBlocked,
      pages_read: orderPage.page_count + issuePage.page_count,
      pagination_complete: orderPage.complete && issuePage.complete
    });
  } catch (error) {
    const failedAt = now().toISOString();
    if (!dryRun) await projector.connectorHealth({
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

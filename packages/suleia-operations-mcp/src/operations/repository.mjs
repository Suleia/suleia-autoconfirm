import { evaluateSourceFreshness } from '../../../platform-core/src/operational-truth/freshness.mjs';

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function filters(searchParams, allowlist) {
  const clauses = [];
  const values = [];
  for (const [queryName, column] of Object.entries(allowlist)) {
    const value = searchParams.get(queryName);
    if (value === null || value === '') continue;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }
  return { clauses, values };
}

function incidentSelection(searchParams) {
  const selected = filters(searchParams, {
    status: 'status', type: 'interpreted_type', risk: 'risk',
    freshness: 'effective_freshness_status', mapping: 'mapping_status',
    response: 'response_evidence_status', timer: 'effective_timer_status',
    decision: 'simulated_decision', qa: 'qa_status', carrier_code: 'initial_carrier_code'
  });
  const scope = String(searchParams.get('scope') || 'ACTIVE').toUpperCase();
  if (scope === 'ACTIVE') selected.clauses.push("status='PENDING' AND is_active=true");
  else if (scope === 'HISTORICAL') selected.clauses.push("NOT (status='PENDING' AND is_active=true)");
  else if (scope !== 'ALL') selected.clauses.push("status='PENDING' AND is_active=true");

  const active = searchParams.get('active');
  if (active === 'true' || active === 'false') {
    selected.values.push(active === 'true');
    selected.clauses.push(`is_active=$${selected.values.length}::boolean`);
  }
  const from = searchParams.get('from');
  if (from) {
    selected.values.push(from);
    selected.clauses.push(`created_at >= $${selected.values.length}::timestamptz`);
  }
  const to = searchParams.get('to');
  if (to) {
    selected.values.push(to);
    selected.clauses.push(`created_at <= $${selected.values.length}::timestamptz`);
  }
  const query = searchParams.get('q');
  if (query) {
    selected.values.push(query);
    selected.clauses.push(`(canonical_issue_id=$${selected.values.length} OR dropea_issue_id=$${selected.values.length}
      OR canonical_order_id=$${selected.values.length} OR dropea_order_id=$${selected.values.length})`);
  }
  return { ...selected, scope };
}

function financialWindow(searchParams) {
  const period = searchParams.get('period') || '30d';
  const days = { '7d': 7, '30d': 30, '90d': 90, all: null }[period];
  if (days === undefined) return { period: '30d', from: new Date(Date.now() - 30 * 86_400_000).toISOString() };
  return { period, from: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString() };
}

export class OperationsRepository {
  constructor(databaseUrl, { pool = null } = {}) {
    if (!pool) throw new Error('Use OperationsRepository.connect for a database connection');
    this.pool = pool;
  }

  static async connect(databaseUrl) {
    const { default: pg } = await import('pg');
    return new OperationsRepository(databaseUrl, { pool: new pg.Pool({
      connectionString: databaseUrl, max: 5, application_name: 'suleia-operations-center',
      statement_timeout: 10_000, query_timeout: 12_000
    }) });
  }

  async close() { await this.pool.end(); }

  async summary(searchParams = new URLSearchParams()) {
    const incidentFilters = incidentSelection(searchParams);
    const incidentWhere = incidentFilters.clauses.length ? `WHERE ${incidentFilters.clauses.join(' AND ')}` : '';
    const [orders, incidents, protections, health, orderFlow] = await Promise.all([
      this.pool.query('SELECT * FROM read_models.operations_orders_summary'),
      this.pool.query(`SELECT
        count(*)::integer AS pending,
        count(*) FILTER (WHERE response_evidence_status='VALID_RESPONSE')::integer AS responded,
        count(*) FILTER (WHERE response_evidence_status='NO_VALID_RESPONSE')::integer AS awaiting_customer,
        count(*) FILTER (WHERE response_evidence_status='NOT_VERIFIABLE')::integer AS not_verifiable,
        count(*) FILTER (WHERE risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
        count(*) FILTER (WHERE cardinality(effective_blocking_reasons)>0)::integer AS blocked,
        count(*) FILTER (WHERE effective_freshness_status IN ('STALE','UNAVAILABLE','UNKNOWN'))::integer AS stale,
        count(*) FILTER (WHERE effective_timer_status='EXPIRED')::integer AS timers_expired,
        max(panel_updated_at) AS last_sync_at,$${incidentFilters.values.length + 1}::text AS scope,
        0::integer AS actions_executed,0::integer AS production_writes
      FROM read_models.operations_incident_panel_context ${incidentWhere}`,
      [...incidentFilters.values, incidentFilters.scope]),
      this.pool.query('SELECT * FROM read_models.operations_protection_summary'),
      this.pool.query('SELECT * FROM read_models.operations_connector_health ORDER BY connector'),
      this.pool.query(`SELECT
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING')::integer AS pending,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('CONFIRMED','PROCESSING'))::integer AS confirmed,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='SHIPPING')::integer AS shipping,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('DELIVERED','FINISHED'))::integer AS delivered,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='INCIDENCE')::integer AS incidence,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('CANCELLED','REJECTED'))::integer AS cancelled_or_rejected,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='RETURNED')::integer AS returned,
        count(*) FILTER (WHERE human_review)::integer AS human_review,
        count(*) FILTER (WHERE active_issue_id IS NOT NULL)::integer AS with_active_issue
      FROM read_models.operations_order_context`)
    ]);
    const connectors = health.rows.map((row) => {
      const freshness = evaluateSourceFreshness({
        source: row.connector, source_observed_at: row.checked_at, ingested_at: row.checked_at,
        last_successful_sync_at: row.last_success_at, last_failure_at: row.last_failure_at,
        sync_complete: row.pagination_complete
      });
      return { ...row, ...freshness,
        data_health: freshness.freshness_status === 'FRESH' ? row.data_health : freshness.freshness_status };
    });
    return {
      orders: { ...(orders.rows[0] || {}), ...(orderFlow.rows[0] || {}) },
      incidents: incidents.rows[0] || {}, protections: protections.rows[0] || {}, connectors
    };
  }

  async financialSummary(searchParams) {
    const window = financialWindow(searchParams);
    const values = [window.from];
    const where = `WHERE ($1::timestamptz IS NULL OR coalesce(created_at_utc,source_updated_at,updated_at) >= $1::timestamptz)`;
    const [totals, states, daily] = await Promise.all([
      this.pool.query(`SELECT
        count(*)::integer AS orders_total,
        count(total_amount)::integer AS orders_with_amount,
        coalesce(sum(total_amount),0)::numeric(14,2) AS gross_order_value,
        count(*) FILTER (WHERE confirmed_at_utc IS NOT NULL)::integer AS confirmed,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='SHIPPING')::integer AS shipping,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('DELIVERED','FINISHED'))::integer AS delivered,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='INCIDENCE')::integer AS incidences,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='RETURNED')::integer AS returned,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('PENDING','CONFIRMED','PROCESSING','SHIPPING','INCIDENCE'))::integer AS open_orders,
        coalesce(sum(total_amount) FILTER (WHERE coalesce(lifecycle_status,status) IN ('DELIVERED','FINISHED')),0)::numeric(14,2) AS delivered_order_value,
        coalesce(sum(total_amount) FILTER (WHERE coalesce(lifecycle_status,status) IN ('PENDING','CONFIRMED','PROCESSING','SHIPPING','INCIDENCE')),0)::numeric(14,2) AS open_order_value,
        count(DISTINCT currency)::integer AS currency_count,
        min(currency) AS currency,
        max(source_updated_at) AS source_updated_at
      FROM read_models.operations_order_context ${where}`, values),
      this.pool.query(`SELECT coalesce(lifecycle_status,status) AS state,count(*)::integer AS orders,
        coalesce(sum(total_amount),0)::numeric(14,2) AS order_value
      FROM read_models.operations_order_context ${where}
      GROUP BY 1 ORDER BY orders DESC,state`, values),
      this.pool.query(`SELECT date_trunc('day',coalesce(created_at_utc,source_updated_at,updated_at))::date AS day,
        count(*)::integer AS orders,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status) IN ('DELIVERED','FINISHED'))::integer AS delivered,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='INCIDENCE')::integer AS incidences,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='RETURNED')::integer AS returned,
        coalesce(sum(total_amount),0)::numeric(14,2) AS gross_order_value,
        coalesce(sum(total_amount) FILTER (WHERE coalesce(lifecycle_status,status) IN ('DELIVERED','FINISHED')),0)::numeric(14,2) AS delivered_order_value
      FROM read_models.operations_order_context ${where}
      GROUP BY 1 ORDER BY day DESC LIMIT 120`, values)
    ]);
    const total = totals.rows[0] || {};
    return {
      perspective: 'DROPEA_COHORT', period: window.period, from: window.from,
      exactness: 'ORDER_VALUE_ONLY', provisional: true,
      totals: total, states: states.rows, daily: daily.rows,
      costs: {
        availability: 'PENDING_SOURCE', product: null, transport: null, fulfillment: null,
        cod: null, returns: null, advertising: null, external: null, total: null
      },
      profit: null, roi: null, margin: null,
      limitations: [
        'Dropea aporta el valor de los pedidos y sus estados.',
        'No hay todavía un ledger conciliado de costes, cargos, abonos o liquidaciones.',
        'Beneficio, ROI y margen permanecen no disponibles para evitar cifras falsas.'
      ],
      actions_executed: 0, production_writes: 0
    };
  }

  async listOrders(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = filters(searchParams, {
      status: 'status', lifecycle: 'coalesce(lifecycle_status,status)', risk: 'risk',
      freshness: 'freshness', identity: 'identity_status'
    });
    const protection = searchParams.get('protection');
    const protectionClauses = {
      DUPLICATE_ACTIVE_ORDER: "duplicate_status = 'DUPLICATE_ACTIVE_ORDER'",
      TEST_ORDER: 'test_order = true',
      CHATBY_DELETE_ELIGIBLE: "chatby_cleanup_status = 'DELETE_ELIGIBLE'",
      CHATBY_DELETE_FAILED: "chatby_cleanup_status = 'DELETE_FAILED'",
      RELEASIT_PENDING: "return_block_status IN ('BLOCK_ELIGIBLE','BLOCK_PENDING','BLOCK_REQUESTED')",
      RELEASIT_BLOCKED: "return_block_status IN ('BLOCKED_VERIFIED','ALREADY_BLOCKED')",
      RELEASIT_ERROR: "return_block_status IN ('BLOCK_FAILED','VERIFICATION_FAILED')",
      PROTECTION_REVIEW: 'protection_review = true'
    };
    if (protectionClauses[protection]) selected.clauses.push(protectionClauses[protection]);
    selected.values.push(limit, offset);
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT *, count(*) OVER()::integer AS total_count
       FROM read_models.operations_order_context ${where}
       ORDER BY updated_at DESC, canonical_order_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows, total: result.rows[0]?.total_count || 0, limit, offset };
  }

  async orderDetail(id) {
    const [detail, timeline, incidents] = await Promise.all([
      this.pool.query(`SELECT c.*,r.phone_last4,r.test_order,r.automatic_confirmation_allowed,
        r.chatby_cleanup_status,r.chatby_cleanup_blockers,r.return_block_status,r.return_block_reason,
        r.protection_review,r.protection_last_reconciled_at
      FROM read_models.operations_order_context c
      LEFT JOIN read_models.operations_order_records r USING(canonical_order_id)
      WHERE c.canonical_order_id=$1 OR c.dropea_order_id=$1 LIMIT 1`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_incident_panel_context
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY updated_at DESC`, [id])
    ]);
    return detail.rows[0] ? { order: detail.rows[0], timeline: timeline.rows, incidents: incidents.rows } : null;
  }

  async listIncidents(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = incidentSelection(searchParams);
    selected.values.push(limit, offset);
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT *, count(*) OVER()::integer AS total_count
       FROM read_models.operations_incident_panel_context ${where}
       ORDER BY updated_at DESC, canonical_issue_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows, total: result.rows[0]?.total_count || 0, limit, offset };
  }

  async incidentDetail(id) {
    const [detail, timeline] = await Promise.all([
      this.pool.query('SELECT * FROM read_models.operations_incident_panel_context WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1', [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_panel_context
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id])
    ]);
    return detail.rows[0] ? { incident: detail.rows[0], timeline: timeline.rows } : null;
  }
}

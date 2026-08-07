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

  async summary() {
    const [orders, incidents, protections, health] = await Promise.all([
      this.pool.query('SELECT * FROM read_models.operations_orders_summary'),
      this.pool.query('SELECT * FROM read_models.operations_incidents_summary'),
      this.pool.query('SELECT * FROM read_models.operations_protection_summary'),
      this.pool.query('SELECT * FROM read_models.operations_connector_health ORDER BY connector')
    ]);
    return { orders: orders.rows[0] || {}, incidents: incidents.rows[0] || {}, protections: protections.rows[0] || {}, connectors: health.rows };
  }

  async listOrders(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = filters(searchParams, {
      status: 'status', decision: 'decision_status', risk: 'risk',
      priority: 'priority', freshness: 'freshness', identity: 'identity_status'
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
      this.pool.query('SELECT * FROM read_models.operations_order_context WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1', [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_incident_context
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY updated_at DESC`, [id])
    ]);
    return detail.rows[0] ? { order: detail.rows[0], timeline: timeline.rows, incidents: incidents.rows } : null;
  }

  async listIncidents(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = filters(searchParams, {
      status: 'status', type: 'normalized_type', response: 'customer_response_status',
      risk: 'risk', freshness: 'freshness'
    });
    if (!searchParams.has('status')) selected.clauses.push("status = 'PENDING'");
    if (!searchParams.has('active')) selected.clauses.push('is_active = true');
    selected.values.push(limit, offset);
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT *, count(*) OVER()::integer AS total_count
       FROM read_models.operations_incident_context ${where}
       ORDER BY updated_at DESC, canonical_issue_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows, total: result.rows[0]?.total_count || 0, limit, offset };
  }

  async incidentDetail(id) {
    const [detail, timeline] = await Promise.all([
      this.pool.query('SELECT * FROM read_models.operations_incident_context WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1', [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_context
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id])
    ]);
    return detail.rows[0] ? { incident: detail.rows[0], timeline: timeline.rows } : null;
  }
}

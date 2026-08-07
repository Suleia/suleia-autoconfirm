const clamp = (value, fallback = 100, maximum = 500) =>
  Math.min(maximum, Math.max(1, Number.parseInt(value, 10) || fallback));
const offset = (value) => Math.min(100_000, Math.max(0, Number.parseInt(value, 10) || 0));

export function createPostgresReadRepository(config, { pool } = {}) {
  let database = pool;

  async function query(text, values = []) {
    if (!database) {
      const { default: pg } = await import('pg');
      database = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 4,
        application_name: 'suleia-mcp-readonly'
      });
    }
    const result = await database.query(text, values);
    return result.rows;
  }

  return Object.freeze({
    source: 'postgres_shadow_readonly',

    async listOrders({ status = null, lifecycle = null, freshness = null, identity = null,
      limit = 50, offset: requestedOffset = 0 } = {}) {
      const values = [];
      const where = [];
      for (const [value, column] of [[status, 'status'], [lifecycle, 'lifecycle_status'],
        [freshness, 'freshness'], [identity, 'identity_status']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      const safeLimit = clamp(limit, 50, 100);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`SELECT *,count(*) OVER()::integer AS total_count
        FROM read_models.operations_order_context
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY updated_at_utc DESC,canonical_order_id
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getOrder(orderId) {
      const operational = await query(`SELECT * FROM read_models.operations_order_context
        WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1`, [orderId]);
      if (operational[0]) {
        const incidents = await query(`SELECT * FROM read_models.operations_incident_context
          WHERE canonical_order_id=$1 ORDER BY updated_at DESC`, [operational[0].canonical_order_id]);
        return { ...operational[0], incidents };
      }
      return null;
    },

    async listIncidents({ status = 'PENDING', isActive = true, olderThanHours = null,
      freshness = null, risk = null, limit = 50, offset: requestedOffset = 0 } = {}) {
      const values = [];
      const where = [];
      if (status) { values.push(status); where.push(`status=$${values.length}`); }
      if (isActive !== null && isActive !== undefined) {
        values.push(isActive); where.push(`is_active=$${values.length}`);
      }
      if (olderThanHours !== null && olderThanHours !== undefined) {
        values.push(olderThanHours); where.push(`created_at <= now()-($${values.length}::integer * interval '1 hour')`);
      }
      if (freshness) { values.push(freshness); where.push(`freshness=$${values.length}`); }
      if (risk) { values.push(risk); where.push(`risk=$${values.length}`); }
      const safeLimit = clamp(limit, 50, 100);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`SELECT *,count(*) OVER()::integer AS total_count
        FROM read_models.operations_incident_context
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY updated_at DESC,canonical_issue_id
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getIncident(incidentId) {
      const rows = await query(`SELECT * FROM read_models.operations_incident_context
        WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1`, [incidentId]);
      if (!rows[0]) return null;
      const timeline = await query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_issue_id=$1 ORDER BY occurred_at ASC LIMIT 200`, [rows[0].canonical_issue_id]);
      return { ...rows[0], timeline };
    },

    async getOrderTimeline(orderId, limit = 100) {
      const operational = await query(`SELECT canonical_order_id FROM read_models.operations_order_records
        WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1`, [orderId]);
      if (operational[0]) {
        return query(`SELECT timeline_event_id AS event_id,event_type,occurred_at,event_source AS source,
            summary_sanitized AS summary_masked,freshness,'SHADOW_READ_ONLY' AS run_mode
          FROM read_models.operations_order_timeline WHERE canonical_order_id=$1
          ORDER BY occurred_at ASC LIMIT $2`, [operational[0].canonical_order_id, clamp(limit)]);
      }
      return [];
    },

    async getDataFreshness() {
      const operationalRows = await query(`SELECT 'DROPEA_PUBLIC_API_' || market AS source,
          source_updated_at,NULL::timestamptz AS last_failure_at,
          GREATEST(0,EXTRACT(EPOCH FROM (now()-source_updated_at)))::bigint AS lag_seconds,
          freshness AS status,measured_at
        FROM read_models.operations_data_freshness
        UNION ALL
        SELECT source,last_success_at AS source_updated_at,last_failure_at,lag_seconds,status,
          checked_at AS measured_at
        FROM core.source_freshness
        WHERE source IN ('chatby','event_store','digital_twin','read_model')
        ORDER BY measured_at DESC
        LIMIT 100`);
      const rows = operationalRows.length ? operationalRows : await query(`SELECT source, last_success_at AS source_updated_at,
          last_failure_at, lag_seconds, status, checked_at AS measured_at
        FROM mcp.data_freshness ORDER BY checked_at DESC LIMIT 100`);
      return {
        sources: rows,
        source_updated_at: rows.reduce((latest, row) => {
          const value = row.source_updated_at ? new Date(row.source_updated_at).toISOString() : null;
          return !latest || (value && value > latest) ? value : latest;
        }, null),
        measured_at: new Date().toISOString()
      };
    },

    async getDataQuality() {
      const rows = await query('SELECT * FROM read_models.operations_data_quality');
      return rows[0] || {};
    },

    async listReconciliationFindings({ type = null, severity = null, status = 'OPEN',
      limit = 50, offset: requestedOffset = 0 } = {}) {
      const values = [];
      const where = [];
      for (const [value, column] of [[type, 'finding_type'], [severity, 'severity'], [status, 'status']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      const safeLimit = clamp(limit, 50, 100);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`SELECT *,count(*) OVER()::integer AS total_count
        FROM read_models.reconciliation_findings
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY detected_at DESC,finding_id
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getActiveTimers({ orderId = null, timerType = null } = {}) {
      const incidentValues = [];
      const incidentWhere = ["status='ACTIVE'"];
      if (orderId) { incidentValues.push(orderId); incidentWhere.push(`canonical_order_id=$${incidentValues.length}`); }
      if (timerType) { incidentValues.push(timerType); incidentWhere.push(`timer_type=$${incidentValues.length}`); }
      incidentValues.push(100);
      const incidentTimers = await query(`SELECT timer_id,canonical_order_id AS order_id,
          canonical_issue_id AS incident_id,timer_type,status,started_at,due_at,policy_version,created_at,
          actions_executed,production_writes
        FROM operations.incident_timers WHERE ${incidentWhere.join(' AND ')}
        ORDER BY due_at ASC LIMIT $${incidentValues.length}`, incidentValues);
      if (incidentTimers.length || String(timerType || '').toUpperCase().includes('_')) return incidentTimers;
      const values = [];
      const where = ["t.status='ACTIVE'"];
      if (orderId) {
        values.push(orderId);
        where.push(`(o.id::text=$${values.length} OR o.external_order_id=$${values.length})`);
      }
      if (timerType) {
        values.push(timerType);
        where.push(`t.workflow=$${values.length}`);
      }
      values.push(100);
      return query(`SELECT t.id::text AS timer_id,
          COALESCE(o.external_order_id, o.id::text) AS order_id,
          t.incident_id::text, t.workflow AS timer_type, t.status,
          t.started_at, t.deadline_at AS due_at, t.policy_version, t.created_at
        FROM mcp.active_timers t
        JOIN mcp.orders_read o ON o.id=t.order_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.deadline_at ASC
        LIMIT $${values.length}`, values);
    },

    async getAgentDecisions(orderId, limit = 100) {
      const incidentDecisions = await query(`SELECT simulation_id AS decision_id,
          canonical_order_id AS order_id,'INCIDENT' AS workflow,simulated_decision AS route,
          simulated_action AS decision,confidence,interpretation_summary AS reason_summary,
          risk AS risk_level,qa_status, human_review AS requires_human_review,
          actions_executed,'SHADOW_READ_ONLY' AS run_mode,ARRAY[policy_version] AS policy_versions,
          created_at AS decided_at,blocking_reasons,gls_feasibility,allowed_resolution_options
        FROM operations.incident_simulation_decisions
        WHERE canonical_order_id=$1 ORDER BY created_at DESC LIMIT $2`, [orderId, clamp(limit)]);
      if (incidentDecisions.length) return incidentDecisions;
      return query(`SELECT d.decision_id,
          COALESCE(o.external_order_id, o.id::text) AS order_id,
          d.workflow, d.route, d.proposed_action AS decision,
          d.final_confidence AS confidence, d.reason_summary,
          d.risk_level, d.qa_status, d.requires_human_review,
          d.actions_executed, d.run_mode, d.policy_versions,
          d.created_at AS decided_at
        FROM mcp.agent_decisions d
        JOIN mcp.orders_read o ON o.id=d.order_id
        WHERE o.id::text=$1 OR o.external_order_id=$1
        ORDER BY d.created_at DESC
        LIMIT $2`, [orderId, clamp(limit)]);
    },

    async listOrdersRequiringReview({ limit = 100, reason = null } = {}) {
      const operationalValues = [];
      const operationalWhere = [];
      if (reason) { operationalValues.push(reason); operationalWhere.push(`$${operationalValues.length}=ANY(review_reasons)`); }
      operationalValues.push(clamp(limit));
      const operational = await query(`SELECT canonical_order_id AS order_id,canonical_issue_id,
          resource_type AS workflow,review_reasons,'MASKED_OPERATIONAL_REVIEW' AS reason_summary,
          risk AS risk_level,updated_at AS created_at,priority,'PENDING' AS review_status
        FROM read_models.operations_review_queue
        ${operationalWhere.length ? `WHERE ${operationalWhere.join(' AND ')}` : ''}
        ORDER BY updated_at ASC LIMIT $${operationalValues.length}`, operationalValues);
      if (operational.length) return operational;
      const values = [];
      const where = [];
      if (reason) {
        values.push(reason);
        where.push(`r.route=$${values.length}`);
      }
      values.push(clamp(limit));
      return query(`SELECT r.decision_id,
          COALESCE(o.external_order_id, o.id::text) AS order_id,
          r.workflow, r.route AS review_reason, r.proposed_action,
          r.final_confidence AS confidence, r.reason_summary,
          r.risk_level, r.created_at, r.priority, r.review_status
        FROM mcp.orders_requiring_review r
        JOIN mcp.orders_read o ON o.id=r.order_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.created_at ASC
        LIMIT $${values.length}`, values);
    }
  });
}

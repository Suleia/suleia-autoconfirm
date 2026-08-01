const clamp = (value, fallback = 100, maximum = 500) =>
  Math.min(maximum, Math.max(1, Number.parseInt(value, 10) || fallback));

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

    async getOrder(orderId) {
      const rows = await query(`SELECT id::text AS internal_order_id,
          COALESCE(external_order_id, id::text) AS order_id,
          source_status AS status, canonical_status, currency, total_amount,
          created_at_source AS created_at, last_source_update_at AS source_updated_at,
          display_name_masked, phone_masked, email_masked, address_masked, masking_version
        FROM mcp.orders_read
        WHERE id::text=$1 OR external_order_id=$1
        LIMIT 1`, [orderId]);
      return rows[0] || null;
    },

    async getOrderTimeline(orderId, limit = 100) {
      return query(`SELECT t.event_id, lower(t.event_type) AS event_type,
          t.occurred_at, t.received_at, t.source,
          t.payload_masked AS summary_masked, t.trust_level,
          t.freshness_status AS freshness, t.run_mode
        FROM mcp.order_timeline t
        JOIN mcp.orders_read o ON o.id=t.order_id
        WHERE o.id::text=$1 OR o.external_order_id=$1
        ORDER BY t.occurred_at ASC
        LIMIT $2`, [orderId, clamp(limit)]);
    },

    async getDataFreshness() {
      const rows = await query(`SELECT source, last_success_at AS source_updated_at,
          last_failure_at, lag_seconds, status, checked_at AS measured_at
        FROM mcp.data_freshness
        ORDER BY checked_at DESC
        LIMIT 100`);
      return {
        sources: rows,
        source_updated_at: rows.reduce((latest, row) => {
          const value = row.source_updated_at ? new Date(row.source_updated_at).toISOString() : null;
          return !latest || (value && value > latest) ? value : latest;
        }, null),
        measured_at: new Date().toISOString()
      };
    },

    async getActiveTimers({ orderId = null, timerType = null } = {}) {
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

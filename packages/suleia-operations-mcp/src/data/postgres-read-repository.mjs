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
      const operational = await query(`SELECT canonical_order_id AS order_id,dropea_order_id,
          status,sub_status,canonical_state,lifecycle_classification,product_summary,total_amount,
          currency,carrier,service_type,tracking_reference_masked,identity_status,decision_status,
          risk,priority,freshness,updated_at,actions_executed,production_writes,run_mode
        FROM read_models.operations_order_records
        WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1`, [orderId]);
      if (operational[0]) {
        const incidents = await query(`SELECT canonical_issue_id,dropea_issue_id,type,raw_type,
            mapping_status,status,is_active,carrier,delivery_attempt_number,customer_response_status,
            customer_intent,proposed_resolution,allowed_resolution_options,risk,qa_result,
            blocking_reasons,due_at,discount_status,freshness,updated_at,actions_executed,production_writes
          FROM read_models.operations_incident_records
          WHERE canonical_order_id=$1 ORDER BY updated_at DESC`, [operational[0].order_id]);
        return { ...operational[0], incidents };
      }
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
      const operational = await query(`SELECT canonical_order_id FROM read_models.operations_order_records
        WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1`, [orderId]);
      if (operational[0]) {
        return query(`SELECT timeline_id AS event_id,event_type,occurred_at,source,
            summary_masked,freshness,'SHADOW_READ_ONLY' AS run_mode
          FROM read_models.operations_timeline_records WHERE canonical_order_id=$1
          ORDER BY occurred_at ASC LIMIT $2`, [operational[0].canonical_order_id, clamp(limit)]);
      }
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
      const operationalWhere = ['(protection_review=true OR risk IN (\'HIGH\',\'CRITICAL\') OR decision_status=\'HUMAN_REVIEW\')'];
      if (reason) { operationalValues.push(reason); operationalWhere.push(`$${operationalValues.length}=ANY(ARRAY[duplicate_status,return_block_status,chatby_cleanup_status])`); }
      operationalValues.push(clamp(limit));
      const operational = await query(`SELECT canonical_order_id AS order_id,
          'OPERATIONS' AS workflow,CASE WHEN test_order THEN 'TEST_ORDER'
          WHEN duplicate_status='DUPLICATE_ACTIVE_ORDER' THEN duplicate_status
          ELSE 'INCIDENT_OR_PROTECTION_REVIEW' END AS review_reason,
          decision_status AS proposed_action,NULL::numeric AS confidence,
          'MASKED_OPERATIONAL_REVIEW' AS reason_summary,risk AS risk_level,updated_at AS created_at,
          priority,'PENDING' AS review_status
        FROM read_models.operations_order_records WHERE ${operationalWhere.join(' AND ')}
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

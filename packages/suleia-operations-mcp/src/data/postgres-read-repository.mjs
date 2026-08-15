import { evaluateSourceFreshness } from '../../../platform-core/src/operational-truth/freshness.mjs';

const clamp = (value, fallback = 100, maximum = 500) =>
  Math.min(maximum, Math.max(1, Number.parseInt(value, 10) || fallback));
const offset = (value) => Math.min(100_000, Math.max(0, Number.parseInt(value, 10) || 0));

const ORDER_SORT = Object.freeze({
  UPDATED_DESC: 'updated_at_utc DESC NULLS LAST,canonical_order_id',
  UPDATED_ASC: 'updated_at_utc ASC NULLS LAST,canonical_order_id',
  CREATED_DESC: 'created_at_utc DESC NULLS LAST,canonical_order_id',
  CREATED_ASC: 'created_at_utc ASC NULLS LAST,canonical_order_id',
  ORDER_ID_ASC: 'canonical_order_id ASC',
  ORDER_ID_DESC: 'canonical_order_id DESC'
});

const INCIDENT_SORT = Object.freeze({
  UPDATED_DESC: 'updated_at DESC,canonical_issue_id',
  UPDATED_ASC: 'updated_at ASC,canonical_issue_id',
  CREATED_DESC: 'created_at DESC,canonical_issue_id',
  CREATED_ASC: 'created_at ASC,canonical_issue_id',
  ISSUE_ID_ASC: 'canonical_issue_id ASC',
  ISSUE_ID_DESC: 'canonical_issue_id DESC'
});

const FINDING_SORT = Object.freeze({
  DETECTED_DESC: 'detected_at DESC,finding_id',
  DETECTED_ASC: 'detected_at ASC,finding_id',
  SEVERITY_DESC: "CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC,detected_at DESC"
});

function addDateFilter(values, where, value, column, operator) {
  if (!value) return;
  values.push(value);
  where.push(`${column}${operator}$${values.length}::timestamptz`);
}

export function createPostgresReadRepository(config, { pool } = {}) {
  let database = pool;

  async function query(text, values = []) {
    if (!database) {
      const { default: pg } = await import('pg');
      database = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 4,
        statement_timeout: Math.max(100, config.toolTimeoutMs - 250),
        query_timeout: config.toolTimeoutMs,
        application_name: 'suleia-mcp-readonly'
      });
    }
    const result = await database.query(text, values);
    return result.rows;
  }

  return Object.freeze({
    source: 'postgres_shadow_readonly',

    async searchOrders({ orderId = null, status = null, subStatus = null, lifecycleStatus = null,
      active = null, incidentActive = null, duplicate = null, humanReview = null, carrier = null,
      createdFrom = null, createdTo = null, updatedFrom = null, updatedTo = null,
      limit = 50, offset: requestedOffset = 0, sort = 'UPDATED_DESC' } = {}) {
      const values = [];
      const where = [];
      for (const [value, column] of [[status, 'status'], [subStatus, 'sub_status'],
        [lifecycleStatus, 'lifecycle_status'], [carrier, 'carrier']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      if (orderId) {
        values.push(orderId);
        where.push(`(canonical_order_id=$${values.length} OR dropea_order_id=$${values.length})`);
      }
      if (active !== null && active !== undefined) {
        where.push(active
          ? "coalesce(lifecycle_status,'UNKNOWN') NOT IN ('DELIVERED','FINISHED','CANCELLED','REJECTED','RETURNED')"
          : "coalesce(lifecycle_status,'UNKNOWN') IN ('DELIVERED','FINISHED','CANCELLED','REJECTED','RETURNED')");
      }
      if (incidentActive !== null && incidentActive !== undefined) where.push(incidentActive ? 'active_issue_id IS NOT NULL' : 'active_issue_id IS NULL');
      if (duplicate !== null && duplicate !== undefined) {
        where.push(duplicate
          ? "coalesce(duplicate_status,'NOT_ASSESSED') NOT IN ('NOT_ASSESSED','UNIQUE','NONE')"
          : "coalesce(duplicate_status,'NOT_ASSESSED') IN ('NOT_ASSESSED','UNIQUE','NONE')");
      }
      if (humanReview !== null && humanReview !== undefined) {
        values.push(humanReview); where.push(`human_review=$${values.length}`);
      }
      addDateFilter(values, where, createdFrom, 'created_at_utc', '>=');
      addDateFilter(values, where, createdTo, 'created_at_utc', '<=');
      addDateFilter(values, where, updatedFrom, 'updated_at_utc', '>=');
      addDateFilter(values, where, updatedTo, 'updated_at_utc', '<=');
      const safeLimit = clamp(limit, 50, 50);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`SELECT *,count(*) OVER()::integer AS total_count
        FROM read_models.operations_order_context
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${ORDER_SORT[sort] || ORDER_SORT.UPDATED_DESC}
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getOrder(orderId) {
      const operational = await query(`SELECT * FROM read_models.operations_order_context
        WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1`, [orderId]);
      if (operational[0]) {
        const incidents = await query(`SELECT * FROM read_models.operations_incident_panel_context
          WHERE canonical_order_id=$1 ORDER BY updated_at DESC`, [operational[0].canonical_order_id]);
        return { ...operational[0], incidents };
      }
      return null;
    },

    async searchIncidents({ canonicalIssueId = null, dropeaIssueId = null,
      canonicalOrderId = null, dropeaOrderId = null, status = null, isActive = null,
      initialCarrierCode = null, normalizedType = null, interpretedType = null, mappingStatus = null,
      evidenceStatus = null, freshnessStatus = null, decisionStatus = null, qaStatus = null,
      humanReview = null, customerReplied = null, timerStatus = null, risk = null, createdFrom = null, createdTo = null,
      updatedFrom = null, updatedTo = null, limit = 50, offset: requestedOffset = 0,
      sort = 'UPDATED_DESC' } = {}) {
      const values = [];
      const where = [];
      if (status) { values.push(status); where.push(`status=$${values.length}`); }
      if (isActive !== null && isActive !== undefined) {
        values.push(isActive); where.push(`is_active=$${values.length}`);
      }
      for (const [value, column] of [[canonicalIssueId, 'canonical_issue_id'],
        [dropeaIssueId, 'dropea_issue_id'], [canonicalOrderId, 'canonical_order_id'],
        [dropeaOrderId, 'dropea_order_id']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      for (const [value, column] of [[initialCarrierCode, 'initial_carrier_code'],
        [normalizedType, 'normalized_type'], [interpretedType, 'interpreted_type'],
        [mappingStatus, 'mapping_status'], [evidenceStatus, 'response_evidence_status'],
        [freshnessStatus, 'effective_freshness_status'], [decisionStatus, 'effective_decision_status'],
        [qaStatus, 'effective_qa_status'], [timerStatus, 'effective_timer_status'], [risk, 'effective_risk']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      for (const [value, column] of [[humanReview, 'effective_human_review'],
        [customerReplied, 'customer_replied_after_issue']]) {
        if (value !== null && value !== undefined) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      addDateFilter(values, where, createdFrom, 'created_at', '>=');
      addDateFilter(values, where, createdTo, 'created_at', '<=');
      addDateFilter(values, where, updatedFrom, 'updated_at', '>=');
      addDateFilter(values, where, updatedTo, 'updated_at', '<=');
      const safeLimit = clamp(limit, 50, 50);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`SELECT *,count(*) OVER()::integer AS total_count
        FROM read_models.operations_incident_panel_context
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${INCIDENT_SORT[sort] || INCIDENT_SORT.UPDATED_DESC}
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getIncident({ canonicalIssueId = null, dropeaIssueId = null } = {}) {
      const incidentId = canonicalIssueId || dropeaIssueId;
      const identityColumn = canonicalIssueId ? 'canonical_issue_id' : 'dropea_issue_id';
      const rows = await query(`SELECT * FROM read_models.operations_incident_panel_context
        WHERE ${identityColumn}=$1 LIMIT 1`, [incidentId]);
      if (!rows[0]) return null;
      const timeline = await query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_issue_id=$1 ORDER BY occurred_at ASC LIMIT 200`, [rows[0].canonical_issue_id]);
      const incident = rows[0];
      return {
        ...incident,
        traceability: {
          dropea: {
            dropea_issue_id: incident.dropea_issue_id,
            dropea_order_id: incident.dropea_order_id,
            market: incident.market,
            store_id: incident.store_id,
            status: incident.status,
            is_active: incident.is_active,
            initial_carrier_code: incident.initial_carrier_code,
            source_updated_at: incident.source_updated_at
          },
          canonical_issue: {
            canonical_issue_id: incident.canonical_issue_id,
            canonical_order_id: incident.canonical_order_id,
            normalized_type: incident.normalized_type,
            identity_status: incident.identity_status
          },
          event_store: { timeline_event_count: timeline.length },
          incident_digital_twin: {
            data_quality_status: incident.data_quality_status,
            freshness: incident.effective_freshness_status,
            dropea_freshness: incident.dropea_freshness_status,
            mapping_status: incident.mapping_status
          },
          chatby: {
            conversation_status: incident.conversation_status,
            conversation_reason: incident.conversation_reason,
            identity_method: incident.conversation_identity_method,
            customer_replied_after_issue: incident.customer_replied_after_issue,
            latest_customer_activity_at: incident.latest_customer_activity_at,
            latest_suleia_activity_at: incident.latest_suleia_activity_at,
            last_button_intent: incident.last_button_intent,
            conversation_freshness: incident.effective_conversation_freshness,
            link_snapshot_freshness: incident.conversation_freshness,
            evidence_status: incident.response_evidence_status
          },
          conversation_intelligence: {
            current_intent: incident.customer_intent,
            evidence_classification_confidence: incident.evidence_classification_confidence,
            customer_intent_confidence: incident.customer_intent_confidence,
            contradiction: incident.contradiction,
            summary_sanitized: incident.interpretation_summary,
            messages_used: incident.messages_used,
            messages_ignored: incident.messages_ignored
          },
          policy: { policy_id: incident.policy_id, version: incident.policy_version },
          timer: {
            timer_type: incident.timer_type,
            started_at: incident.timer_started_at,
            due_at: incident.timer_due_at,
            stored_status: incident.stored_timer_status,
            effective_status: incident.effective_timer_status,
            overdue_seconds: incident.overdue_seconds,
            policy_version: incident.timer_policy_version
          },
          gls_feasibility: {
            initial_carrier_code: incident.initial_carrier_code,
            allowed_resolution_options: incident.allowed_resolution_options,
            capability_status: incident.capability_status
          },
          risk: { effective: incident.effective_risk, stored: incident.risk },
          qa: { status: incident.effective_qa_status, stored_status: incident.qa_status,
            human_review: incident.effective_human_review },
          simulated_decision: {
            decision: incident.effective_decision_status,
            stored_decision: incident.stored_decision_status,
            action_type: incident.effective_simulated_action_type,
            blocking_reasons: incident.effective_blocking_reasons,
            record_status: incident.decision_record_status,
            status_reason: incident.decision_status_reason,
            input_snapshot_hash: incident.input_snapshot_hash,
            policy_snapshot_hash: incident.policy_snapshot_hash,
            snapshot_status: incident.snapshot_status
          },
          read_model: 'read_models.operations_incident_panel_context'
        },
        timeline
      };
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
      const operationalRows = await query(`WITH dropea_latest AS (
          SELECT DISTINCT ON (market,store_id,resource_type)
            'DROPEA_PUBLIC_API_' || market AS source,market,store_id,resource_type,phase,
            source_observed_at,source_event_at,ingested_at,last_successful_sync_at,
            NULL::timestamptz AS last_failure_at,sync_complete,measured_at
          FROM read_models.operations_data_freshness
          ORDER BY market,store_id,resource_type,last_successful_sync_at DESC NULLS LAST,measured_at DESC
        )
        SELECT * FROM (
          SELECT * FROM dropea_latest
          UNION ALL
          SELECT source,NULL::text AS market,NULL::text AS store_id,NULL::text AS resource_type,NULL::text AS phase,
            checked_at AS source_observed_at,NULL::timestamptz AS source_event_at,
            checked_at AS ingested_at,last_success_at AS last_successful_sync_at,last_failure_at,
            true AS sync_complete,checked_at AS measured_at
          FROM core.source_freshness
          WHERE source IN ('chatby','event_store','digital_twin','read_model')
        ) source_rows ORDER BY measured_at DESC LIMIT 100`);
      const fallbackRows = operationalRows.length ? [] : await query(`SELECT source,checked_at AS source_observed_at,
          NULL::timestamptz AS source_event_at,checked_at AS ingested_at,
          last_success_at AS last_successful_sync_at,last_failure_at,true AS sync_complete,checked_at AS measured_at
        FROM mcp.data_freshness ORDER BY checked_at DESC LIMIT 100`);
      const rows = (operationalRows.length ? operationalRows : fallbackRows).map((row) => {
        const normalized = { ...row,
          last_successful_sync_at: row.last_successful_sync_at ?? row.source_updated_at,
          source_observed_at: row.source_observed_at ?? row.source_updated_at,
          ingested_at: row.ingested_at ?? row.measured_at ?? row.source_updated_at };
        const freshness = evaluateSourceFreshness(normalized);
        return { source: row.source, market: row.market ?? null, store_id: row.store_id ?? null,
          resource_type: row.resource_type ?? null, phase: row.phase ?? null, ...freshness,
          source_updated_at: freshness.last_successful_sync_at,
          last_failure_at: row.last_failure_at, measured_at: row.measured_at };
      });
      const statusPriority = ['CLOCK_SKEW', 'UNAVAILABLE', 'STALE', 'UNKNOWN', 'FRESH'];
      const aggregateStatus = statusPriority.find((status) => rows.some((row) => row.freshness_status === status)) || 'UNKNOWN';
      const ages = rows.map((row) => row.age_seconds).filter(Number.isFinite);
      return {
        sources: rows,
        freshness_status: aggregateStatus,
        age_seconds: ages.length ? Math.max(...ages) : null,
        source_updated_at: rows.reduce((latest, row) => {
          const value = row.last_successful_sync_at;
          return !latest || (value && value > latest) ? value : latest;
        }, null),
        measured_at: new Date().toISOString()
      };
    },

    async getDataQuality() {
      const rows = await query('SELECT * FROM read_models.operations_data_quality');
      return rows[0] || {};
    },

    async searchOperationalFindings({ type = null, severity = null, status = null, domain = null,
      orderId = null, issueId = null, limit = 50, offset: requestedOffset = 0,
      sort = 'DETECTED_DESC' } = {}) {
      const values = [];
      const where = [];
      for (const [value, column] of [[type, 'finding_type'], [severity, 'severity'], [status, 'status']]) {
        if (value) { values.push(value); where.push(`${column}=$${values.length}`); }
      }
      if (domain) {
        values.push(domain);
        where.push(`domain ILIKE '%'||$${values.length}||'%'`);
      }
      if (orderId) { values.push(orderId); where.push(`canonical_order_id=$${values.length}`); }
      if (issueId) { values.push(issueId); where.push(`canonical_issue_id=$${values.length}`); }
      const safeLimit = clamp(limit, 50, 50);
      const safeOffset = offset(requestedOffset);
      values.push(safeLimit, safeOffset);
      const rows = await query(`WITH findings AS (
        SELECT finding_id,canonical_order_id,canonical_issue_id,finding_type,severity,
          CASE WHEN finding_type LIKE 'CHATBY_%' THEN 'CHATBY'
            WHEN finding_type LIKE '%GLS%' THEN 'GLS'
            WHEN finding_type LIKE '%IDENTITY%' THEN 'IDENTITY'
            WHEN finding_type LIKE '%EVENT%' THEN 'EVENT_STORE'
            WHEN finding_type LIKE '%STALE%' THEN 'FRESHNESS' ELSE 'RECONCILIATION' END AS domain,
          source_a,source_b,detected_at,resolved_at,status,evidence_sanitized
        FROM read_models.reconciliation_findings
        UNION ALL
        SELECT md5('HUMAN_REVIEW:'||resource_type||':'||canonical_order_id||':'||coalesce(canonical_issue_id,'')),
          canonical_order_id,canonical_issue_id,'HUMAN_REVIEW',
          CASE WHEN risk='CRITICAL' THEN 'CRITICAL' WHEN risk='HIGH' THEN 'HIGH' ELSE 'MEDIUM' END,
          'GOVERNANCE','OPERATIONS_REVIEW_QUEUE','HUMAN_REVIEW',updated_at,NULL,'OPEN',
          jsonb_build_object('resource_type',resource_type,'review_reasons',review_reasons,'priority',priority)
        FROM read_models.operations_review_queue
        UNION ALL
        SELECT md5('DATA_QUALITY:'||measured_at::text),NULL,NULL,'DATA_QUALITY',
          CASE WHEN orders_identity_conflicting>0 OR multiple_conversations>0 THEN 'CRITICAL'
            WHEN issues_unknown_code>0 OR incidents_without_conversation>0 OR stale_orders>0 OR stale_issues>0 THEN 'HIGH'
            ELSE 'LOW' END,
          'DATA_QUALITY','OPERATIONS_READ_MODELS','QUALITY_AGGREGATE',measured_at,NULL,
          CASE WHEN orders_identity_conflicting>0 OR issues_unknown_code>0 OR incidents_without_conversation>0
            OR multiple_conversations>0 OR stale_orders>0 OR stale_issues>0 OR event_gaps>0 OR read_model_mismatches>0
            THEN 'OPEN' ELSE 'RESOLVED' END,
          to_jsonb(q)-'actions_executed'-'production_writes'
        FROM read_models.operations_data_quality q
      )
      SELECT *,count(*) OVER()::integer AS total_count
        FROM findings
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${FINDING_SORT[sort] || FINDING_SORT.DETECTED_DESC}
        LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
      return { items: rows, total: rows[0]?.total_count || 0, limit: safeLimit, offset: safeOffset };
    },

    async getDatabaseSummary() {
      const rows = await query(`SELECT
        (SELECT count(*)::integer FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema') AS schema_count,
        (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m')) AS object_count,
        (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='read_models' AND c.relkind IN ('v','m')) AS read_model_count,
        current_database() AS database, current_setting('server_version') AS server_version,
        now() AS measured_at`);
      return rows[0] || {};
    },

    async getRuntimeMetrics() {
      const rows = await query(`SELECT current_database() AS database,
        current_setting('server_version') AS server_version,
        pg_database_size(current_database())::bigint AS database_size_bytes,
        pg_postmaster_start_time() AS started_at,
        (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database()) AS connections,
        now() AS measured_at`);
      return rows[0] || {};
    },

    async getDatabaseCatalog({ platform = 'VPS_POSTGRES', schema = null, objectType = null,
      objectName = null, limit = 50, offset: requestedOffset = 0 } = {}) {
      if (platform && platform !== 'VPS_POSTGRES') {
        return { platform, items: [], total: 0, limit: clamp(limit, 50, 50), offset: offset(requestedOffset) };
      }
      const safeLimit = clamp(limit, 50, 50);
      const safeOffset = offset(requestedOffset);
      const values = [schema, objectType, objectName, safeLimit, safeOffset];
      const rows = await query(`WITH catalog AS (
        SELECT n.oid AS object_oid,n.nspname AS schema_name,n.nspname AS object_name,
          'SCHEMA'::text AS object_type,NULL::text AS relation_kind,NULL::bigint AS size_bytes,
          NULL::bigint AS estimated_rows,false AS rls_enabled,NULL::text AS function_arguments,
          NULL::text AS function_result,NULL::text AS function_language,false AS security_definer
        FROM pg_namespace n
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        UNION ALL
        SELECT c.oid,n.nspname,c.relname,
          CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'p' THEN 'TABLE'
            WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED_VIEW' END,
          c.relkind::text,
          CASE WHEN c.relkind IN ('r','p','m') THEN pg_total_relation_size(c.oid)::bigint ELSE NULL END,
          CASE WHEN c.relkind IN ('r','p','m') THEN greatest(c.reltuples,0)::bigint ELSE NULL END,
          c.relrowsecurity,NULL,NULL,NULL,false
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m')
        UNION ALL
        SELECT p.oid,n.nspname,p.proname,'FUNCTION',NULL,NULL,NULL,false,
          pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),l.lanname,p.prosecdef
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      ), filtered AS (
        SELECT *,count(*) OVER()::integer AS total_count
        FROM catalog
        WHERE ($1::text IS NULL OR schema_name=$1)
          AND ($2::text IS NULL OR object_type=$2)
          AND ($3::text IS NULL OR object_name ILIKE '%'||$3||'%')
        ORDER BY schema_name,object_type,object_name
        LIMIT $4 OFFSET $5
      )
      SELECT f.*,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
            'nullable',NOT a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),
            'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum)
          FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
          WHERE a.attrelid=f.object_oid AND a.attnum>0 AND NOT a.attisdropped
        ),'[]'::jsonb) END AS columns,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'name',con.conname,'type',CASE con.contype WHEN 'p' THEN 'PRIMARY_KEY' WHEN 'f' THEN 'FOREIGN_KEY'
              WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUSION' ELSE con.contype::text END,
            'definition',pg_get_constraintdef(con.oid,true)) ORDER BY con.conname)
          FROM pg_constraint con WHERE con.conrelid=f.object_oid
        ),'[]'::jsonb) END AS constraints,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(ix.indexrelid),
            'primary',ix.indisprimary,'unique',ix.indisunique) ORDER BY ic.relname)
          FROM pg_index ix JOIN pg_class ic ON ic.oid=ix.indexrelid WHERE ix.indrelid=f.object_oid
        ),'[]'::jsonb) END AS indexes,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
            'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid=f.object_oid AND NOT t.tgisinternal
        ),'[]'::jsonb) END AS triggers,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object('grantee',r.rolname,'privilege',p.privilege_type) ORDER BY r.rolname,p.privilege_type)
          FROM pg_class c2
          CROSS JOIN LATERAL aclexplode(coalesce(c2.relacl,acldefault('r',c2.relowner))) p
          JOIN pg_roles r ON r.oid=p.grantee WHERE c2.oid=f.object_oid
        ),'[]'::jsonb) END AS grants,
        CASE WHEN f.relation_kind IS NULL THEN '[]'::jsonb ELSE coalesce((
          SELECT jsonb_agg(DISTINCT jsonb_build_object('schema',rn.nspname,'object',rc.relname))
          FROM pg_depend d JOIN pg_class rc ON rc.oid=d.refobjid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
          WHERE d.objid=f.object_oid AND d.refobjid<>f.object_oid AND rn.nspname !~ '^pg_'
        ),'[]'::jsonb) END AS dependencies,
        'UNRECORDED_AT_OBJECT_LEVEL'::text AS migration_origin
      FROM filtered f ORDER BY f.schema_name,f.object_type,f.object_name`, values);
      return {
        platform: 'VPS_POSTGRES',
        items: rows,
        total: rows[0]?.total_count || 0,
        limit: safeLimit,
        offset: safeOffset,
        metadata_only: true,
        arbitrary_sql_allowed: false,
        measured_at: new Date().toISOString()
      };
    },

    async getActiveTimers({ orderId = null, timerType = null } = {}) {
      const incidentValues = [];
      const incidentWhere = ["status='ACTIVE'"];
      if (orderId) {
        incidentValues.push(orderId);
        incidentWhere.push(`canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_records
          WHERE canonical_order_id=$${incidentValues.length} OR dropea_order_id=$${incidentValues.length} LIMIT 1)`);
      }
      if (timerType) { incidentValues.push(timerType); incidentWhere.push(`timer_type=$${incidentValues.length}`); }
      incidentValues.push(100);
      const incidentTimers = await query(`SELECT timer_id,canonical_order_id AS order_id,
          canonical_issue_id AS incident_id,timer_type,status AS stored_status,
          CASE WHEN status='ACTIVE' AND due_at<=now() THEN 'EXPIRED' ELSE status END AS effective_status,
          CASE WHEN due_at<=now() THEN extract(epoch FROM (now()-due_at))::bigint ELSE 0 END AS overdue_seconds,
          started_at,due_at,policy_version,created_at,
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
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_records
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY created_at DESC LIMIT $2`, [orderId, clamp(limit)]);
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

import { evaluateSourceFreshness } from '../../../platform-core/src/operational-truth/freshness.mjs';
import { buildMonthlyFinanceReport } from '../../../platform-core/src/finance/monthly-report.mjs';
import { privateIncidentDisplay, privateIncidentMessages, privateOrderDisplay } from './private-display.mjs';
import { incidentInsight } from './incident-insight.mjs';

const ORDER_OPERATIONAL_SOURCE = `(SELECT c.*,
  coalesce(s.messages_used,0) AS customer_messages,
  s.confidence AS customer_signal_confidence,
  coalesce(s.has_customer_replied,false) AS customer_has_replied,
  s.latest_inbound_message_at AS customer_latest_reply_at,
  s.updated_at AS customer_signal_updated_at,
  s.freshness AS customer_signal_freshness,
  s.explanation_masked->>'source_intent' AS render_customer_signal,
  s.explanation_masked->>'response_summary' AS customer_response_summary,
  s.explanation_masked->>'association' AS customer_signal_association,
  s.explanation_masked->>'source' AS customer_signal_source,
  CASE
    WHEN s.canonical_order_id IS NULL THEN 'NOT_VERIFIABLE'
    WHEN s.has_customer_replied THEN 'RESPONDED'
    ELSE 'NO_RESPONSE'
  END AS customer_response_status,
  r.phone_last4 AS safe_customer_reference,
  p.external_order_id_ciphertext,p.shipping_address_ciphertext
 FROM read_models.operations_order_context c
 LEFT JOIN read_models.operations_conversation_summaries s USING(canonical_order_id)
 LEFT JOIN read_models.operations_order_records r USING(canonical_order_id)
 LEFT JOIN read_models.operations_private_order_display p USING(canonical_order_id))`;

const INCIDENT_OPERATIONAL_SOURCE = `(SELECT p.*,
  private_order.external_order_id_ciphertext,private_order.shipping_address_ciphertext,
  private_message.message_text_ciphertext AS latest_customer_message_ciphertext,
  private_message.occurred_at AS latest_private_customer_message_at,
  private_message.relation_to_issue AS latest_customer_message_relation,
  private_message.intent AS latest_private_customer_intent,
  private_message.message_type AS latest_private_customer_message_type,
  CASE
    WHEN p.chatby_last_successful_sync_at IS NULL
      OR p.chatby_last_successful_sync_at < now()-interval '600 seconds'
      OR p.chatby_last_failure_at >= p.chatby_last_successful_sync_at THEN false
    ELSE true
  END AS chatby_sync_current,
  CASE
    WHEN p.last_successful_sync_at IS NULL
      OR p.last_successful_sync_at < now()-interval '900 seconds' THEN false
    ELSE true
  END AS dropea_sync_current,
  CASE
    WHEN p.chatby_last_successful_sync_at IS NULL
      OR p.chatby_last_successful_sync_at < now()-interval '600 seconds'
      OR p.chatby_last_failure_at >= p.chatby_last_successful_sync_at THEN 'NOT_VERIFIABLE'
    WHEN p.conversation_status='FOUND' AND p.response_evidence_status='VALID_RESPONSE' THEN 'VALID_RESPONSE'
    WHEN p.conversation_status='FOUND' THEN 'NO_VALID_RESPONSE'
    WHEN p.conversation_status='NONE' THEN 'NO_CONVERSATION'
    ELSE 'NOT_VERIFIABLE'
  END AS operational_response_status,
  CASE
    WHEN p.last_successful_sync_at IS NULL
      OR p.last_successful_sync_at < now()-interval '900 seconds' THEN 'STALE'
    WHEN p.chatby_last_successful_sync_at IS NULL
      OR p.chatby_last_successful_sync_at < now()-interval '600 seconds'
      OR p.chatby_last_failure_at >= p.chatby_last_successful_sync_at THEN 'STALE'
    ELSE 'FRESH'
  END AS operational_freshness_status,
  CASE
    WHEN p.conversation_status='NONE' THEN 'REVIEW_CHATBY_LINK'
    WHEN p.response_evidence_status='VALID_RESPONSE' THEN 'REVIEW_CUSTOMER_RESPONSE'
    WHEN p.timer_status='ACTIVE' AND p.timer_due_at>now() THEN 'WAITING_CUSTOMER'
    ELSE 'HUMAN_REVIEW'
  END AS operational_decision_status,
  CASE
    WHEN p.interpreted_type='ADDRESS_INCORRECT' THEN 'REVIEW_ADDRESS_CHANGE'
    WHEN p.interpreted_type='RECIPIENT_ABSENT' THEN 'REVIEW_DELIVERY_AVAILABILITY'
    WHEN p.interpreted_type='REFUSED_BY_RECIPIENT' THEN 'REVIEW_REJECTION'
    ELSE 'REVIEW_INCIDENT'
  END AS operational_recommendation
 FROM read_models.operations_incident_panel_context p
 LEFT JOIN read_models.operations_private_order_display private_order USING(canonical_order_id)
 LEFT JOIN LATERAL (
   SELECT m.message_text_ciphertext,m.occurred_at,m.relation_to_issue,m.intent,m.message_type
   FROM read_models.operations_private_incident_messages m
   WHERE m.canonical_issue_id=p.canonical_issue_id AND m.direction='INBOUND'
   ORDER BY (m.relation_to_issue='AFTER_INCIDENT') DESC,
            (m.intent<>'UNKNOWN') DESC,
            m.occurred_at DESC LIMIT 1
 ) private_message ON true)`;

function integer(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
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
    status: 'status', type: 'interpreted_type', risk: 'effective_risk',
    freshness: 'operational_freshness_status', mapping: 'mapping_status',
    response: 'operational_response_status', timer: 'effective_timer_status',
    decision: 'operational_decision_status', qa: 'effective_qa_status', carrier_code: 'initial_carrier_code'
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
    selected.clauses.push(`created_at >= ($${selected.values.length}::date::timestamp AT TIME ZONE 'Europe/Madrid')`);
  }
  const to = searchParams.get('to');
  if (to) {
    selected.values.push(to);
    selected.clauses.push(`created_at < (($${selected.values.length}::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')`);
  }
  const query = searchParams.get('q')?.trim();
  if (query) {
    selected.values.push(query);
    selected.clauses.push(`(canonical_issue_id=$${selected.values.length} OR dropea_issue_id=$${selected.values.length}
      OR canonical_order_id=$${selected.values.length} OR dropea_order_id=$${selected.values.length})`);
  }
  return { ...selected, scope };
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function financialMonth(searchParams) {
  const requested = String(searchParams.get('month') || '').trim();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonth();
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return { month, from: `${month}-01`, to: next, storeId: searchParams.get('store_id')?.trim() || null };
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export class OperationsRepository {
  constructor(databaseUrl, { pool = null, privateDataKey = '' } = {}) {
    if (!pool) throw new Error('Use OperationsRepository.connect for a database connection');
    this.pool = pool;
    this.privateDataKey = privateDataKey;
  }

  static async connect(databaseUrl, { privateDataKey = '' } = {}) {
    const { default: pg } = await import('pg');
    return new OperationsRepository(databaseUrl, { pool: new pg.Pool({
      connectionString: databaseUrl, max: 5, application_name: 'suleia-operations-center',
      statement_timeout: 10_000, query_timeout: 12_000
    }), privateDataKey });
  }

  async close() { await this.pool.end(); }

  async summary(searchParams = new URLSearchParams()) {
    const incidentFilters = incidentSelection(searchParams);
    const incidentWhere = incidentFilters.clauses.length ? `WHERE ${incidentFilters.clauses.join(' AND ')}` : '';
    const [orders, incidents, protections, health, orderFlow] = await Promise.all([
      this.pool.query('SELECT * FROM read_models.operations_orders_summary'),
      this.pool.query(`SELECT
        count(*)::integer AS pending,
        count(*) FILTER (WHERE operational_response_status='VALID_RESPONSE')::integer AS responded,
        count(*) FILTER (WHERE waiting_customer)::integer AS awaiting_customer,
        count(*) FILTER (WHERE operational_response_status='NOT_VERIFIABLE')::integer AS not_verifiable,
        count(*) FILTER (WHERE operational_response_status='NO_CONVERSATION')::integer AS without_conversation,
        count(*) FILTER (WHERE effective_risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
        count(*) FILTER (WHERE currently_blocked AND cardinality(effective_blocking_reasons)>0)::integer AS blocked,
        count(*) FILTER (WHERE operational_freshness_status<>'FRESH')::integer AS stale,
        count(*) FILTER (WHERE effective_timer_status='EXPIRED')::integer AS timers_expired,
        count(*) FILTER (WHERE interpreted_type='RECIPIENT_ABSENT')::integer AS recipient_absent,
        count(*) FILTER (WHERE interpreted_type='ADDRESS_INCORRECT')::integer AS address_issues,
        count(*) FILTER (WHERE interpreted_type='REFUSED_BY_RECIPIENT')::integer AS refused,
        max(panel_updated_at) AS last_sync_at,$${incidentFilters.values.length + 1}::text AS scope,
        0::integer AS actions_executed,0::integer AS production_writes
      FROM ${INCIDENT_OPERATIONAL_SOURCE} incident ${incidentWhere}`,
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
        count(*) FILTER (WHERE active_issue_id IS NOT NULL)::integer AS with_active_issue,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND customer_replied_after_issue)::integer AS with_customer_response,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND customer_response_status='NO_RESPONSE')::integer AS no_response,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND customer_response_status='NOT_VERIFIABLE')::integer AS response_not_verifiable,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND latest_customer_intent='CONFIRM')::integer AS confirm_now,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND latest_customer_intent='ADDRESS_CHANGE')::integer AS address_change,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND latest_customer_intent='REJECT')::integer AS reject_signal,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND latest_customer_intent IN ('UNCLEAR','UNKNOWN','NOT_VERIFIABLE'))::integer AS review_signal,
        count(*) FILTER (WHERE coalesce(lifecycle_status,status)='PENDING' AND duplicate_status='DUPLICATE_ACTIVE_ORDER')::integer AS prior_order
      FROM ${ORDER_OPERATIONAL_SOURCE} orders`)
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
    const window = financialMonth(searchParams); const values = [window.from, window.to, window.storeId];
    const orderWhere = `WHERE created_at_utc >= ($1::date::timestamp AT TIME ZONE 'Europe/Madrid')
      AND created_at_utc < ($2::date::timestamp AT TIME ZONE 'Europe/Madrid')
      AND ($3::text IS NULL OR store_id=$3)`;
    const [orders, rates, fixed, advertising, months, checkpoints] = await Promise.all([
      this.pool.query(`SELECT canonical_order_id,store_id,lifecycle_status,status,created_at_utc,source_updated_at,updated_at,
        confirmed_at_utc,delivered_at_utc,returned_at_utc,total_amount,currency,carrier,product_summary,active_issue_id
        FROM read_models.operations_order_context ${orderWhere}`, values),
      this.pool.query(`SELECT store_id,cost_type,carrier,provider,product_id,variant_id,amount,currency,
        effective_from,effective_to,source,updated_at FROM economics.finance_cost_rates
        WHERE effective_from < $2::date AND (effective_to IS NULL OR effective_to >= $1::date)
        AND ($3::text IS NULL OR store_id=$3)`, values),
      this.pool.query(`SELECT store_id,label,category,expense_type,amount,currency,start_date,end_date,occurred_on,status,source,updated_at
        FROM economics.finance_fixed_expenses WHERE start_date < $2::date AND (end_date IS NULL OR end_date >= $1::date)
        AND ($3::text IS NULL OR store_id=$3)`, values),
      this.pool.query(`SELECT store_id,business_date,platform,sum(spend)::numeric(14,2) AS spend,min(currency) AS currency,
        CASE WHEN bool_and(sync_status='COMPLETE') THEN 'COMPLETE' ELSE max(sync_status) END AS sync_status,
        max(source_observed_at) AS source_observed_at,max(ingested_at) AS ingested_at
        FROM economics.finance_ad_spend_daily WHERE business_date >= $1::date AND business_date < $2::date
        AND ($3::text IS NULL OR store_id=$3) GROUP BY store_id,business_date,platform`, values),
      this.pool.query(`SELECT DISTINCT month FROM read_models.finance_available_months
        WHERE ($1::text IS NULL OR store_id=$1) ORDER BY month DESC LIMIT 24`, [window.storeId]),
      this.pool.query(`SELECT store_id,source,business_date,sync_status,records_read,last_success_at,last_failure_at,failure_code,updated_at
        FROM economics.finance_sync_checkpoints WHERE business_date >= $1::date AND business_date < $2::date
        AND ($3::text IS NULL OR store_id=$3) ORDER BY source,business_date`, values)
    ]);
    const report = buildMonthlyFinanceReport({
      month: window.month,
      orders: orders.rows,
      rates: rates.rows.map((row) => ({ ...row, effective_from: dateOnly(row.effective_from), effective_to: dateOnly(row.effective_to) })),
      fixedExpenses: fixed.rows.map((row) => ({ ...row, start_date: dateOnly(row.start_date), end_date: dateOnly(row.end_date), occurred_on: dateOnly(row.occurred_on) })),
      adSpend: advertising.rows.map((row) => ({ ...row, business_date: dateOnly(row.business_date) }))
    });
    return {
      ...report, perspective: 'ORDER_CREATION_COHORT', store_id: window.storeId,
      available_months: months.rows.map((row) => row.month), checkpoints: checkpoints.rows,
      shopify_orders_available: false,
      limitations: [
        'La cohorte se agrupa por fecha original del pedido y se reevalúa con el estado Dropea vigente.',
        'Pedidos en tránsito y devoluciones se contabilizan por separado.',
        'Operations todavía no dispone del total independiente de pedidos de la plataforma de tienda; no se sustituye por un dato inventado.',
        'Un coste o día publicitario sin fuente completa deja el beneficio y ROI como no calculables.'
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
    const category = String(searchParams.get('category') || '').toUpperCase();
    const categoryClauses = {
      CONFIRM: "latest_customer_intent='CONFIRM'",
      RESPONDED: "customer_response_status='RESPONDED'",
      ADDRESS: "latest_customer_intent='ADDRESS_CHANGE'",
      INCIDENTS: 'active_issue_id IS NOT NULL',
      REJECT: "latest_customer_intent='REJECT'",
      REVIEW: "latest_customer_intent IN ('UNCLEAR','UNKNOWN','NOT_VERIFIABLE')",
      NO_RESPONSE: "customer_response_status='NO_RESPONSE'",
      NOT_VERIFIABLE: "customer_response_status='NOT_VERIFIABLE'"
    };
    if (categoryClauses[category]) selected.clauses.push(categoryClauses[category]);
    const query = searchParams.get('q')?.trim();
    if (query) {
      selected.values.push(query);
      selected.clauses.push(`(canonical_order_id=$${selected.values.length} OR dropea_order_id=$${selected.values.length})`);
    }
    selected.values.push(limit, offset);
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT *, count(*) OVER()::integer AS total_count
       FROM ${ORDER_OPERATIONAL_SOURCE} orders ${where}
       ORDER BY updated_at DESC, canonical_order_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows.map((row) => privateOrderDisplay(row, this.privateDataKey)), total: result.rows[0]?.total_count || 0, limit, offset };
  }

  async orderDetail(id) {
    const [detail, timeline, incidents] = await Promise.all([
      this.pool.query(`SELECT c.*,r.phone_last4,r.test_order,r.automatic_confirmation_allowed,
        r.chatby_cleanup_status,r.chatby_cleanup_blockers,r.return_block_status,r.return_block_reason,
        r.protection_review,r.protection_last_reconciled_at
      FROM ${ORDER_OPERATIONAL_SOURCE} c
      LEFT JOIN read_models.operations_order_records r USING(canonical_order_id)
      WHERE c.canonical_order_id=$1 OR c.dropea_order_id=$1 LIMIT 1`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id]),
      this.pool.query(`SELECT * FROM ${INCIDENT_OPERATIONAL_SOURCE} incident
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_order_context
          WHERE canonical_order_id=$1 OR dropea_order_id=$1 LIMIT 1)
        ORDER BY updated_at DESC`, [id])
    ]);
    return detail.rows[0] ? { order: privateOrderDisplay(detail.rows[0], this.privateDataKey), timeline: timeline.rows, incidents: incidents.rows } : null;
  }

  async listIncidents(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = incidentSelection(searchParams);
    selected.values.push(limit, offset);
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT *, count(*) OVER()::integer AS total_count
       FROM ${INCIDENT_OPERATIONAL_SOURCE} incident ${where}
       ORDER BY updated_at DESC, canonical_issue_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows.map((row) => incidentInsight(privateIncidentDisplay(row, this.privateDataKey))), total: result.rows[0]?.total_count || 0, limit, offset };
  }

  async incidentOverview(searchParams) {
    const limit = integer(searchParams.get('limit'), 25, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = incidentSelection(searchParams);
    const scopeParameter = selected.values.length + 1;
    selected.values.push(selected.scope, limit, offset);
    const limitParameter = selected.values.length - 1;
    const offsetParameter = selected.values.length;
    const where = selected.clauses.length ? `WHERE ${selected.clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `WITH selected AS MATERIALIZED (
         SELECT * FROM ${INCIDENT_OPERATIONAL_SOURCE} incident ${where}
       ), page AS (
         SELECT * FROM selected
         ORDER BY updated_at DESC,canonical_issue_id
         LIMIT $${limitParameter} OFFSET $${offsetParameter}
       ), metrics AS (
         SELECT count(*)::integer AS pending,
           count(*) FILTER (WHERE operational_response_status='VALID_RESPONSE')::integer AS responded,
           count(*) FILTER (WHERE waiting_customer)::integer AS awaiting_customer,
           count(*) FILTER (WHERE operational_response_status='NOT_VERIFIABLE')::integer AS not_verifiable,
           count(*) FILTER (WHERE operational_response_status='NO_CONVERSATION')::integer AS without_conversation,
           count(*) FILTER (WHERE effective_risk IN ('HIGH','CRITICAL'))::integer AS high_risk,
           count(*) FILTER (WHERE currently_blocked AND cardinality(effective_blocking_reasons)>0)::integer AS blocked,
           count(*) FILTER (WHERE operational_freshness_status<>'FRESH')::integer AS stale,
           count(*) FILTER (WHERE effective_timer_status='EXPIRED')::integer AS timers_expired,
           count(*) FILTER (WHERE interpreted_type='RECIPIENT_ABSENT')::integer AS recipient_absent,
           count(*) FILTER (WHERE interpreted_type='ADDRESS_INCORRECT')::integer AS address_issues,
           count(*) FILTER (WHERE interpreted_type='REFUSED_BY_RECIPIENT')::integer AS refused,
           max(panel_updated_at) AS last_sync_at,$${scopeParameter}::text AS scope,
           0::integer AS actions_executed,0::integer AS production_writes
         FROM selected
       )
       SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.updated_at DESC,p.canonical_issue_id)
                        FROM page p),'[]'::jsonb) AS items,
              (SELECT count(*)::integer FROM selected) AS total,
              (SELECT to_jsonb(m) FROM metrics m) AS summary`,
      selected.values
    );
    const row = result.rows[0] || {};
    return { items: (row.items || []).map((item) => incidentInsight(privateIncidentDisplay(item, this.privateDataKey))), total: row.total || 0, limit, offset, summary: row.summary || {} };
  }

  async incidentDetail(id) {
    const [detail, timeline, feedback, customerMessages] = await Promise.all([
      this.pool.query(`SELECT * FROM ${INCIDENT_OPERATIONAL_SOURCE} incident WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_panel_context
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 200`, [id]),
      this.pool.query(`SELECT feedback_type,reason_code,created_at
        FROM decision_memory.incident_recommendation_feedback
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_records
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY created_at DESC LIMIT 20`, [id]),
      this.pool.query(`SELECT direction,message_type,intent,relation_to_issue,
          message_text_ciphertext,occurred_at
        FROM read_models.operations_private_incident_messages
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_records
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY occurred_at DESC LIMIT 20`, [id])
    ]);
    return detail.rows[0] ? {
      incident: incidentInsight(privateIncidentDisplay(detail.rows[0], this.privateDataKey)),
      customer_messages: privateIncidentMessages(customerMessages.rows, this.privateDataKey),
      timeline: timeline.rows, feedback: feedback.rows
    } : null;
  }

  async recordIncidentFeedback(id, { feedbackType, reasonCode, recommendationCode, principalHash }) {
    const allowedFeedback = new Set(['APPROVE', 'CORRECT', 'REJECT']);
    const allowedReasons = new Set(['ACCURATE', 'WRONG_TYPE', 'MISSING_CHATBY', 'WRONG_ACTION', 'STALE_DATA', 'OTHER']);
    if (!allowedFeedback.has(feedbackType) || !allowedReasons.has(reasonCode)
      || typeof recommendationCode !== 'string' || recommendationCode.length < 2 || recommendationCode.length > 80) {
      const error = new Error('invalid_feedback'); error.code = 'INVALID_FEEDBACK'; throw error;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ WRITE');
      const result = await client.query(`INSERT INTO decision_memory.incident_recommendation_feedback
        (canonical_issue_id,recommendation_code,feedback_type,reason_code,principal_hash)
        SELECT canonical_issue_id,$2,$3,$4,$5 FROM read_models.operations_incident_records
        WHERE canonical_issue_id=$1 OR dropea_issue_id=$1
        RETURNING feedback_id,feedback_type,reason_code,created_at,actions_executed,production_writes`,
      [id, recommendationCode, feedbackType, reasonCode, principalHash]);
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
}

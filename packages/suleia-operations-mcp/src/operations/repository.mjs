import { evaluateSourceFreshness } from '../../../platform-core/src/operational-truth/freshness.mjs';
import { buildResultsFinanceReport } from '../../../platform-core/src/finance/results-report.mjs';
import { privateIncidentDisplay, privateIncidentMessages, privateOrderDisplay } from './private-display.mjs';
import { incidentInsight } from './incident-insight.mjs';
import { buildRecoveryOverview, recoveryProjection, recoveryTimeline, recoveryMessageValidity } from '../../../platform-core/src/incident/recovery-center.mjs';
import { buildIncidentDashboard, dashboardProjection, dashboardScopeCounts } from '../../../platform-core/src/incident/dashboard.mjs';

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

const INCIDENT_OPERATIONAL_SOURCE = `(SELECT p.*, absent.absent_shadow, dashboard_record.dashboard_source_context,
  absent_resolution.structured AS absent_resolution_structured,absent_resolution.status AS absent_resolution_status,
  absent_resolution.idempotency_key AS absent_resolution_key,absent_resolution.resolution_hash AS absent_resolution_hash,
  autopilot.state AS autopilot_state,autopilot.mode AS autopilot_mode,
  autopilot.policy_name AS autopilot_policy_name,autopilot.policy_version AS autopilot_policy_version,
  autopilot.next_action AS autopilot_next_action,autopilot.reason AS autopilot_reason,
  autopilot.waiting_for AS autopilot_waiting_for,autopilot.due_at AS autopilot_due_at,
  autopilot.human_review AS autopilot_human_review,autopilot.error_code AS autopilot_error_code,
  autopilot.action_status AS autopilot_action_status,autopilot.verification_status AS autopilot_verification_status,
  outcome.lifecycle_status AS recovery_order_state,outcome.delivered_at_utc AS recovery_delivered_at,
  outcome.returned_at_utc AS recovery_returned_at,
  private_order.external_order_id_ciphertext,private_order.shipping_address_ciphertext,
  discount.recovery_status AS discount_recovery_status,
  discount.response_status AS discount_recovery_response_status,
  discount.initial_template_sent_at AS discount_initial_template_sent_at,
  discount.discount_due_at AS discount_due_at,
  discount.discount_sent_at AS discount_sent_at,
  discount.responded_at AS discount_responded_at,
  discount.delivery_verified AS discount_delivery_verified,
  discount.cross_source_verified AS discount_cross_source_verified,
  discount.original_amount AS discount_original_amount,
  discount.discount_amount AS discount_amount_eur,
  discount.final_amount AS discount_final_amount,
  discount.signal_quality AS discount_signal_quality,
  discount.source_updated_at AS discount_source_updated_at,
  private_message.message_text_ciphertext AS latest_customer_message_ciphertext,
  private_message.chatby_message_id_hash AS latest_private_customer_message_hash,
  private_message.occurred_at AS latest_private_customer_message_at,
  private_message.relation_to_issue AS latest_customer_message_relation,
  private_message.intent AS latest_private_customer_intent,
  private_message.message_type AS latest_private_customer_message_type,
  private_message.incident_relevance AS latest_customer_incident_relevance,
  private_message.context_template_slug AS latest_customer_context_template,
  private_message.operator_message_text_ciphertext AS latest_operator_message_ciphertext,
  private_message.operator_message_at AS latest_operator_message_at,
  CASE
    WHEN p.chatby_last_successful_sync_at IS NULL
      OR p.chatby_last_successful_sync_at < now()-interval '900 seconds'
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
      OR p.chatby_last_successful_sync_at < now()-interval '900 seconds'
      OR p.chatby_last_failure_at >= p.chatby_last_successful_sync_at THEN 'NOT_VERIFIABLE'
    WHEN p.scoped_response_status='NOT_VERIFIABLE' THEN 'NOT_VERIFIABLE'
    WHEN p.conversation_status='FOUND' AND p.customer_replied_after_issue=true
      AND coalesce(p.messages_used,0)>0 THEN 'VALID_RESPONSE'
    WHEN p.conversation_status='FOUND' THEN 'NO_VALID_RESPONSE'
    WHEN p.conversation_status='NONE' THEN 'NO_CONVERSATION'
    ELSE 'NOT_VERIFIABLE'
  END AS operational_response_status,
  CASE
    WHEN p.normalized_type='RECIPIENT_ABSENT' THEN p.effective_freshness_status
    WHEN p.last_successful_sync_at IS NULL
      OR p.last_successful_sync_at < now()-interval '900 seconds' THEN 'STALE'
    WHEN p.chatby_last_successful_sync_at IS NULL
      OR p.chatby_last_successful_sync_at < now()-interval '900 seconds'
      OR p.chatby_last_failure_at >= p.chatby_last_successful_sync_at THEN 'STALE'
    ELSE 'FRESH'
  END AS operational_freshness_status,
  CASE
    WHEN p.conversation_status='NONE' THEN 'REVIEW_CHATBY_LINK'
    WHEN p.scoped_response_status='NOT_VERIFIABLE' THEN 'HUMAN_REVIEW'
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
 FROM read_models.operations_incident_evidence_context p
 LEFT JOIN read_models.operations_incident_records dashboard_record ON dashboard_record.canonical_issue_id=p.canonical_issue_id
 LEFT JOIN operations.recipient_absent_resolutions absent_resolution ON absent_resolution.canonical_issue_id=p.canonical_issue_id
   AND absent_resolution.canonical_order_id=p.canonical_order_id
 LEFT JOIN read_models.operations_order_context outcome ON outcome.canonical_order_id=p.canonical_order_id
 LEFT JOIN read_models.operations_incident_autopilot_current autopilot ON autopilot.canonical_issue_id=p.canonical_issue_id
 LEFT JOIN read_models.recipient_absent_shadow absent ON absent.canonical_issue_id=p.canonical_issue_id
   AND absent.canonical_order_id=p.canonical_order_id AND p.notification_decision_current
 LEFT JOIN read_models.operations_private_order_display private_order ON private_order.canonical_order_id=p.canonical_order_id
 LEFT JOIN read_models.operations_incident_discount_recovery_latest discount ON discount.canonical_issue_id=p.canonical_issue_id
   AND discount.dropea_order_id=p.dropea_order_id
 LEFT JOIN LATERAL (
   SELECT m.message_text_ciphertext,m.chatby_message_id_hash,m.occurred_at,m.relation_to_issue,m.intent,m.message_type,
     m.incident_relevance,m.context_template_slug,
     (SELECT o.message_text_ciphertext
        FROM read_models.operations_private_incident_messages o
       WHERE o.canonical_issue_id=p.canonical_issue_id AND o.canonical_order_id=p.canonical_order_id AND o.direction='OUTBOUND'
         AND o.occurred_at>=p.incident_notified_at
         AND o.occurred_at<=m.occurred_at
       ORDER BY o.occurred_at DESC LIMIT 1) AS operator_message_text_ciphertext,
     (SELECT o.occurred_at
        FROM read_models.operations_private_incident_messages o
       WHERE o.canonical_issue_id=p.canonical_issue_id AND o.canonical_order_id=p.canonical_order_id AND o.direction='OUTBOUND'
         AND o.occurred_at>=p.incident_notified_at
         AND o.occurred_at<=m.occurred_at
       ORDER BY o.occurred_at DESC LIMIT 1) AS operator_message_at
   FROM read_models.operations_private_incident_messages m
   WHERE m.canonical_issue_id=p.canonical_issue_id AND m.canonical_order_id=p.canonical_order_id
     AND m.direction='INBOUND' AND m.occurred_at>p.created_at AND m.occurred_at<=now()
     AND m.relation_to_issue='AFTER_INCIDENT'
     AND m.incident_relevance IS DISTINCT FROM 'ORDER_LIFECYCLE_ONLY'
     AND coalesce(m.context_template_slug,'') NOT LIKE 'dropea_pedido_%'
   ORDER BY m.occurred_at DESC,m.chatby_message_id_hash DESC LIMIT 1
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
    decision: 'operational_decision_status', qa: 'effective_qa_status', carrier_code: 'initial_carrier_code',
    discount_response: 'discount_recovery_response_status'
  });
  const scope = String(searchParams.get('scope') || 'ACTIVE').toUpperCase();
  const absent = searchParams.get('absent');
  if (absent) {
    selected.clauses.push("normalized_type='RECIPIENT_ABSENT'");
    const fields = { FIRST_ABSENCE: ['absence_attempt','FIRST_ABSENCE'], SECOND_ABSENCE: ['absence_attempt','SECOND_ABSENCE'],
      ABSENCE_ATTEMPT_UNKNOWN:['absence_attempt','ABSENCE_ATTEMPT_UNKNOWN'], ABSENCE_ATTEMPT_CONFLICT:['absence_attempt','ABSENCE_ATTEMPT_CONFLICT'],
      WAITING_CUSTOMER: ['waiting_customer','true'], CUSTOMER_RESPONDED: ['customer_response_status','RESPONDED'],
      RESCHEDULE_REQUESTED: ['customer_intent','RESCHEDULE_DELIVERY'], PICKUP_REQUESTED: ['customer_intent','PICKUP_AT_AGENCY'],
      LOGISTICS_VALIDATION_REQUIRED: ['current_step','LOGISTICS_VALIDATION_REQUIRED'], HUMAN_REVIEW_REQUIRED: ['simulation_status','HUMAN_REVIEW_REQUIRED'], SIMULATION_READY: ['simulation_status','SIMULATION_READY'] };
    const criterion = fields[absent];
    if (criterion) { selected.values.push(criterion[1]); selected.clauses.push(`absent_shadow->>'${criterion[0]}'=$${selected.values.length}`); }
    if(absent==='STALE') selected.clauses.push("effective_freshness_status='STALE'");
  }
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

function fixedExpenseInput(input = {}) {
  const label = String(input.label || '').trim();
  const category = String(input.category || 'OTROS').trim().toUpperCase();
  const expenseType = String(input.expense_type || '').trim().toUpperCase();
  const status = String(input.status || 'ACTIVE').trim().toUpperCase();
  const amount = Number(input.amount);
  const validDate = (value) => {
    if (value === null || value === undefined || value === '') return true;
    if (!/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(String(value))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  if (label.length < 2 || label.length > 120 || !/^[A-Z0-9ÁÉÍÓÚÜÑ _-]{2,40}$/i.test(category)
    || !['RECURRING', 'ONE_OFF'].includes(expenseType) || !['ACTIVE', 'INACTIVE'].includes(status)
    || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000
    || !validDate(input.start_date) || !validDate(input.end_date) || !validDate(input.occurred_on)
    || !input.start_date || (expenseType === 'ONE_OFF' && !input.occurred_on)
    || (input.end_date && input.end_date < input.start_date)) {
    const error = new Error('invalid_fixed_expense'); error.code = 'INVALID_FIXED_EXPENSE'; throw error;
  }
  return { label, category, expenseType, status, amount: Number(amount.toFixed(2)),
    startDate: input.start_date, endDate: input.end_date || null,
    occurredOn: expenseType === 'ONE_OFF' ? input.occurred_on : null,
    storeId: input.store_id ? String(input.store_id).trim() : null };
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
        count(*) FILTER (WHERE discount_recovery_response_status='DISCOUNT_ACCEPTED')::integer AS discount_accepted,
        count(*) FILTER (WHERE discount_recovery_response_status='DISCOUNT_REJECTED')::integer AS discount_rejected,
        count(*) FILTER (WHERE discount_recovery_response_status='NO_RESPONSE')::integer AS discount_no_response,
        count(*) FILTER (WHERE discount_recovery_response_status='OTHER_RESPONSE')::integer AS discount_other_response,
        count(*) FILTER (WHERE discount_recovery_response_status='NOT_SENT')::integer AS discount_not_sent,
        max(panel_updated_at) AS last_sync_at,$${incidentFilters.values.length + 1}::text AS scope,
        0::integer AS actions_executed,0::integer AS production_writes
      FROM ${INCIDENT_OPERATIONAL_SOURCE} incident ${incidentWhere}`,
      [...incidentFilters.values, incidentFilters.scope]),
      this.pool.query('SELECT * FROM read_models.operations_protection_summary'),
      this.pool.query('SELECT * FROM read_models.operations_connector_health ORDER BY connector'),
      this.pool.query(`SELECT
        count(*)::integer AS pending,
        0::integer AS confirmed,0::integer AS shipping,0::integer AS delivered,
        count(*) FILTER (WHERE active_issue_id IS NOT NULL)::integer AS incidence,
        0::integer AS cancelled_or_rejected,0::integer AS returned,
        count(*) FILTER (WHERE human_review)::integer AS human_review,
        count(*) FILTER (WHERE active_issue_id IS NOT NULL)::integer AS with_active_issue,
        count(*) FILTER (WHERE customer_response_status='RESPONDED')::integer AS with_customer_response,
        count(*) FILTER (WHERE customer_response_status='NO_RESPONSE')::integer AS no_response,
        count(*) FILTER (WHERE customer_response_status='NOT_VERIFIABLE')::integer AS response_not_verifiable,
        count(*) FILTER (WHERE latest_customer_intent='CONFIRM')::integer AS confirm_now,
        count(*) FILTER (WHERE latest_customer_intent='ADDRESS_CHANGE')::integer AS address_change,
        count(*) FILTER (WHERE latest_customer_intent='REJECT')::integer AS reject_signal,
        count(*) FILTER (WHERE latest_customer_intent IN ('UNCLEAR','UNKNOWN','NOT_VERIFIABLE'))::integer AS review_signal,
        count(*) FILTER (WHERE duplicate_status='DUPLICATE_ACTIVE_ORDER')::integer AS prior_order,
        max(source_updated_at) AS last_sync_at
      FROM ${ORDER_OPERATIONAL_SOURCE} orders
      WHERE coalesce(lifecycle_status,status)='PENDING'`)
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

  async financialSummary(searchParams, supplementalReports = []) {
    const window = financialMonth(searchParams); const values = [window.storeId];
    const [orders, rates, fixed, advertising, months, checkpoints] = await Promise.all([
      this.pool.query(`SELECT canonical_order_id,store_id,lifecycle_status,status,created_at_utc,source_updated_at,updated_at,
        confirmed_at_utc,delivered_at_utc,returned_at_utc,total_amount,currency,carrier,product_summary,active_issue_id,
        order_costs,test_order,duplicate_status,final_amount,dropea_order_id
        FROM read_models.operations_finance_order_inputs
        WHERE ($1::text IS NULL OR store_id=$1)`, values),
      this.pool.query(`SELECT store_id,cost_type,carrier,provider,product_id,variant_id,amount,currency,
        effective_from,effective_to,source,updated_at FROM economics.finance_cost_rates
        WHERE ($1::text IS NULL OR store_id=$1)`, values),
      this.pool.query(`SELECT expense_id,store_id,label,category,expense_type,amount,currency,start_date,end_date,occurred_on,status,source,updated_at
        FROM economics.finance_fixed_expenses WHERE ($1::text IS NULL OR store_id=$1)`, values),
      this.pool.query(`SELECT store_id,business_date,platform,sum(spend)::numeric(14,2) AS spend,min(currency) AS currency,
        CASE WHEN bool_and(sync_status='COMPLETE') THEN 'COMPLETE' ELSE max(sync_status) END AS sync_status,
        max(source_observed_at) AS source_observed_at,max(ingested_at) AS ingested_at
        FROM economics.finance_ad_spend_daily WHERE ($1::text IS NULL OR store_id=$1)
        GROUP BY store_id,business_date,platform`, values),
      this.pool.query(`SELECT DISTINCT month FROM read_models.finance_available_months
        WHERE ($1::text IS NULL OR store_id=$1) ORDER BY month DESC LIMIT 24`, [window.storeId]),
      this.pool.query(`SELECT max(source_updated_at) AS dropea_last_sync_at,
        max(updated_at) AS read_model_last_updated_at FROM read_models.operations_finance_order_inputs
        WHERE ($1::text IS NULL OR store_id=$1)`, values)
    ]);
    const report = buildResultsFinanceReport({
      month: window.month,
      orders: orders.rows,
      rates: rates.rows.map((row) => ({ ...row, effective_from: dateOnly(row.effective_from), effective_to: dateOnly(row.effective_to) })),
      localFixedExpenses: fixed.rows.map((row) => ({ ...row, start_date: dateOnly(row.start_date), end_date: dateOnly(row.end_date), occurred_on: dateOnly(row.occurred_on) })),
      localAdSpend: advertising.rows.map((row) => ({ ...row, business_date: dateOnly(row.business_date) })),
      supplementalReports,
      availableMonths: months.rows.map((row) => row.month),
      dropeaLastSyncAt: checkpoints.rows[0]?.dropea_last_sync_at || null
    });
    return {
      ...report, store_id: window.storeId,
      shopify_orders_available: false,
      limitations: [
        'El P&L concilia los pedidos del mes de Dropea con su estado y desglose financiero final.',
        'Shopify no interviene en pedidos, facturación, costes ni beneficio.',
        'Las devoluciones usan el coste real expuesto por Dropea para cada pedido; 5,26 € queda solo como respaldo si falta.',
        'Un coste o día publicitario sin fuente completa queda visible como no disponible; nunca se inventa un cero.'
      ],
      actions_executed: 0, production_writes: 0
    };
  }

  async listOrders(searchParams) {
    const limit = integer(searchParams.get('limit'), 50, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const selected = filters(searchParams, {
      status: 'status', risk: 'risk',
      freshness: 'freshness', identity: 'identity_status'
    });
    // The Operations orders queue is intentionally the authoritative Dropea
    // pending queue. Historical lifecycle states belong in financial reports
    // and detail timelines, never mixed into this operational worklist.
    selected.clauses.push("coalesce(lifecycle_status,status)='PENDING'");
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
      `SELECT *, count(*) OVER()::integer AS total_count,
         max(source_updated_at) OVER() AS pending_queue_last_sync_at
       FROM ${ORDER_OPERATIONAL_SOURCE} orders ${where}
       ORDER BY updated_at DESC, canonical_order_id
       LIMIT $${selected.values.length - 1} OFFSET $${selected.values.length}`,
      selected.values
    );
    return { items: result.rows.map((row) => privateOrderDisplay(row, this.privateDataKey)), total: result.rows[0]?.total_count || 0,
      limit, offset, scope: 'DROPEA_PENDING', last_sync_at: result.rows[0]?.pending_queue_last_sync_at || null };
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
    return this.incidentOverview(searchParams);
  }

  async incidentOverview(searchParams) {
    const started=performance.now();
    const limit = integer(searchParams.get('limit'), 25, 1, 100);
    const offset = integer(searchParams.get('offset'), 0, 0, 100_000);
    const month = searchParams.get('month');
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('INVALID_RECOVERY_MONTH');
    const values = month ? [month] : [];
    const scope=searchParams.get('scope') || 'ACTIVE';
    const conditions=month?["to_char(created_at AT TIME ZONE 'Europe/Madrid','YYYY-MM')=$1"]:[];
    if(scope==='HISTORICAL')conditions.push("NOT (status='PENDING' AND is_active=true)");
    else if(scope!=='ALL')conditions.push("status='PENDING' AND is_active=true");
    const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
    // One complete universe, no truncation. Pagination follows canonical filtering.
    const [result,months,health,scopes] = await Promise.all([
      this.pool.query(`SELECT * FROM ${INCIDENT_OPERATIONAL_SOURCE} incident ${where}`,values),
      this.pool.query(`SELECT DISTINCT to_char(created_at AT TIME ZONE 'Europe/Madrid','YYYY-MM') AS month
        FROM read_models.operations_incident_records ORDER BY month DESC`),
      this.pool.query('SELECT * FROM read_models.operations_connector_health ORDER BY connector'),
      this.pool.query('SELECT status,is_active,type,raw_type,dashboard_source_context FROM read_models.operations_incident_records')
    ]);
    const items=result.rows.map(row=>incidentInsight(privateIncidentDisplay(row,this.privateDataKey)));
    const connectors=health.rows.map(row=>({...row,...evaluateSourceFreshness({source:row.connector,source_observed_at:row.checked_at,
      ingested_at:row.checked_at,last_successful_sync_at:row.last_success_at,last_failure_at:row.last_failure_at,
      sync_complete:row.pagination_complete})}));
    const dashboard=buildIncidentDashboard(items,{filters:Object.fromEntries(searchParams),limit,offset,
      availableMonths:months.rows.map(r=>r.month),connectorHealth:connectors,scopeCounts:dashboardScopeCounts(scopes.rows)});
    console.info(JSON.stringify({event:'incident_dashboard_read',version:dashboard.summary.dashboard.version,
      scope:dashboard.summary.scope,filter_keys:[...searchParams.keys()].filter(key=>['type','metric','scope','response','month','risk','template','attempt','flow','q'].includes(key)),
      source_rows:items.length,result_rows:dashboard.total,returned_rows:dashboard.items.length,
      stale_rows:dashboard.summary.dashboard.stale,duration_ms:Math.round(performance.now()-started)}));
    return dashboard;
  }

  async incidentDetail(id) {
    const [detail, timeline, feedback, customerMessages] = await Promise.all([
      this.pool.query(`SELECT * FROM ${INCIDENT_OPERATIONAL_SOURCE} incident WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1`, [id]),
      this.pool.query(`SELECT * FROM read_models.operations_order_timeline
        WHERE canonical_order_id=(SELECT canonical_order_id FROM read_models.operations_incident_panel_context
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY occurred_at ASC`, [id]),
      this.pool.query(`SELECT feedback_type,reason_code,created_at
        FROM decision_memory.incident_recommendation_feedback
        WHERE canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_records
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY created_at DESC LIMIT 20`, [id]),
      this.pool.query(`SELECT m.direction,m.message_type,m.intent,m.relation_to_issue,m.incident_relevance,m.context_template_slug,
          m.chatby_message_id_hash,
          m.message_text_ciphertext,m.occurred_at,
          CASE WHEN m.direction='INBOUND' AND m.occurred_at>s.incident_notified_at
            AND s.scoped_response_status<>'NOT_VERIFIABLE'
            AND m.incident_relevance NOT IN ('ORDER_LIFECYCLE_ONLY','BEFORE_INCIDENT','BEFORE_NOTIFICATION','NOTIFICATION_NOT_OBSERVED')
            THEN 'AFTER_NOTIFICATION' ELSE 'HISTORICAL_NOT_INCIDENT_RESPONSE' END AS relation_to_notification
        FROM read_models.operations_private_incident_messages m
        JOIN read_models.operations_incident_notification_scope s USING(canonical_issue_id,canonical_order_id)
        WHERE m.canonical_issue_id=(SELECT canonical_issue_id FROM read_models.operations_incident_records
          WHERE canonical_issue_id=$1 OR dropea_issue_id=$1 LIMIT 1)
        ORDER BY m.occurred_at ASC`, [id])
    ]);
    if (!detail.rows[0]) return null;
    const incident=dashboardProjection(incidentInsight(privateIncidentDisplay(detail.rows[0], this.privateDataKey)));
    const messages=privateIncidentMessages(customerMessages.rows,this.privateDataKey)
      .map(message=>({...message,relation_to_notification:recoveryMessageValidity(message)}));
    return {incident,customer_messages:messages,timeline:timeline.rows,feedback:feedback.rows,
      recovery_timeline:recoveryTimeline(incident,timeline.rows,messages)};
  }

  async metaBudgetSimulation(searchParams) {
    const limit = integer(searchParams.get('limit'), 100, 1, 250);
    const result = await this.pool.query(`SELECT * FROM read_models.meta_budget_simulation_latest
      ORDER BY last_evaluation DESC,campaign_id LIMIT $1`, [limit]);
    return {
      mode: 'SIMULATION_SHADOW_ONLY', safety_notice: 'SIMULATION - NO REAL CHANGES',
      campaigns: result.rows, count: result.rows.length,
      actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0
    };
  }

  async metaBudgetHistory(searchParams) {
    const limit = integer(searchParams.get('limit'), 250, 1, 1000);
    const campaignId = searchParams.get('campaign_id')?.trim() || null;
    const result = await this.pool.query(`SELECT * FROM read_models.meta_budget_decision_history
      WHERE ($1::text IS NULL OR campaign_id=$1)
      ORDER BY evaluation_hour DESC,campaign_id LIMIT $2`, [campaignId, limit]);
    return {
      mode: 'SIMULATION_SHADOW_ONLY', safety_notice: 'SIMULATION - NO REAL CHANGES',
      decisions: result.rows, count: result.rows.length,
      actions_executed: 0, production_writes: 0, meta_budget_writes: 0, external_actions: 0
    };
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

  async saveFixedExpense(id, input, principalHash) {
    const value = fixedExpenseInput(input);
    if (id !== null && id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))) {
      const error = new Error('invalid_fixed_expense'); error.code = 'INVALID_FIXED_EXPENSE'; throw error;
    }
    if (typeof principalHash !== 'string' || principalHash.length < 8 || principalHash.length > 256) {
      const error = new Error('invalid_fixed_expense'); error.code = 'INVALID_FIXED_EXPENSE'; throw error;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ WRITE');
      const values = [value.storeId, value.label, value.category, value.expenseType, value.amount,
        value.startDate, value.endDate, value.occurredOn, value.status];
      const result = id ? await client.query(`UPDATE economics.finance_fixed_expenses SET
          label=$2,category=$3,expense_type=$4,amount=$5,currency='EUR',start_date=$6,end_date=$7,
          occurred_on=$8,status=$9,source='OPERATIONS_CENTER_USER',updated_at=now()
        WHERE expense_id=$10 AND ($1::text IS NULL OR store_id=$1)
        RETURNING expense_id,store_id,label,category,expense_type,amount,currency,start_date,end_date,occurred_on,status,source,updated_at`,
      [...values, id]) : await client.query(`INSERT INTO economics.finance_fixed_expenses
          (store_id,label,category,expense_type,amount,currency,start_date,end_date,occurred_on,status,source)
        SELECT coalesce($1,(SELECT min(store_id) FROM integration.dropea_store_config WHERE enabled=true)),
          $2,$3,$4,$5,'EUR',$6,$7,$8,$9,'OPERATIONS_CENTER_USER'
        WHERE coalesce($1,(SELECT min(store_id) FROM integration.dropea_store_config WHERE enabled=true)) IS NOT NULL
        RETURNING expense_id,store_id,label,category,expense_type,amount,currency,start_date,end_date,occurred_on,status,source,updated_at`, values);
      const row = result.rows[0] || null;
      if (row) await client.query(`INSERT INTO economics.finance_fixed_expense_audit
          (expense_id,operation,snapshot,principal_hash)
        VALUES ($1,$2,$3::jsonb,$4)`, [row.expense_id, id ? 'UPDATE' : 'CREATE', JSON.stringify(row), principalHash]);
      await client.query('COMMIT');
      return row ? { ...row, start_date: dateOnly(row.start_date), end_date: dateOnly(row.end_date),
        occurred_on: dateOnly(row.occurred_on), external_actions: 0, provider_writes: 0 } : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
}

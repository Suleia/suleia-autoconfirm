export const ORGANIZATION_SCHEMA_VERSION = '1.0.0';

export const ORGANIZATION_LAYERS = Object.freeze([
  'EXECUTIVE_CONTROL',
  'OPERATIONS',
  'INTELLIGENCE',
  'GOVERNANCE',
  'ECONOMIC',
  'PLATFORM'
]);

export const AGENT_ALLOWED_OPERATIONS = Object.freeze([
  'READ_MASKED_DATA',
  'EVALUATE_RULES',
  'PROPOSE_DECISION',
  'SIMULATE',
  'CREATE_REVIEW_REQUEST',
  'EMIT_AUDIT_EVENT'
]);

export const AGENT_FORBIDDEN_OPERATIONS = Object.freeze([
  'EXECUTE_ACTION',
  'WRITE_PRODUCTION',
  'SEND_CUSTOMER_MESSAGE',
  'APPLY_DISCOUNT',
  'CONFIRM_ORDER',
  'CANCEL_ORDER',
  'RETURN_ORDER',
  'CALL_EXTERNAL_AI',
  'CALL_OPENAI_API',
  'MODIFY_POLICY'
]);

export const EXECUTIVE_SNAPSHOT_FIELDS = Object.freeze([
  'snapshot_id',
  'generated_at',
  'business_date',
  'environment',
  'source_freshness',
  'total_orders',
  'confirmed_orders',
  'pending_orders',
  'cancelled_orders',
  'incidents_open',
  'incidents_blocked',
  'human_review_count',
  'timers_expiring',
  'policy_conflicts',
  'data_quality_issues',
  'estimated_revenue_at_risk',
  'estimated_recovered_revenue',
  'actions_executed',
  'production_writes',
  'schema_version'
]);

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${field} must be a non-empty string array`);
  }
}

export function assertDepartmentContract(department) {
  assertNonEmptyString(department.department_id, 'department_id');
  assertNonEmptyString(department.name, 'name');
  assertNonEmptyString(department.executive_owner, 'executive_owner');
  if (!ORGANIZATION_LAYERS.includes(department.layer)) {
    throw new Error(`Unsupported organization layer: ${department.layer}`);
  }
  assertStringArray(department.responsibilities, 'responsibilities');
  assertStringArray(department.outputs, 'outputs');
  assertNonEmptyString(department.primary_agent_id, 'primary_agent_id');
  if (department.status !== 'CONTRACT_ONLY') {
    throw new Error('Phase A departments must remain CONTRACT_ONLY');
  }
  return department;
}

export function assertAgentContract(agent) {
  assertNonEmptyString(agent.agent_id, 'agent_id');
  assertNonEmptyString(agent.department_id, 'department_id');
  assertNonEmptyString(agent.name, 'name');
  assertStringArray(agent.inputs, 'inputs');
  assertStringArray(agent.outputs, 'outputs');
  assertStringArray(agent.allowed_operations, 'allowed_operations');
  assertStringArray(agent.forbidden_operations, 'forbidden_operations');
  if (agent.agent_kind !== 'DETERMINISTIC_RULE_AGENT') {
    throw new Error('Only deterministic rule agents are allowed');
  }
  if (agent.run_mode !== 'SIMULATION' || agent.can_execute !== false) {
    throw new Error('Phase A agents must be simulation-only and non-executing');
  }
  if (agent.external_ai_allowed !== false || agent.production_writes_allowed !== false) {
    throw new Error('External AI and production writes must remain disabled');
  }
  for (const forbidden of AGENT_FORBIDDEN_OPERATIONS) {
    if (!agent.forbidden_operations.includes(forbidden)) {
      throw new Error(`Agent contract is missing forbidden operation: ${forbidden}`);
    }
  }
  return agent;
}

export function assertExecutiveSnapshotContract(snapshot) {
  const missing = EXECUTIVE_SNAPSHOT_FIELDS.filter((field) => !(field in snapshot));
  if (missing.length) throw new Error(`Executive snapshot is missing: ${missing.join(', ')}`);
  if (snapshot.actions_executed !== 0 || snapshot.production_writes !== 0) {
    throw new Error('Executive snapshots must preserve zero-action safety');
  }
  if (snapshot.schema_version !== ORGANIZATION_SCHEMA_VERSION) {
    throw new Error('Executive snapshot schema version is not current');
  }
  return snapshot;
}

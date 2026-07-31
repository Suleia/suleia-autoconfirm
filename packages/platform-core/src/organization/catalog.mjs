import {
  AGENT_ALLOWED_OPERATIONS,
  AGENT_FORBIDDEN_OPERATIONS,
  ORGANIZATION_SCHEMA_VERSION,
  assertAgentContract,
  assertDepartmentContract
} from './contracts.mjs';

const departmentDefinitions = [
  ['chief-operations-office', 'Chief Operations Office', 'EXECUTIVE_CONTROL', 'platform-owner', ['Consolidar el estado operativo', 'Priorizar bloqueos y revisiones'], ['executive_snapshot', 'department_status']],
  ['chief-intelligence-office', 'Chief Intelligence Office', 'EXECUTIVE_CONTROL', 'platform-owner', ['Consolidar inteligencia determinista', 'Supervisar calidad de recomendaciones'], ['data_quality_summary', 'strategic_recommendation']],
  ['chief-risk-compliance-office', 'Chief Risk & Compliance Office', 'EXECUTIVE_CONTROL', 'platform-owner', ['Consolidar riesgos y cumplimiento', 'Escalar bloqueos críticos'], ['risk_summary', 'operational_alert']],
  ['chief-financial-operations-office', 'Chief Financial Operations Office', 'EXECUTIVE_CONTROL', 'platform-owner', ['Consolidar impacto económico', 'Informar margen y recuperación'], ['economic_summary']],
  ['chief-platform-office', 'Chief Platform Office', 'EXECUTIVE_CONTROL', 'platform-owner', ['Consolidar salud de plataforma', 'Supervisar migración y capacidad'], ['migration_summary', 'department_status']],

  ['order-confirmation-department', 'Order Confirmation Department', 'OPERATIONS', 'chief-operations-office', ['Evaluar confirmación vigente', 'Preservar espera de una hora y revocaciones'], ['decision_candidate', 'review_request']],
  ['cancellation-department', 'Cancellation Department', 'OPERATIONS', 'chief-operations-office', ['Evaluar cancelación explícita e inactividad', 'Distinguir cancelación y devolución'], ['decision_candidate', 'review_request']],
  ['incident-management-department', 'Incident Management Department', 'OPERATIONS', 'chief-operations-office', ['Normalizar incidencias', 'Aplicar plazos de 48 horas'], ['incident_assessment', 'decision_candidate']],
  ['logistics-department', 'Logistics Department', 'OPERATIONS', 'chief-operations-office', ['Interpretar evidencia logística vigente', 'Proponer resolución sin ejecutar'], ['logistics_assessment']],
  ['customer-recovery-department', 'Customer Recovery Department', 'OPERATIONS', 'chief-operations-office', ['Evaluar recuperación comercial', 'Mantener descuentos deshabilitados'], ['recovery_assessment']],
  ['agency-pickup-department', 'Agency Pickup Department', 'OPERATIONS', 'chief-operations-office', ['Verificar recogida en agencia', 'Evitar promesas no confirmadas'], ['agency_pickup_assessment']],
  ['address-resolution-department', 'Address Resolution Department', 'OPERATIONS', 'chief-operations-office', ['Detectar datos de dirección insuficientes', 'Solicitar revisión cuando falte evidencia'], ['address_assessment']],
  ['human-review-department', 'Human Review Department', 'OPERATIONS', 'chief-operations-office', ['Gestionar casos HIGH y ambiguos', 'Registrar decisiones humanas sin autoaprendizaje'], ['review_request', 'human_decision_record']],

  ['operational-intelligence-department', 'Operational Intelligence', 'INTELLIGENCE', 'chief-intelligence-office', ['Calcular métricas operativas locales'], ['operational_metric']],
  ['pattern-detection-department', 'Pattern Detection', 'INTELLIGENCE', 'chief-intelligence-office', ['Detectar patrones mediante reglas y estadística local'], ['pattern_signal']],
  ['forecasting-department', 'Forecasting', 'INTELLIGENCE', 'chief-intelligence-office', ['Calcular previsiones deterministas y reproducibles'], ['forecast_snapshot']],
  ['policy-simulation-department', 'Policy Simulation', 'INTELLIGENCE', 'chief-intelligence-office', ['Comparar políticas solo en simulación'], ['simulation_report']],
  ['human-decision-learning-department', 'Learning from Human Decisions', 'INTELLIGENCE', 'chief-intelligence-office', ['Agregar decisiones humanas', 'Proponer cambios sin aplicarlos'], ['policy_change_proposal']],
  ['data-quality-intelligence-department', 'Data Quality Intelligence', 'INTELLIGENCE', 'chief-intelligence-office', ['Medir completitud, frescura y contradicciones'], ['data_quality_issue']],
  ['strategic-reporting-department', 'Strategic Reporting', 'INTELLIGENCE', 'chief-intelligence-office', ['Producir informes explicables y enmascarados'], ['strategic_report']],

  ['policy-engine-department', 'Policy Engine', 'GOVERNANCE', 'chief-risk-compliance-office', ['Versionar y resolver prioridad de políticas'], ['policy_evaluation']],
  ['risk-engine-department', 'Risk Engine', 'GOVERNANCE', 'chief-risk-compliance-office', ['Clasificar LOW, MEDIUM, HIGH y CRITICAL'], ['risk_evaluation']],
  ['qa-gate-department', 'QA Gate', 'GOVERNANCE', 'chief-risk-compliance-office', ['Validar evidencia, idempotencia y compatibilidad'], ['qa_evaluation']],
  ['compliance-engine-department', 'Compliance Engine', 'GOVERNANCE', 'chief-risk-compliance-office', ['Validar minimización, masking y trazabilidad'], ['compliance_evaluation']],
  ['authorization-gateway-department', 'Authorization Gateway', 'GOVERNANCE', 'chief-risk-compliance-office', ['Verificar autorizaciones sin ejecutar'], ['authorization_assessment']],
  ['audit-reconciliation-department', 'Audit & Reconciliation', 'GOVERNANCE', 'chief-risk-compliance-office', ['Conciliar eventos, decisiones y resultados'], ['reconciliation_report']],

  ['unit-economics-department', 'Unit Economics', 'ECONOMIC', 'chief-financial-operations-office', ['Calcular economía unitaria sin autorizar'], ['unit_economics']],
  ['recovery-economics-department', 'Recovery Economics', 'ECONOMIC', 'chief-financial-operations-office', ['Calcular valor esperado de recuperación'], ['recovery_economics']],
  ['delivery-cost-analysis-department', 'Delivery Cost Analysis', 'ECONOMIC', 'chief-financial-operations-office', ['Comparar costes de entrega y devolución'], ['delivery_cost_analysis']],
  ['discount-impact-analysis-department', 'Discount Impact Analysis', 'ECONOMIC', 'chief-financial-operations-office', ['Calcular impacto sin aplicar descuentos'], ['discount_impact_analysis']],
  ['margin-protection-department', 'Margin Protection', 'ECONOMIC', 'chief-financial-operations-office', ['Señalar margen en riesgo sin decidir acciones'], ['margin_risk_alert']],

  ['event-fabric-department', 'Event Fabric', 'PLATFORM', 'chief-platform-office', ['Mantener contratos append-only e idempotencia'], ['event_contract_status']],
  ['digital-twin-department', 'Digital Twin', 'PLATFORM', 'chief-platform-office', ['Consolidar estado derivado reproducible'], ['digital_twin_status']],
  ['timer-engine-department', 'Timer Engine', 'PLATFORM', 'chief-platform-office', ['Supervisar timers persistentes e idempotentes'], ['timer_status']],
  ['postgresql-department', 'PostgreSQL', 'PLATFORM', 'chief-platform-office', ['Supervisar persistencia privada y roles mínimos'], ['database_status']],
  ['mcp-department', 'MCP', 'PLATFORM', 'chief-platform-office', ['Exponer solo lectura y simulación con PII enmascarada'], ['mcp_status']],
  ['connectors-department', 'Connectors', 'PLATFORM', 'chief-platform-office', ['Medir salud de fuentes sin escribir'], ['connector_status']],
  ['observability-department', 'Observability', 'PLATFORM', 'chief-platform-office', ['Consolidar salud, latencia y capacidad'], ['observability_status']],
  ['backup-restore-department', 'Backup & Restore', 'PLATFORM', 'chief-platform-office', ['Verificar backup, restore y rotación'], ['backup_status']],
  ['migration-control-department', 'Migration Control', 'PLATFORM', 'chief-platform-office', ['Inventariar paridad, divergencia y rollback'], ['migration_status']]
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function toDepartment([department_id, name, layer, executive_owner, responsibilities, outputs]) {
  return assertDepartmentContract({
    department_id,
    name,
    layer,
    executive_owner,
    responsibilities,
    outputs,
    primary_agent_id: `${department_id}-agent`,
    status: 'CONTRACT_ONLY',
    schema_version: ORGANIZATION_SCHEMA_VERSION
  });
}

function toAgent(department) {
  return assertAgentContract({
    agent_id: department.primary_agent_id,
    name: `${department.name} Deterministic Agent`,
    department_id: department.department_id,
    agent_kind: 'DETERMINISTIC_RULE_AGENT',
    purpose: department.responsibilities.join('; '),
    inputs: ['masked_events', 'order_digital_twin', 'versioned_policy', 'source_freshness'],
    outputs: department.outputs,
    allowed_operations: [...AGENT_ALLOWED_OPERATIONS],
    forbidden_operations: [...AGENT_FORBIDDEN_OPERATIONS],
    run_mode: 'SIMULATION',
    can_execute: false,
    external_ai_allowed: false,
    production_writes_allowed: false,
    requires_audit: true,
    schema_version: ORGANIZATION_SCHEMA_VERSION
  });
}

export const DEPARTMENTS = deepFreeze(departmentDefinitions.map(toDepartment));
export const AGENT_CATALOG = deepFreeze(DEPARTMENTS.map(toAgent));

export const SULEIA_OPERATING_SYSTEM = deepFreeze({
  organization_id: 'suleia-operating-system',
  name: 'Suleia Autonomous Operations Company',
  architecture_style: 'MODULAR_MONOLITH',
  implementation_phase: 'PHASE_A_CONTRACT_ONLY',
  schema_version: ORGANIZATION_SCHEMA_VERSION,
  layers: Object.fromEntries(
    ['EXECUTIVE_CONTROL', 'OPERATIONS', 'INTELLIGENCE', 'GOVERNANCE', 'ECONOMIC', 'PLATFORM']
      .map((layer) => [layer, DEPARTMENTS.filter((department) => department.layer === layer).map((department) => department.department_id)])
  ),
  invariants: {
    openai_api_calls: 0,
    external_ai_calls: 0,
    actions_executed: 0,
    production_writes: 0,
    messages_sent: 0,
    discounts_applied: 0
  }
});

export function validateOrganizationCatalog() {
  const departmentIds = new Set(DEPARTMENTS.map((item) => item.department_id));
  const agentIds = new Set(AGENT_CATALOG.map((item) => item.agent_id));
  if (departmentIds.size !== DEPARTMENTS.length) throw new Error('Duplicate department id');
  if (agentIds.size !== AGENT_CATALOG.length) throw new Error('Duplicate agent id');
  if (DEPARTMENTS.length !== AGENT_CATALOG.length) throw new Error('Every department requires exactly one primary agent');
  for (const agent of AGENT_CATALOG) {
    if (!departmentIds.has(agent.department_id)) throw new Error(`Unknown department for agent ${agent.agent_id}`);
  }
  return true;
}

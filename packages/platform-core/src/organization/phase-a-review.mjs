import { AGENT_CATALOG, DEPARTMENTS, SULEIA_OPERATING_SYSTEM } from './catalog.mjs';

const POLICY_DOMAIN_BY_LAYER = Object.freeze({
  EXECUTIVE_CONTROL: 'executive-read-model-policy',
  OPERATIONS: 'current-operational-policy',
  INTELLIGENCE: 'simulation-and-reporting-policy',
  GOVERNANCE: 'central-governance-policy',
  ECONOMIC: 'economic-analysis-only-policy',
  PLATFORM: 'platform-safety-policy'
});

const RISK_DOMAIN_BY_LAYER = Object.freeze({
  EXECUTIVE_CONTROL: 'AGGREGATION_RISK',
  OPERATIONS: 'CUSTOMER_AND_ORDER_RISK',
  INTELLIGENCE: 'INFERENCE_AND_DATA_QUALITY_RISK',
  GOVERNANCE: 'POLICY_AND_AUTHORIZATION_RISK',
  ECONOMIC: 'FINANCIAL_ESTIMATION_RISK',
  PLATFORM: 'TECHNICAL_AND_DATA_RISK'
});

function dependencyCycles() {
  const owners = new Map(DEPARTMENTS.map((department) => [department.department_id, department.executive_owner]));
  const cycles = [];
  for (const department of DEPARTMENTS) {
    const visited = new Set([department.department_id]);
    let current = owners.get(department.department_id);
    while (owners.has(current)) {
      if (visited.has(current)) {
        cycles.push([...visited, current]);
        break;
      }
      visited.add(current);
      current = owners.get(current);
    }
  }
  return cycles;
}

export function createPhaseAReview() {
  const agentByDepartment = new Map(AGENT_CATALOG.map((agent) => [agent.department_id, agent]));
  const responsibilityOwners = new Map();
  for (const department of DEPARTMENTS) {
    for (const responsibility of department.responsibilities) {
      const normalized = responsibility.trim().toLowerCase();
      responsibilityOwners.set(normalized, [...(responsibilityOwners.get(normalized) ?? []), department.department_id]);
    }
  }
  const duplicateResponsibilities = [...responsibilityOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([responsibility, owners]) => ({ responsibility, owners }));
  const matrix = DEPARTMENTS.map((department) => {
    const agent = agentByDepartment.get(department.department_id);
    return Object.freeze({
      department_id: department.department_id,
      agent_id: agent.agent_id,
      functional_owner: department.executive_owner,
      inputs: agent.inputs,
      outputs: agent.outputs,
      policy_domain: POLICY_DOMAIN_BY_LAYER[department.layer],
      risk_domain: RISK_DOMAIN_BY_LAYER[department.layer]
    });
  });
  return Object.freeze({
    architecture_style: SULEIA_OPERATING_SYSTEM.architecture_style,
    department_count: DEPARTMENTS.length,
    agent_count: AGENT_CATALOG.length,
    logical_module_count: AGENT_CATALOG.length,
    independent_service_count: 0,
    independent_container_count: 0,
    permanent_worker_count: 0,
    independent_queue_count: 0,
    independent_database_count: 0,
    duplicate_responsibilities: Object.freeze(duplicateResponsibilities),
    dependency_cycles: Object.freeze(dependencyCycles()),
    all_agents_inactive: AGENT_CATALOG.every((agent) => agent.can_execute === false && agent.run_mode === 'SIMULATION'),
    all_agents_single_owner: DEPARTMENTS.every((department) => typeof department.executive_owner === 'string' && department.executive_owner.length > 0),
    direct_write_capability_count: AGENT_CATALOG.filter((agent) => agent.production_writes_allowed || agent.can_execute).length,
    matrix: Object.freeze(matrix),
    consolidation_recommendation: 'KEEP_40_LOGICAL_MODULES_WITH_SHARED_GOVERNANCE_RUNTIME'
  });
}

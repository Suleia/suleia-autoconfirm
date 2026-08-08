import fs from 'node:fs/promises';
import os from 'node:os';
import { statfsSync } from 'node:fs';
import {
  AGENT_CATALOG,
  DEPARTMENTS,
  SULEIA_OPERATING_SYSTEM
} from '../../../platform-core/src/organization/catalog.mjs';
import {
  REQUIRED_TIMER_HOURS,
  TEMPORAL_POLICIES
} from '../../../platform-core/src/governance/temporal-policies.mjs';

const FINAL_MCP_TOOLS = Object.freeze([
  'get_order',
  'get_order_timeline',
  'get_data_freshness',
  'get_active_timers',
  'get_agent_decisions',
  'preview_order_decision',
  'compare_simulation_with_current_system',
  'list_orders_needing_ai_review',
  'search_orders',
  'search_incidents',
  'get_incident',
  'search_operational_findings',
  'get_platform_overview',
  'get_runtime_inventory',
  'get_database_catalog',
  'get_component_details'
]);

const SERVICE_MANIFEST = Object.freeze([
  ['VPS', 'reverse-proxy', 'caddy:2.10-alpine', ['api', 'mcp-server']],
  ['VPS', 'mcp-edge', 'caddy:2.10-alpine', ['mcp-server', 'keycloak']],
  ['VPS', 'api', 'suleia-node:22.22.0', ['postgres', 'keycloak']],
  ['VPS', 'mcp-server', 'suleia-node:22.22.0', ['postgres', 'keycloak']],
  ['VPS', 'decision-engine', 'suleia-node:22.22.0', ['postgres']],
  ['VPS', 'ingestion-worker', 'suleia-node:22.22.0', ['postgres', 'Dropea V2', 'Chatby']],
  ['VPS', 'scheduler', 'suleia-node:22.22.0', ['postgres']],
  ['VPS', 'review-panel', 'nginx:1.29-alpine', ['api']],
  ['VPS', 'postgres', 'postgres:17.5-alpine', []],
  ['VPS', 'keycloak', 'suleia-keycloak:26.7.0', ['postgres']],
  ['VPS', 'monitoring', 'uptime-kuma:1.23.16-alpine', []],
  ['VPS', 'backup', 'postgres:17.5-alpine', ['postgres']],
  ['RENDER', 'suleia-autoconfirm', 'managed-runtime', ['Supabase', 'Shopify', 'Chatby']],
  ['SUPABASE', 'legacy-operational-store', 'managed-postgres', ['suleia-autoconfirm']]
].map(([platform, service, image, dependencies]) => ({
  platform,
  service,
  container: service,
  image,
  dependencies,
  declared_status: ['RENDER', 'SUPABASE'].includes(platform) ? 'LEGACY_EXTERNAL_DEPENDENCY' : 'DECLARED',
  read_only_observation: true
})));

const COMPONENTS = Object.freeze([
  {
    component_id: 'event-store', type: 'MODULE', purpose: 'Append-only order event contracts and deterministic replay input.',
    location: 'packages/platform-core/src/event-store.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['masked canonical events'], produces: ['append-only event records'], dependencies: [],
    consumers: ['digital-twin', 'decision-engine', 'operations-order-timeline'], database_objects: ['events.order_events']
  },
  {
    component_id: 'digital-twin', type: 'MODULE', purpose: 'Rebuilds reproducible masked order state from current evidence.',
    location: 'packages/platform-core/src/digital-twin.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['event-store', 'source freshness'], produces: ['masked order digital twin'], dependencies: ['event-store'],
    consumers: ['decision-engine'], database_objects: ['core.order_digital_twins', 'enterprise_twins.snapshots']
  },
  {
    component_id: 'decision-engine', type: 'MODULE', purpose: 'Produces deterministic proposals without executing external actions.',
    location: 'packages/platform-core/src/decision-engine.mjs', status: 'SIMULATION_ONLY',
    consumes: ['digital-twin', 'policy registry', 'timers'], produces: ['simulated decision'],
    dependencies: ['digital-twin', 'policy-registry', 'timer-engine'], consumers: ['operations-center', 'mcp-server'],
    database_objects: ['decisions.decision_records', 'operations.incident_simulation_decisions']
  },
  {
    component_id: 'incident-processor', type: 'MODULE', purpose: 'Normalizes incidents and composes conversation, policy, timer, GLS, risk and QA evidence.',
    location: 'packages/platform-core/src/incident/incident-processor.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['Dropea V2 incident', 'Chatby interpretation', 'GLS registry'], produces: ['incident assessment', 'simulated decision input'],
    dependencies: ['conversation-intelligence', 'policy-registry', 'timer-engine', 'risk-engine', 'qa-gate'],
    consumers: ['decision-engine', 'operations-incident-context'], database_objects: ['integration.dropea_issues', 'read_models.operations_incident_context']
  },
  {
    component_id: 'conversation-intelligence', type: 'MODULE', purpose: 'Derives sanitized customer intent from issue-correlated Chatby evidence.',
    location: 'packages/platform-core/src/incident/conversation-intelligence.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['sanitized Chatby messages', 'canonical issue identity'], produces: ['current intent', 'confidence', 'contradiction'],
    dependencies: [], consumers: ['incident-processor'],
    database_objects: ['operations.chatby_conversation_links', 'operations.incident_intent_timeline', 'read_models.operations_incident_interpretations']
  },
  {
    component_id: 'policy-registry', type: 'MODULE', purpose: 'Loads, versions and exposes deterministic policies with explicit precedence and rollback.',
    location: 'packages/platform-core/src/governance/policy-registry.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['versioned policies'], produces: ['active policy set'], dependencies: [],
    consumers: ['decision-engine', 'incident-processor'], database_objects: ['configuration.policies', 'configuration.policy_versions']
  },
  {
    component_id: 'timer-engine', type: 'MODULE', purpose: 'Evaluates persistent, cancellable and superseding timers without executing actions.',
    location: 'packages/platform-core/src/timer-engine.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['policy timer definitions', 'canonical events'], produces: ['timer status'], dependencies: ['policy-registry'],
    consumers: ['decision-engine', 'operations-center', 'mcp-server'], database_objects: ['core.timers', 'operations.incident_timers']
  },
  {
    component_id: 'risk-engine', type: 'MODULE', purpose: 'Classifies operational risk using deterministic evidence.',
    location: 'packages/platform-core/src/governance/risk-engine.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['incident facts', 'policy result'], produces: ['risk classification'], dependencies: [], consumers: ['decision-engine', 'qa-gate']
  },
  {
    component_id: 'qa-gate', type: 'MODULE', purpose: 'Blocks incomplete, contradictory or unsafe proposals.',
    location: 'packages/platform-core/src/governance/qa-gate.mjs', status: 'IMPLEMENTED_SIMULATION',
    consumes: ['evidence', 'risk', 'policy result'], produces: ['QA status', 'blocking reasons'], dependencies: ['risk-engine'], consumers: ['decision-engine']
  },
  {
    component_id: 'operations-center', type: 'APP', purpose: 'Private authenticated operational read interface over canonical VPS read models.',
    location: 'apps/api; apps/review-panel', status: 'DEPLOYED_READ_ONLY',
    consumes: ['operations-order-context', 'operations-incident-context', 'operations-order-timeline'], produces: ['authenticated operational views'],
    dependencies: ['postgresql', 'keycloak'], consumers: ['human operators']
  },
  {
    component_id: 'mcp-server', type: 'SERVICE', purpose: 'Private OAuth MCP exposing exactly sixteen masked read/simulation tools.',
    location: 'packages/suleia-operations-mcp', status: 'DEPLOYED_READ_ONLY',
    consumes: ['canonical operational views', 'platform catalog', 'sanitized runtime inventory'], produces: FINAL_MCP_TOOLS,
    dependencies: ['postgresql', 'keycloak'], consumers: ['ChatGPT']
  },
  {
    component_id: 'ingestion-worker', type: 'WORKER', purpose: 'Mirrors real external evidence into the VPS shadow model using read-only connectors.',
    location: 'services/shadow-readonly-worker.mjs', status: 'DEPLOYED_SHADOW_READ_ONLY',
    consumes: ['Dropea V2', 'Chatby', 'legacy operational source'], produces: ['canonical mirror records', 'freshness'],
    dependencies: ['postgresql', 'dropea-v2-connector', 'chatby-connector'], consumers: ['operations-order-context', 'operations-incident-context']
  },
  {
    component_id: 'postgresql', type: 'SERVICE', purpose: 'Private VPS source of truth for canonical events, twins, decisions and read models.',
    location: 'infrastructure/docker/compose.yaml', status: 'DEPLOYED_PRIVATE', consumes: [], produces: ['canonical operational read models'], dependencies: [],
    consumers: ['operations-center', 'mcp-server', 'ingestion-worker']
  },
  {
    component_id: 'keycloak', type: 'SERVICE', purpose: 'OAuth/OIDC authorization for Operations Center and the private MCP.',
    location: 'infrastructure/identity', status: 'DEPLOYED_PRIVATE', consumes: ['OIDC clients and roles'], produces: ['scoped access tokens'], dependencies: ['postgresql'],
    consumers: ['operations-center', 'mcp-server']
  },
  {
    component_id: 'dropea-v2-connector', type: 'CONNECTOR', purpose: 'Explicit-market REST V2 read connector for orders and incidents.',
    location: 'services/integrations/dropea', status: 'READ_ENABLED_WRITE_DISABLED', consumes: ['Dropea V2 REST'], produces: ['canonical order and issue records'],
    dependencies: [], consumers: ['ingestion-worker']
  },
  {
    component_id: 'chatby-connector', type: 'CONNECTOR', purpose: 'Read-only issue-correlated Chatby conversation evidence.',
    location: 'services/integrations/chatby', status: 'READ_ENABLED_WRITE_DISABLED', consumes: ['Chatby API'], produces: ['sanitized conversation links and intent evidence'],
    dependencies: [], consumers: ['ingestion-worker', 'conversation-intelligence']
  },
  {
    component_id: 'operations-order-context', type: 'READ_MODEL', purpose: 'Central order context shared by Operations Center and MCP.',
    location: 'migrations/014_operational_data_model_hardening.sql', status: 'DEPLOYED',
    consumes: ['Dropea order mirror', 'active incident context'], produces: ['masked order context'], dependencies: ['operations-incident-context'],
    consumers: ['operations-center', 'mcp-server'], database_objects: ['read_models.operations_order_context']
  },
  {
    component_id: 'operations-incident-context', type: 'READ_MODEL', purpose: 'Central incident trace joining Dropea, Chatby, intent, timer, policy, risk, QA and simulation.',
    location: 'migrations/014_operational_data_model_hardening.sql', status: 'DEPLOYED',
    consumes: ['Dropea issue mirror', 'Chatby links', 'intent', 'timers', 'simulated decisions'], produces: ['masked incident context'],
    dependencies: ['conversation-intelligence', 'timer-engine', 'decision-engine'], consumers: ['operations-center', 'mcp-server'],
    database_objects: ['read_models.operations_incident_context']
  },
  {
    component_id: 'operations-order-timeline', type: 'READ_MODEL', purpose: 'End-to-end sanitized chronology for one canonical order.',
    location: 'migrations/014_operational_data_model_hardening.sql', status: 'DEPLOYED', consumes: ['events', 'timers', 'intent', 'simulated decisions', 'findings'],
    produces: ['chronological masked events'], dependencies: ['event-store'], consumers: ['operations-center', 'mcp-server'], database_objects: ['read_models.operations_order_timeline']
  },
  {
    component_id: 'reconciliation-findings', type: 'READ_MODEL', purpose: 'Derived identity, freshness, Chatby, GLS and event-order inconsistencies.',
    location: 'migrations/014_operational_data_model_hardening.sql', status: 'DEPLOYED', consumes: ['canonical mirrors and reconciliation ledger'],
    produces: ['operational findings'], dependencies: [], consumers: ['operations-center', 'mcp-server'], database_objects: ['read_models.reconciliation_findings']
  },
  {
    component_id: 'platform-core', type: 'PACKAGE', purpose: 'Deterministic event, twin, incident, policy, timer, risk, QA and protection logic.',
    location: 'packages/platform-core', status: 'IMPLEMENTED_SIMULATION', consumes: ['masked canonical facts'],
    produces: ['deterministic assessments and proposals'], dependencies: [], consumers: ['services', 'tests']
  },
  {
    component_id: 'suleia-operations-mcp', type: 'PACKAGE', purpose: 'Private MCP transport, OAuth, masking, repositories and platform catalog.',
    location: 'packages/suleia-operations-mcp', status: 'DEPLOYED_READ_ONLY', consumes: ['canonical read models'],
    produces: FINAL_MCP_TOOLS, dependencies: ['platform-core'], consumers: ['ChatGPT']
  },
  {
    component_id: 'incident-processor-tests', type: 'TEST', purpose: 'Validates deterministic incident processing and safety invariants.',
    location: 'packages/platform-core/test/incident-processor.test.mjs', status: 'ACTIVE', consumes: ['incident fixtures'],
    produces: ['test evidence'], dependencies: ['incident-processor'], consumers: ['deployment gates']
  },
  {
    component_id: 'mcp-tools-tests', type: 'TEST', purpose: 'Validates the exact sixteen-tool read-only MCP contract.',
    location: 'packages/suleia-operations-mcp/test/mcp-tools.test.mjs', status: 'ACTIVE', consumes: ['masked fixture'],
    produces: ['MCP contract evidence'], dependencies: ['mcp-server'], consumers: ['deployment gates']
  },
  {
    component_id: 'operational-data-model-hardening', type: 'MIGRATION', purpose: 'Creates canonical order, incident, timeline, quality and finding read models.',
    location: 'migrations/014_operational_data_model_hardening.sql', status: 'DEPLOYED_REVERSIBLE', consumes: ['existing canonical mirrors'],
    produces: ['central operational read models'], dependencies: ['postgresql'], consumers: ['operations-center', 'mcp-server']
  },
  {
    component_id: 'platform-audit-readonly', type: 'MIGRATION', purpose: 'Creates the separate strict platform audit database role and removes legacy MCP inserts.',
    location: 'migrations/015_platform_audit_readonly.sql', status: 'REVERSIBLE', consumes: ['existing database roles'],
    produces: ['suleia_platform_audit_readonly'], dependencies: ['postgresql'], consumers: ['mcp-server']
  },
  {
    component_id: 'incident-management-handbook', type: 'DOCUMENT', purpose: 'Canonical incident-management operating and safety handbook.',
    location: 'docs/SULEIA_INCIDENT_MANAGEMENT_HANDBOOK_v1.0.md', status: 'VERSIONED', consumes: [], produces: ['documented operational rules'],
    dependencies: [], consumers: ['human review', 'incident-processor']
  },
  {
    component_id: 'agent-catalog-document', type: 'DOCUMENT', purpose: 'Documents deterministic agent contracts and forbidden operations.',
    location: 'docs/company/AGENT_CATALOG.md', status: 'VERSIONED', consumes: ['organization catalog'], produces: ['agent documentation'],
    dependencies: [], consumers: ['human review']
  }
]);

const BUSINESS_POLICIES = Object.freeze([
  ['confirmation-current-order', 'confirmation', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/governance/temporal-policies.mjs'],
  ['cancellation-current-order', 'cancellation', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/decision-engine.mjs'],
  ['address-incorrect', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['first-absence', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['second-absence', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['refused-goods', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['pending-data', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['possible-return', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['return-requested', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['pickup-agency', 'incident', 'IMPLEMENTED_SIMULATION', 'packages/platform-core/src/incident/gls-policies.mjs'],
  ['discount-workflow', 'commercial-recovery', 'PREPARED_DISABLED', 'packages/platform-core/src/incident/discount-workflow.mjs'],
  ['duplicate-guard', 'operational-protection', 'DETECTION_ACTIVE_BLOCKING_DISABLED', 'packages/platform-core/src/operational-protections/duplicate-guard.mjs'],
  ['test-phone', 'operational-protection', 'BLOCK_ENABLED', 'packages/platform-core/src/operational-protections/identity.mjs'],
  ['chatby-cleanup', 'operational-protection', 'PREVIEW_ONLY_DELETE_DISABLED', 'packages/platform-core/src/operational-protections/chatby-lifecycle.mjs'],
  ['return-to-origin-blocking', 'operational-protection', 'PREVIEW_ONLY_WRITE_DISABLED', 'packages/platform-core/src/operational-protections/releasit-blocklist.mjs']
].map(([policy_id, domain, status, location]) => ({
  policy_id,
  version: 'runtime-catalog-v1',
  domain,
  trigger: 'DETERMINISTIC_CURRENT_ORDER_EVIDENCE',
  inputs: ['canonical current-order facts', 'source freshness'],
  output: 'SIMULATED_PROPOSAL_OR_REVIEW',
  precedence: 'CURRENT_ORDER_AND_SAFETY_BLOCKERS_FIRST',
  exceptions: ['stale evidence', 'identity conflict', 'contradictory sources'],
  timers: [],
  tests: ['packages/platform-core/test'],
  status,
  location
})));

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function loadRuntimeSnapshot(path) {
  try {
    const raw = await fs.readFile(path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 512_000) throw new Error('runtime inventory too large');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function currentProcessMetrics() {
  let disk = null;
  try {
    const stats = statfsSync('/');
    disk = { total_bytes: stats.blocks * stats.bsize, free_bytes: stats.bavail * stats.bsize };
  } catch {}
  return {
    observed_from: 'mcp_container',
    hostname_hash_available: Boolean(os.hostname()),
    cpu_count: os.cpus().length,
    load_average: os.loadavg(),
    memory_total_bytes: os.totalmem(),
    memory_free_bytes: os.freemem(),
    process_uptime_seconds: Math.round(process.uptime()),
    disk
  };
}

function temporalPolicyComponents() {
  return TEMPORAL_POLICIES.map((policy) => ({
    component_id: policy.policy_id,
    type: 'POLICY',
    purpose: policy.name,
    location: 'packages/platform-core/src/governance/temporal-policies.mjs',
    status: policy.status,
    consumes: policy.required_evidence,
    produces: [policy.proposed_action],
    dependencies: [],
    consumers: ['decision-engine'],
    policies: [policy],
    timers: policy.timer_definition ? [policy.timer_definition] : [],
    tests: ['packages/platform-core/test/governance-policy.test.mjs']
  }));
}

function timerComponents() {
  return Object.entries(REQUIRED_TIMER_HOURS).map(([timerType, duration]) => ({
    component_id: timerType,
    type: 'TIMER',
    purpose: `Deterministic ${duration} hour timer contract.`,
    location: 'packages/platform-core/src/governance/temporal-policies.mjs',
    status: timerType.startsWith('LEGACY_') ? 'DEPRECATED_COMPARISON_ONLY' : 'SIMULATION',
    consumes: ['policy trigger', 'canonical event'],
    produces: ['timer status'],
    dependencies: ['timer-engine'],
    consumers: ['decision-engine'],
    timers: [{ timer_type: timerType, duration_hours: duration }],
    tests: ['packages/platform-core/test/governance-policy.test.mjs']
  }));
}

function mcpToolComponents() {
  return FINAL_MCP_TOOLS.map((name) => ({
    component_id: name,
    type: 'MCP_TOOL',
    purpose: 'Private masked read/simulation query.',
    location: 'packages/suleia-operations-mcp/src/mcp/server.mjs',
    status: 'READ_ONLY',
    consumes: ['allowlisted source'],
    produces: ['masked structured result'],
    dependencies: ['mcp-server'],
    consumers: ['ChatGPT']
  }));
}

function allComponents() {
  return [...COMPONENTS, ...temporalPolicyComponents(), ...timerComponents(), ...mcpToolComponents()];
}

function expandDependencies(component, depth, index, seen = new Set()) {
  if (depth <= 0) return [];
  const expanded = [];
  for (const dependency of component.dependencies || []) {
    const key = String(dependency).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const target = index.get(key);
    expanded.push(target
      ? { component_id: target.component_id, type: target.type, status: target.status,
          dependencies: expandDependencies(target, depth - 1, index, seen) }
      : { component_id: dependency, type: 'EXTERNAL_OR_DECLARED', status: 'DECLARED' });
  }
  return expanded;
}

export function createPlatformKnowledge({ repository, config }) {
  const environment = config.environment === 'production' ? 'VPS_SHADOW_READ_ONLY' : config.environment;

  return Object.freeze({
    async getOverview({ section = 'ALL' } = {}) {
      const [snapshot, freshness, databaseSummary] = await Promise.all([
        loadRuntimeSnapshot(config.runtimeInventoryPath),
        repository.getDataFreshness?.().catch(() => null),
        repository.getDatabaseSummary?.().catch(() => null)
      ]);
      const base = {
        deployed_commit: snapshot?.git?.commit || process.env.SULEIA_DEPLOYED_COMMIT || 'UNKNOWN',
        branch: snapshot?.git?.branch || process.env.SULEIA_DEPLOYED_BRANCH || 'UNKNOWN',
        environment,
        architecture_style: SULEIA_OPERATING_SYSTEM.architecture_style,
        layers: SULEIA_OPERATING_SYSTEM.layers,
        services: SERVICE_MANIFEST.map(({ service, platform }) => ({ service, platform })),
        modules: COMPONENTS.filter((item) => item.type === 'MODULE').map((item) => item.component_id),
        event_store: 'event-store',
        digital_twins: 'digital-twin',
        decision_engine: 'decision-engine',
        incident_processor: 'incident-processor',
        operations_center: 'operations-center',
        mcp: { component: 'mcp-server', tools: FINAL_MCP_TOOLS, tool_count: FINAL_MCP_TOOLS.length },
        connectors: COMPONENTS.filter((item) => item.type === 'CONNECTOR').map((item) => ({ id: item.component_id, status: item.status })),
        dependencies: ['PostgreSQL VPS', 'Keycloak/OAuth', 'Dropea V2 read', 'Chatby read', 'Render legacy service', 'Supabase legacy store'],
        read_models: COMPONENTS.filter((item) => item.type === 'READ_MODEL').map((item) => item.component_id),
        database: databaseSummary,
        tests: { count: snapshot?.repository?.test_count ?? null, measured_at: snapshot?.generated_at || null },
        status: 'READ_ONLY_SIMULATION',
        freshness
      };
      if (section === 'AGENTS') {
        return {
          organization: SULEIA_OPERATING_SYSTEM.name,
          agent_count: AGENT_CATALOG.length,
          department_count: DEPARTMENTS.length,
          agents: AGENT_CATALOG.map((agent) => ({
            agent_id: agent.agent_id,
            name: agent.name,
            domain: DEPARTMENTS.find((item) => item.department_id === agent.department_id)?.layer || 'UNKNOWN',
            department_id: agent.department_id,
            status: 'CONTRACT_ONLY',
            active: false,
            simulation: agent.run_mode === 'SIMULATION',
            inputs: agent.inputs,
            outputs: agent.outputs,
            dependencies: ['masked_events', 'order_digital_twin', 'versioned_policy', 'source_freshness'],
            tests: ['packages/platform-core/test/organization.test.mjs']
          }))
        };
      }
      if (section === 'POLICIES') return { policies: [...BUSINESS_POLICIES, ...TEMPORAL_POLICIES] };
      if (section === 'TIMERS') return {
        timers: timerComponents().map((item) => ({
          timer_type: item.component_id,
          duration_hours: item.timers[0].duration_hours,
          trigger: 'POLICY_TRIGGER',
          cancel_conditions: ['explicit cancellation', 'superseding current-order evidence'],
          supersession: 'newer canonical evidence',
          policy: TEMPORAL_POLICIES.find((policy) => policy.timer_definition?.workflow === item.component_id)?.policy_id || null,
          consumer: 'decision-engine',
          status: item.status,
          tests: item.tests
        })),
        conflicts: [{ code: 'LEGACY_36H_VS_CURRENT_TIMERS', status: 'INVENTORIED_HUMAN_REVIEW', auto_modified: false }]
      };
      if (section === 'CONNECTORS') return { connectors: base.connectors, dependencies: base.dependencies };
      if (section === 'READ_MODELS') return { read_models: base.read_models, database: databaseSummary };
      if (section === 'TESTS') return base.tests;
      if (section === 'ARCHITECTURE') {
        const { freshness: ignored, tests: ignoredTests, ...architecture } = base;
        return architecture;
      }
      if (section === 'STATUS') return {
        deployed_commit: base.deployed_commit,
        branch: base.branch,
        environment,
        status: base.status,
        freshness,
        tests: base.tests
      };
      return base;
    },

    async getRuntimeInventory({ platform = null, service = null, container = null,
      status = null, environment: requestedEnvironment = null, limit = 50, offset = 0 } = {}) {
      const [snapshot, database] = await Promise.all([
        loadRuntimeSnapshot(config.runtimeInventoryPath),
        repository.getRuntimeMetrics?.().catch(() => null)
      ]);
      const observed = new Map((snapshot?.containers || []).map((item) => [String(item.service || item.name).toLowerCase(), item]));
      let items = SERVICE_MANIFEST.map((declared) => {
        const live = observed.get(declared.service.toLowerCase()) || {};
        return {
          ...declared,
          version: live.version || null,
          image: live.image || declared.image,
          commit: snapshot?.git?.commit || null,
          status: live.status || declared.declared_status,
          health: live.health || 'UNKNOWN',
          cpu_percent: live.cpu_percent ?? null,
          ram_usage_bytes: live.ram_usage_bytes ?? null,
          ram_limit_bytes: live.ram_limit_bytes ?? null,
          disk: declared.service === 'postgres' ? database?.database_size_bytes ?? null : null,
          ports: live.ports || [],
          restart_policy: live.restart_policy || null,
          last_deploy: snapshot?.generated_at || null,
          last_failure: live.last_failure || null,
          backup_status: declared.service === 'backup' ? snapshot?.backup || { status: 'UNKNOWN' } : null,
          environment
        };
      });
      const matches = (actual, expected) => !expected || String(actual || '').toLowerCase().includes(String(expected).toLowerCase());
      items = items.filter((item) => matches(item.platform, platform)
        && matches(item.service, service)
        && matches(item.container, container)
        && matches(item.status, status)
        && matches(item.environment, requestedEnvironment));
      const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 50));
      const safeOffset = Math.min(100_000, Math.max(0, Number.parseInt(offset, 10) || 0));
      return {
        items: items.slice(safeOffset, safeOffset + safeLimit),
        total: items.length,
        limit: safeLimit,
        offset: safeOffset,
        host: snapshot?.host || currentProcessMetrics(),
        postgres: database,
        snapshot_generated_at: snapshot?.generated_at || null,
        collector_status: snapshot ? 'AVAILABLE' : 'FALLBACK_PROCESS_ONLY'
      };
    },

    async getComponentDetails({ component_type = null, component_id, depth = 1 }) {
      if (['TABLE', 'VIEW'].includes(component_type) && String(component_id).includes('.')) {
        const [schema, objectName] = String(component_id).split('.', 2);
        const catalog = await repository.getDatabaseCatalog({
          platform: 'VPS_POSTGRES', schema, objectType: component_type,
          objectName, limit: 1, offset: 0
        });
        const databaseObject = catalog.items?.find((item) => item.schema_name === schema && item.object_name === objectName);
        if (databaseObject) {
          return {
            component_id,
            type: component_type,
            purpose: 'Authorized PostgreSQL metadata object.',
            location: `VPS_POSTGRES:${component_id}`,
            status: 'DEPLOYED',
            consumes: databaseObject.dependencies || [],
            produces: databaseObject.columns || [],
            dependencies: databaseObject.dependencies || [],
            consumers: [],
            database_objects: [databaseObject],
            tests: [],
            documentation: [],
            deployment: { platform: 'VPS', service: 'postgres' },
            freshness: { status: 'MEASURED', measured_at: catalog.measured_at }
          };
        }
      }
      const components = allComponents();
      const candidate = components.find((item) => String(item.component_id).toLowerCase() === String(component_id).toLowerCase()
        && (!component_type || item.type === component_type));
      if (!candidate) {
        const error = new Error(`Component not found: ${component_id}`);
        error.code = 'COMPONENT_NOT_FOUND';
        throw error;
      }
      const snapshot = await loadRuntimeSnapshot(config.runtimeInventoryPath);
      const file = snapshot?.repository?.files?.find((item) => item.path === candidate.location);
      const index = new Map(components.map((item) => [String(item.component_id).toLowerCase(), item]));
      return {
        ...clone(candidate),
        hash: file?.sha256 || null,
        imports: file?.imports || [],
        exports: file?.exports || [],
        dependency_graph: expandDependencies(candidate, Math.min(5, Math.max(0, depth)), index),
        documentation: candidate.documentation || ['docs/'],
        deployment: SERVICE_MANIFEST.find((item) => item.service === candidate.component_id) || null,
        freshness: snapshot?.generated_at ? { status: 'MEASURED', measured_at: snapshot.generated_at } : { status: 'UNKNOWN', measured_at: null }
      };
    },

    policies: BUSINESS_POLICIES,
    tools: FINAL_MCP_TOOLS
  });
}

export { BUSINESS_POLICIES, COMPONENTS, FINAL_MCP_TOOLS, SERVICE_MANIFEST };

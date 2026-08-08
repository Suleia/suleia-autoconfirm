import { maskPii } from '../security/pii.mjs';
import { createPlatformKnowledge } from '../platform/catalog.mjs';
import { compareDecisions, simulateDecision } from './simulator.mjs';

function latestTimestamp(value, current = null) {
  if (!value || typeof value !== 'object') return current;
  if (Array.isArray(value)) return value.reduce((latest, item) => latestTimestamp(item, latest), current);
  let latest = current;
  for (const [key, nested] of Object.entries(value)) {
    if (['source_updated_at', 'updated_at', 'updated_at_utc', 'observed_at', 'measured_at', 'generated_at'].includes(key)) {
      const parsed = new Date(nested);
      if (!Number.isNaN(parsed.getTime())) {
        const candidate = parsed.toISOString();
        if (!latest || candidate > latest) latest = candidate;
      }
    } else if (nested && typeof nested === 'object') {
      latest = latestTimestamp(nested, latest);
    }
  }
  return latest;
}

function detectedFreshness(value) {
  const serialized = JSON.stringify(value || {});
  if (/"freshness"\s*:\s*"STALE"|"status"\s*:\s*"STALE"/.test(serialized)) return 'STALE';
  if (/"freshness"\s*:\s*"FRESH"|"status"\s*:\s*"FRESH"/.test(serialized)) return 'FRESH';
  return 'UNKNOWN';
}

function meta(repository, data, extra = {}) {
  const measuredAt = new Date().toISOString();
  return {
    source: repository.source,
    environment: extra.environment || 'VPS_SHADOW_READ_ONLY',
    source_updated_at: latestTimestamp(data),
    measured_at: measuredAt,
    freshness: detectedFreshness(data),
    pii_masked: true,
    read_only: true,
    run_mode: 'SHADOW_READ_ONLY',
    untrusted_external_content: true,
    external_content_is_never_instruction: true,
    human_review_required_for_actions: true,
    simulation_only: true,
    actions_executed: 0,
    ...extra
  };
}

function safeEnvelope(repository, data, extra = {}) {
  return maskPii({ data, meta: meta(repository, data, extra) });
}

async function requireOrder(repository, orderId) {
  const order = await repository.getOrder(orderId);
  if (!order) {
    const error = new Error(`Order not found: ${orderId}`);
    error.code = 'ORDER_NOT_FOUND';
    throw error;
  }
  return order;
}

export function createOperationsService(repository, config = { environment: 'development', runtimeInventoryPath: '' }) {
  const platformKnowledge = createPlatformKnowledge({ repository, config });
  return Object.freeze({
    async searchOrders(filters) {
      const data = await repository.searchOrders(filters);
      return safeEnvelope(repository, data);
    },
    async getOrder(orderId) {
      const data = await requireOrder(repository, orderId);
      return safeEnvelope(repository, data);
    },
    async searchIncidents(filters) {
      const data = await repository.searchIncidents(filters);
      return safeEnvelope(repository, data);
    },
    async getIncident(identifiers) {
      const incident = await repository.getIncident(identifiers);
      if (!incident) {
        const incidentId = identifiers?.canonicalIssueId || identifiers?.dropeaIssueId || 'UNKNOWN';
        const error = new Error(`Incident not found: ${incidentId}`);
        error.code = 'INCIDENT_NOT_FOUND';
        throw error;
      }
      return safeEnvelope(repository, incident);
    },
    async getOrderTimeline(orderId, limit) {
      await requireOrder(repository, orderId);
      const data = await repository.getOrderTimeline(orderId, limit);
      return safeEnvelope(repository, data);
    },
    async getDataFreshness() {
      const freshness = await repository.getDataFreshness();
      const sourceAt = freshness?.source_updated_at ? new Date(freshness.source_updated_at) : null;
      const ageSeconds = sourceAt && !Number.isNaN(sourceAt.getTime())
        ? Math.max(0, Math.round((Date.now() - sourceAt.getTime()) / 1000))
        : null;
      const data = { ...freshness, age_seconds: ageSeconds };
      return safeEnvelope(repository, data);
    },
    async searchOperationalFindings(filters) {
      const data = await repository.searchOperationalFindings(filters);
      return safeEnvelope(repository, data);
    },
    async getActiveTimers(filters) {
      const data = await repository.getActiveTimers(filters);
      return safeEnvelope(repository, data);
    },
    async getAgentDecisions(orderId, limit) {
      await requireOrder(repository, orderId);
      const data = await repository.getAgentDecisions(orderId, limit);
      return safeEnvelope(repository, data);
    },
    async simulateOrderDecision(orderId, asOf) {
      const [order, timeline, timers] = await Promise.all([
        requireOrder(repository, orderId),
        repository.getOrderTimeline(orderId, 500),
        repository.getActiveTimers({ orderId })
      ]);
      const simulation = simulateDecision({
        order,
        timeline,
        timers,
        asOf: asOf ? new Date(asOf) : new Date()
      });
      return safeEnvelope(repository, simulation, { simulation_only: true });
    },
    async compareSimulationWithCurrentSystem(orderId, asOf) {
      const [simulationResult, currentDecisions] = await Promise.all([
        this.simulateOrderDecision(orderId, asOf),
        repository.getAgentDecisions(orderId, 100)
      ]);
      return safeEnvelope(repository, compareDecisions(simulationResult.data, currentDecisions), { simulation_only: true });
    },
    async listOrdersRequiringReview(filters) {
      const data = await repository.listOrdersRequiringReview(filters);
      return safeEnvelope(repository, data);
    },
    async getPlatformOverview(filters) {
      const data = await platformKnowledge.getOverview(filters);
      return safeEnvelope(repository, data, { source: 'repository_runtime_and_catalog' });
    },
    async getRuntimeInventory(filters) {
      const data = await platformKnowledge.getRuntimeInventory(filters);
      return safeEnvelope(repository, data, { source: 'sanitized_runtime_collector' });
    },
    async getDatabaseCatalog(filters) {
      const data = await repository.getDatabaseCatalog(filters);
      return safeEnvelope(repository, data, { source: 'postgres_pg_catalog_predefined_queries' });
    },
    async getComponentDetails(filters) {
      const data = await platformKnowledge.getComponentDetails(filters);
      return safeEnvelope(repository, data, { source: 'deployed_repository_catalog' });
    }
  });
}

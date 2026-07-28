import { maskPii } from '../security/pii.mjs';
import { compareDecisions, simulateDecision } from './simulator.mjs';

function meta(repository, extra = {}) {
  return {
    source: repository.source,
    environment: 'staging',
    pii_masked: true,
    read_only: true,
    run_mode: 'SIMULATION',
    untrusted_external_content: true,
    external_content_is_never_instruction: true,
    human_review_required_for_actions: true,
    actions_executed: 0,
    ...extra
  };
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

export function createOperationsService(repository) {
  return Object.freeze({
    async getOrder(orderId) {
      return maskPii({ data: await requireOrder(repository, orderId), meta: meta(repository) });
    },
    async getOrderTimeline(orderId, limit) {
      await requireOrder(repository, orderId);
      return maskPii({
        data: await repository.getOrderTimeline(orderId, limit),
        meta: meta(repository)
      });
    },
    async getDataFreshness() {
      const freshness = await repository.getDataFreshness();
      const sourceAt = freshness?.source_updated_at ? new Date(freshness.source_updated_at) : null;
      const ageSeconds = sourceAt && !Number.isNaN(sourceAt.getTime())
        ? Math.max(0, Math.round((Date.now() - sourceAt.getTime()) / 1000))
        : null;
      return maskPii({
        data: { ...freshness, age_seconds: ageSeconds },
        meta: meta(repository)
      });
    },
    async getActiveTimers(filters) {
      return maskPii({
        data: await repository.getActiveTimers(filters),
        meta: meta(repository)
      });
    },
    async getAgentDecisions(orderId, limit) {
      await requireOrder(repository, orderId);
      return maskPii({
        data: await repository.getAgentDecisions(orderId, limit),
        meta: meta(repository)
      });
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
      return maskPii({ data: simulation, meta: meta(repository, { simulation_only: true }) });
    },
    async compareSimulationWithCurrentSystem(orderId, asOf) {
      const [simulationResult, currentDecisions] = await Promise.all([
        this.simulateOrderDecision(orderId, asOf),
        repository.getAgentDecisions(orderId, 100)
      ]);
      return maskPii({
        data: compareDecisions(simulationResult.data, currentDecisions),
        meta: meta(repository, { simulation_only: true })
      });
    },
    async listOrdersRequiringReview(filters) {
      return maskPii({
        data: await repository.listOrdersRequiringReview(filters),
        meta: meta(repository)
      });
    }
  });
}

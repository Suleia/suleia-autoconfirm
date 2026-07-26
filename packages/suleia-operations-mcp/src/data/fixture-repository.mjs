import fs from 'node:fs';

function isoFromOffset(anchor, minutes) {
  return new Date(anchor.getTime() + (Number(minutes) || 0) * 60_000).toISOString();
}

function materializeFixture(fixture, anchor = new Date()) {
  const order = {
    ...fixture.order,
    created_at: isoFromOffset(anchor, fixture.order.created_offset_minutes),
    source_updated_at: isoFromOffset(anchor, fixture.order.source_updated_offset_minutes)
  };
  delete order.created_offset_minutes;
  delete order.source_updated_offset_minutes;

  return {
    order,
    timeline: fixture.timeline.map((event) => ({
      ...event,
      occurred_at: isoFromOffset(anchor, event.offset_minutes)
    })).map(({ offset_minutes, ...event }) => event),
    timers: fixture.timers.map((timer) => ({
      ...timer,
      order_id: order.order_id,
      started_at: isoFromOffset(anchor, timer.started_offset_minutes),
      due_at: isoFromOffset(anchor, timer.due_offset_minutes)
    })).map(({ started_offset_minutes, due_offset_minutes, ...timer }) => timer),
    agentDecisions: fixture.agent_decisions.map((decision) => ({
      ...decision,
      order_id: order.order_id,
      decided_at: isoFromOffset(anchor, decision.offset_minutes)
    })).map(({ offset_minutes, ...decision }) => decision)
  };
}

export function createFixtureRepository(config, { anchor = new Date() } = {}) {
  const fixture = JSON.parse(fs.readFileSync(config.fixturePath, 'utf8'));
  const data = materializeFixture(fixture, anchor);

  return Object.freeze({
    source: 'masked_fixture',
    async getOrder(orderId) {
      return data.order.order_id === orderId ? structuredClone(data.order) : null;
    },
    async getOrderTimeline(orderId, limit = 100) {
      if (data.order.order_id !== orderId) return [];
      return structuredClone(data.timeline.slice(0, limit));
    },
    async getDataFreshness() {
      return {
        source: 'masked_fixture',
        source_updated_at: data.order.source_updated_at,
        measured_at: new Date().toISOString()
      };
    },
    async getActiveTimers({ orderId = null, timerType = null } = {}) {
      return structuredClone(data.timers.filter((timer) => {
        if (orderId && timer.order_id !== orderId) return false;
        if (timerType && timer.timer_type !== timerType) return false;
        return timer.status === 'ACTIVE';
      }));
    },
    async getAgentDecisions(orderId, limit = 100) {
      if (data.order.order_id !== orderId) return [];
      return structuredClone(data.agentDecisions.slice(0, limit));
    },
    async listOrdersRequiringReview({ limit = 100, reason = null } = {}) {
      if (!data.order.requires_review) return [];
      if (reason && data.order.review_reason !== reason) return [];
      return [structuredClone(data.order)].slice(0, limit);
    }
  });
}

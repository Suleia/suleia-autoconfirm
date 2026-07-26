const VIEW_ALLOWLIST = Object.freeze({
  order: 'mcp_orders',
  timeline: 'mcp_order_timeline',
  freshness: 'mcp_data_freshness',
  timers: 'mcp_active_timers',
  decisions: 'mcp_agent_decisions',
  review: 'mcp_orders_requiring_review'
});

function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function cleanError(value, config) {
  return String(value || '')
    .replaceAll(config.supabaseReaderToken, '[redacted]')
    .replaceAll(config.supabaseUrl, '[staging]');
}

export function createSupabaseReadRepository(config, { fetchImpl = fetch } = {}) {
  async function select(viewKey, query = {}) {
    const view = VIEW_ALLOWLIST[viewKey];
    if (!view) throw new Error(`View is not allowlisted: ${viewKey}`);
    const url = `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${view}?${queryString(query)}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        apikey: config.supabaseReaderToken,
        Authorization: `Bearer ${config.supabaseReaderToken}`,
        Accept: 'application/json',
        'Accept-Profile': config.supabaseSchema
      }
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : [];
    if (!response.ok) {
      throw new Error(`Staging read failed ${response.status}: ${cleanError(text, config)}`);
    }
    return Array.isArray(payload) ? payload : [];
  }

  return Object.freeze({
    source: 'supabase_staging_readonly',
    async getOrder(orderId) {
      return (await select('order', { order_id: `eq.${orderId}`, limit: 1 }))[0] || null;
    },
    async getOrderTimeline(orderId, limit = 100) {
      return select('timeline', {
        order_id: `eq.${orderId}`,
        order: 'occurred_at.asc',
        limit
      });
    },
    async getDataFreshness() {
      return (await select('freshness', { limit: 1 }))[0] || null;
    },
    async getActiveTimers({ orderId = null, timerType = null } = {}) {
      return select('timers', {
        order_id: orderId ? `eq.${orderId}` : null,
        timer_type: timerType ? `eq.${timerType}` : null,
        status: 'eq.ACTIVE',
        order: 'due_at.asc',
        limit: 100
      });
    },
    async getAgentDecisions(orderId, limit = 100) {
      return select('decisions', {
        order_id: `eq.${orderId}`,
        order: 'decided_at.desc',
        limit
      });
    },
    async listOrdersRequiringReview({ limit = 100, reason = null } = {}) {
      return select('review', {
        review_reason: reason ? `eq.${reason}` : null,
        order: 'created_at.asc',
        limit
      });
    }
  });
}

export { VIEW_ALLOWLIST };

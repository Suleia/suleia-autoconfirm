export class ApiError extends Error {
  constructor(service, status, code, retryAfter = 0) {
    super(`${service}_HTTP_${status}_CODE_${code || 'UNKNOWN'}`);
    this.service = service; this.status = status; this.retryAfter = retryAfter;
  }
}

export function createApis(config, fetchImpl = fetch) {
  async function request(service, url, options, timeout = 20000) {
    let response;
    try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new ApiError(service, 0, 'NETWORK_OR_TIMEOUT'); }
    let data;
    try { data = await response.json(); } catch { throw new ApiError(service, response.status, 'INVALID_JSON'); }
    if (!response.ok || data?.error || data?.ok === false) {
      throw new ApiError(service, response.status, data?.error?.code || data?.error_code, Number(data?.parameters?.retry_after || response.headers.get('retry-after') || 0));
    }
    return data;
  }
  async function telegram(method, body = {}) {
    const data = await request('TELEGRAM', `https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }, method === 'getUpdates' ? 40000 : 20000);
    return data.result;
  }
  async function graph(resource, params = {}, method = 'GET') {
    const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${resource}`);
    const headers = { Authorization: `Bearer ${config.metaToken}` };
    const options = { method, headers };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(params).toString();
    }
    return request('META', url, options);
  }
  async function pages(resource, params) {
    const rows = []; const seen = new Set();
    let after;
    for (let page = 0; page < 100; page += 1) {
      const data = await graph(resource, { ...params, ...(after ? { after } : {}) });
      if (!Array.isArray(data.data)) throw new Error('META_ROWS_INVALID');
      rows.push(...data.data);
      if (!data.paging?.next) return rows;
      after = data.paging?.cursors?.after;
      if (!after || seen.has(after)) throw new Error('META_PAGINATION_INCOMPLETE');
      seen.add(after);
    }
    throw new Error('META_PAGINATION_LIMIT');
  }
  const campaignFields = 'id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget';
  return {
    telegram,
    account: () => graph(config.accountId, { fields: 'id,name,currency,timezone_name,account_status' }),
    campaigns: () => pages(`${config.accountId}/campaigns`, { fields: campaignFields, limit: 100 }),
    campaign: (id) => { if (!/^\d+$/.test(id)) throw new Error('CAMPAIGN_ID_INVALID'); return graph(id, { fields: campaignFields }); },
    insights: (since, until) => pages(`${config.accountId}/insights`, {
      level: 'campaign', time_range: { since, until }, limit: 100,
      use_account_attribution_setting: true,
      fields: 'campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas'
    }),
    // Never retry a mutation: an interrupted response may already have applied.
    mutate: (id, changes) => {
      if (config.writesEnabled !== true) throw new Error('META_WRITES_DISABLED');
      if (!/^\d+$/.test(id)) throw new Error('CAMPAIGN_ID_INVALID');
      return graph(id, changes, 'POST');
    },
    async send(chatId, text, replyMarkup) {
      const chunks = String(text).match(/[\s\S]{1,3500}/gu) || ['Sin datos.'];
      for (let i = 0; i < chunks.length; i += 1) await telegram('sendMessage', {
        chat_id: chatId, text: chunks[i], disable_web_page_preview: true,
        ...(replyMarkup && i === chunks.length - 1 ? { reply_markup: replyMarkup } : {})
      });
    }
  };
}

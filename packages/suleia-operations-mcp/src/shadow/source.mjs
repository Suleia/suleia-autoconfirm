export const SHADOW_TABLES = Object.freeze([
  ['app_state', 'updated_at', 'TRANSFORM'], ['orders', 'updated_at', 'TRANSFORM'],
  ['operational_orders', 'updated_at', 'TRANSFORM'], ['incidents', 'updated_at', 'TRANSFORM'],
  ['incident_carrier_history', 'synced_at', 'TRANSFORM'], ['agent_feedback', 'created_at', 'TRANSFORM'],
  ['agent_memory_events', 'created_at', 'TRANSFORM'], ['telegram_messages', 'created_at', 'MANUAL_REVIEW'],
  ['webhook_events', 'created_at', 'TRANSFORM'], ['template_delivery_ledger', 'updated_at', 'TRANSFORM'],
  ['meta_campaign_insights', 'updated_at', 'TRANSFORM']
]);

export class SupabaseReadSource {
  constructor({ sourceUrl, sourceToken, fetchImpl = globalThis.fetch }) {
    this.sourceUrl = sourceUrl; this.sourceToken = sourceToken; this.fetchImpl = fetchImpl;
  }

  async readGlsPickupNotice() {
    const query=new URLSearchParams({select:'value,updated_at',key:'eq.gls_pickup_notice_v1',limit:'2'});
    const response=await this.fetchImpl(`${this.sourceUrl}/rest/v1/app_state?${query}`,{method:'GET',redirect:'error',headers:{apikey:this.sourceToken,Authorization:`Bearer ${this.sourceToken}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('GLS_PICKUP_OBSERVATION_SOURCE_UNAVAILABLE');
    const rows=await response.json();if(!Array.isArray(rows)||rows.length>1)throw Error('GLS_PICKUP_OBSERVATION_SOURCE_AMBIGUOUS');return rows[0]?.value||null;
  }

  async readGlsPickupIncidentRows(cases) {
    if(!Array.isArray(cases)||cases.length>100||cases.some(c=>!/^\d{1,20}$/.test(String(c.issue_id))||!/^\d{1,20}$/.test(String(c.order_id))))throw Error('GLS_PICKUP_EXACT_IDENTITIES_REQUIRED');
    if(!cases.length)return [];
    const ids=[...new Set(cases.map(c=>String(c.issue_id)))];
    const query=new URLSearchParams({select:'incidence_id,order_id,raw,updated_at',incidence_id:`in.(${ids.join(',')})`,limit:String(ids.length)});
    const response=await this.fetchImpl(`${this.sourceUrl}/rest/v1/incidents?${query}`,{method:'GET',redirect:'error',headers:{apikey:this.sourceToken,Authorization:`Bearer ${this.sourceToken}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('GLS_PICKUP_EXACT_ROWS_UNAVAILABLE');
    const rows=await response.json();if(!Array.isArray(rows)||rows.length>ids.length)throw Error('GLS_PICKUP_EXACT_ROWS_AMBIGUOUS');
    return rows.filter(row=>cases.some(c=>String(c.issue_id)===String(row.incidence_id)&&String(c.order_id)===String(row.order_id)));
  }

  async page(table, timestampField, { after = null, offset = 0, limit = 250 } = {}) {
    const query = new URLSearchParams({ select: '*', order: `${timestampField}.asc`, limit: String(limit), offset: String(offset) });
    if (after) query.set(timestampField, `gt.${after}`);
    const response = await this.fetchImpl(`${this.sourceUrl}/rest/v1/${table}?${query}`, {
      method: 'GET', redirect: 'error', headers: {
        apikey: this.sourceToken, Authorization: `Bearer ${this.sourceToken}`,
        Accept: 'application/json', Prefer: 'count=exact'
      }
    });
    if (response.status === 404) return { rows: [], total: 0, missing: true };
    if (!response.ok) throw new Error(`Supabase shadow read failed for ${table}: HTTP ${response.status}`);
    const rows = await response.json();
    const range = response.headers.get('content-range') || `0-${rows.length}/${rows.length}`;
    const total = Number(range.split('/').at(-1));
    return { rows, total: Number.isFinite(total) ? total : rows.length, missing: false };
  }
}

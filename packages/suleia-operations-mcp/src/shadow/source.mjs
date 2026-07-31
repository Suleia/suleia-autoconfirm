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

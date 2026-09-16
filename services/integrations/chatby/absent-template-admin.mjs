import { absentTemplatePayload, validateAbsentTemplate, absentHash, ABSENT_BUTTONS, ABSENT_LIVE_FLAGS } from '../../../packages/platform-core/src/incident/absent-template.mjs';

function components(row) {
  if (typeof row.components === 'string') { try { return JSON.parse(row.components); } catch { return []; } }
  return Array.isArray(row.components) ? row.components : [];
}
function sameTemplate(row, payload) {
  const parts = components(row);
  return row.language === payload.language && parts.find(c=>c.type==='BODY')?.text === payload.components[0].text
    && JSON.stringify(parts.find(c=>c.type==='BUTTONS')?.buttons) === JSON.stringify(payload.components[1].buttons);
}
export async function prepareAbsentTemplateApproval({ token, baseUrl = 'https://app.chatby.io/api', fetchImpl = fetch, submit = false }) {
  if (!token) throw new Error('CHATBY_ADMIN_CREDENTIAL_NOT_CONFIGURED');
  const base = new URL(baseUrl);
  if (base.origin !== 'https://app.chatby.io' || base.pathname.replace(/\/$/,'') !== '/api') throw new Error('CHATBY_ADMIN_ORIGIN_NOT_ALLOWED');
  const request = async (path, body) => {
    const response = await fetchImpl(`${base.href.replace(/\/$/,'')}${path}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`CHATBY_TEMPLATE_ADMIN_HTTP_${response.status}`);
    const data = await response.json();
    if (data.status === 'error') throw new Error('CHATBY_TEMPLATE_ADMIN_REJECTED');
    return data;
  };
  const list = async () => {
    const rows = [];
    for (let page=1;page<=20;page++) {
      const data = await request(`/whatsapp-template/list?name=dropea_ausente&limit=100&page=${page}`, {});
      if (!Array.isArray(data.data)) throw new Error('CHATBY_TEMPLATE_CATALOG_INVALID');
      rows.push(...data.data);
      const last = Number(data.meta?.last_page || 0);
      if (last ? page>=last : data.data.length<100) return rows;
    }
    throw new Error('CHATBY_TEMPLATE_CATALOG_INCOMPLETE');
  };
  let rows = await list();
  let payload = absentTemplatePayload();
  let selected = rows.find(r=>r.name===payload.name && sameTemplate(r,payload));
  const conflict = rows.find(r=>r.name===payload.name && r.language===payload.language && !sameTemplate(r,payload));
  if (conflict && !selected) {
    if (!components(conflict).length) throw new Error('CHATBY_TEMPLATE_CONFLICT_CONTENT_UNVERIFIABLE');
    payload = absentTemplatePayload('dropea_ausente_v2');
    selected = rows.find(r=>r.name===payload.name && sameTemplate(r,payload));
    if (rows.some(r=>r.name===payload.name && r.language===payload.language && !sameTemplate(r,payload))) throw new Error('CHATBY_TEMPLATE_SAFE_VERSION_CONFLICT');
  }
  let created = false;
  if (!selected && submit) {
    // Exactly one non-retried administrative creation. An uncertain response is
    // reconciled with the catalogue on a subsequent invocation, never resent.
    await request('/whatsapp-template/create', payload);
    created = true;
    rows = await list();
    selected = rows.find(r=>r.name===payload.name && sameTemplate(r,payload));
    if (!selected) throw new Error('CHATBY_TEMPLATE_SUBMISSION_UNVERIFIED_CHECK_CATALOG_ONLY');
  }
  const validation = validateAbsentTemplate(payload);
  return { template_name: payload.name, chatby_template_id: selected?.id || null,
    meta_template_id: selected?.wa_template_id || null, language: payload.language,
    category_requested: 'UTILITY', category_final: selected?.category || null,
    approval_status: selected?.status || 'DRAFT', rejection_reason: selected?.rejected_reason || null,
    submitted_at: selected?.created_at || null, created, reused: Boolean(selected) && !created,
    content_roundtrip_verified: Boolean(selected && sameTemplate(selected,payload)), ...validation,
    button_mapping_hash: absentHash(ABSENT_BUTTONS), live_flags: ABSENT_LIVE_FLAGS,
    customer_messages_sent: 0, dropea_writes: 0, gls_writes: 0, production_resolutions: 0 };
}

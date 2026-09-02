const RESPONSE_STATUSES = new Set([
  'DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED', 'OTHER_RESPONSE',
  'NO_RESPONSE', 'NOT_SENT', 'NOT_VERIFIABLE'
]);

function rawPayload(row = {}) {
  if (row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)) return row.raw;
  if (typeof row.raw === 'string') {
    try {
      const parsed = JSON.parse(row.raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return {};
}

function iso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function amount(value, { maximum = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum
    ? Number(parsed.toFixed(2)) : null;
}

function reference(value) { return String(value || '').trim().replace(/^#/, ''); }

export function normalizeRenderIncidentDiscountSignal(row = {}) {
  const raw = rawPayload(row);
  const dropeaIssueId = reference(row.incidence_id);
  const dropeaOrderId = reference(row.order_id);
  if (!dropeaIssueId || !dropeaOrderId
    || reference(raw.incidenceId) !== dropeaIssueId
    || reference(raw.orderId) !== dropeaOrderId
    || String(raw.incidentType || '').trim().toLowerCase() !== 'rejected_goods') return null;

  const discountSentAt = iso(raw.incidentDiscountSentAt);
  const respondedAt = iso(raw.incidentDiscountRespondedAt);
  const deliveryVerified = raw.incidentDiscountVerified === true && Boolean(discountSentAt);
  let responseStatus = String(raw.incidentDiscountResponseStatus || 'NOT_SENT').trim().toUpperCase();
  if (!RESPONSE_STATUSES.has(responseStatus)) responseStatus = 'NOT_VERIFIABLE';
  const requiresReplyEvidence = ['DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED', 'OTHER_RESPONSE'].includes(responseStatus);
  if ((requiresReplyEvidence && (!deliveryVerified || !respondedAt
      || Date.parse(respondedAt) <= Date.parse(discountSentAt)))
      || (responseStatus === 'NO_RESPONSE' && !deliveryVerified)) responseStatus = 'NOT_VERIFIABLE';
  if (responseStatus === 'NOT_SENT' && deliveryVerified) responseStatus = 'NOT_VERIFIABLE';

  const sourceUpdatedAt = iso(row.updated_at);
  if (!sourceUpdatedAt) return null;
  const discountAmount = amount(raw.incidentDiscountAmountEur, { maximum: 5 });
  return Object.freeze({
    dropea_issue_id: dropeaIssueId,
    dropea_order_id: dropeaOrderId,
    incident_type: 'REJECTED_GOODS',
    recovery_status: String(raw.incidentDiscountRecoveryStatus || 'unknown').trim().toUpperCase().slice(0, 80),
    response_status: responseStatus,
    initial_template_sent_at: iso(raw.incidentDiscountInitialTemplateSentAt),
    discount_due_at: iso(raw.incidentDiscountDueAt),
    discount_sent_at: discountSentAt,
    responded_at: requiresReplyEvidence && responseStatus !== 'NOT_VERIFIABLE' ? respondedAt : null,
    delivery_verified: deliveryVerified,
    cross_source_verified: raw.incidentDiscountCrossSourceVerified === true,
    original_amount: amount(raw.incidentDiscountOriginalPrice),
    discount_amount: discountAmount,
    final_amount: amount(raw.incidentDiscountFinalPrice),
    signal_quality: responseStatus === 'NOT_VERIFIABLE' ? 'NOT_VERIFIABLE' : 'VERIFIED',
    source_updated_at: sourceUpdatedAt,
    actions_executed: 0,
    production_writes: 0
  });
}

export async function syncRenderIncidentDiscountSignals({
  source, projector, pageSize = 250, maxPages = 20
}) {
  let offset = 0;
  let seen = 0;
  let eligible = 0;
  let projected = 0;
  let unmatched = 0;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await source.page('incidents', 'updated_at', { offset, limit: pageSize });
    if (page.missing || !page.rows.length) break;
    for (const row of page.rows) {
      seen += 1;
      const signal = normalizeRenderIncidentDiscountSignal(row);
      if (!signal) continue;
      eligible += 1;
      const result = await projector.upsertIncidentDiscountRecoverySignal(signal);
      if (result?.matched) projected += 1;
      else unmatched += 1;
    }
    offset += page.rows.length;
    if (page.rows.length < pageSize) break;
  }
  return Object.freeze({
    ok: true, seen, eligible, projected, unmatched,
    actions_executed: 0, production_writes: 0
  });
}

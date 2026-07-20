const SPANISH_DATE_TIME = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function isoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const spanish = raw.match(SPANISH_DATE_TIME);
  if (spanish) {
    const [, day, month, year, hour, minute, second = '00'] = spanish;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function timestamp(value) {
  const parsed = isoDate(value);
  if (!parsed) return 0;
  const time = new Date(parsed).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function unresolved(value) {
  if (value === false || value === 0 || value === '0') return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['false', 'pending', 'pendiente', 'open', 'abierta', 'unresolved'].includes(normalized);
}

function normalizeAction(action = {}) {
  const annotatedAt = action.D_FEC_HORA_ALTA || action.created_at || action.createdAt || null;
  return {
    id: textOrNull(action.I_ID || action.id),
    annotatedAt: isoDate(annotatedAt),
    annotatedAtRaw: textOrNull(annotatedAt),
    reason: textOrNull(action.V_DES_TIPO_ACTU || action.description || action.reason),
    observation: textOrNull(action.T_OBS || action.observation || action.notes),
    raw: action
  };
}

export function normalizeDropeaCarrierIncident(incident = {}) {
  const annotatedAt = incident.D_FEC_HORA_ALTA
    || incident.created_at
    || incident.createdAt
    || incident.date
    || null;
  const actions = (Array.isArray(incident.ACT) ? incident.ACT : [])
    .map(normalizeAction)
    .sort((left, right) => timestamp(left.annotatedAt) - timestamp(right.annotatedAt));
  const latestAction = actions[actions.length - 1] || null;
  return {
    incidenceId: textOrNull(incident.I_ID || incident.id || incident.incidence_id),
    reasonCode: textOrNull(incident.V_COD_TIPO_INC || incident.incidence_code || incident.code),
    reason: textOrNull(incident.V_DES_TIPO_INC || incident.reason || incident.description)
      || textOrNull(incident.V_COD_TIPO_INC || incident.incidence_code || incident.code),
    annotatedAt: isoDate(annotatedAt),
    annotatedAtRaw: textOrNull(annotatedAt),
    observation: textOrNull(incident.T_OBS || incident.observation || incident.notes || incident.comments),
    resolved: !unresolved(incident.B_RESUELTA ?? incident.resolved ?? incident.status),
    lastUpdatedAt: latestAction?.annotatedAt || isoDate(incident.updated_at || incident.updatedAt) || isoDate(annotatedAt),
    actions,
    raw: incident
  };
}

export function parseDropeaCarrierHistory(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload?.incidences || payload?.data?.incidences || payload?.data || [];
  return (Array.isArray(source) ? source : [])
    .map(normalizeDropeaCarrierIncident)
    .filter((incident) => incident.incidenceId || incident.reason || incident.annotatedAt)
    .sort((left, right) => {
      const dateDiff = timestamp(left.annotatedAt) - timestamp(right.annotatedAt);
      if (dateDiff) return dateDiff;
      return Number(left.incidenceId || 0) - Number(right.incidenceId || 0);
    });
}

export function selectCurrentDropeaCarrierIncident(history = [], activeIncidenceId = null) {
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) return null;
  if (activeIncidenceId !== null && activeIncidenceId !== undefined) {
    const exact = rows.find((row) => String(row.incidenceId) === String(activeIncidenceId));
    if (exact) return exact;
  }
  const pending = rows.filter((row) => row.resolved === false);
  return (pending.length ? pending : rows)[(pending.length ? pending : rows).length - 1] || null;
}

export function carrierIncidentDisplay(incident) {
  if (!incident) return null;
  return {
    incidenceId: incident.incidenceId || null,
    reasonCode: incident.reasonCode || null,
    reason: incident.reason || null,
    annotatedAt: incident.annotatedAt || null,
    annotatedAtRaw: incident.annotatedAtRaw || null,
    observation: incident.observation || null,
    lastUpdatedAt: incident.lastUpdatedAt || incident.annotatedAt || null,
    source: 'Dropea REST incidences-history'
  };
}

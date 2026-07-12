import { getAppConfig } from '../config.mjs';

const config = getAppConfig();

function baseUrl() {
  return String(config.supabaseUrl || '').replace(/\/+$/, '');
}

function serviceKey() {
  return config.supabaseServiceRoleKey || '';
}

function schemaName() {
  return config.supabaseSchema || 'public';
}

export function isSupabaseEnabled() {
  return Boolean(config.supabaseEnabled && baseUrl() && serviceKey());
}

export function supabaseStatus() {
  return {
    enabled: Boolean(config.supabaseEnabled),
    configured: isSupabaseEnabled(),
    urlConfigured: Boolean(baseUrl()),
    serviceRoleConfigured: Boolean(serviceKey()),
    schema: schemaName()
  };
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function headers(extra = {}) {
  const schema = schemaName();
  return {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    'Content-Type': 'application/json',
    'Accept-Profile': schema,
    'Content-Profile': schema,
    ...extra
  };
}

function cleanErrorMessage(message) {
  return String(message || '')
    .replaceAll(serviceKey(), '[redacted]')
    .replaceAll(baseUrl(), '[supabase]');
}

export async function supabaseRequest(path, { method = 'GET', query = {}, body, headers: extraHeaders = {} } = {}) {
  if (!isSupabaseEnabled()) {
    return { skipped: true, reason: 'supabase_not_configured' };
  }

  const url = `${baseUrl()}${path}${queryString(query)}`;
  const response = await fetch(url, {
    method,
    headers: headers(extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`Supabase ${method} ${path} failed ${response.status}: ${cleanErrorMessage(detail)}`);
  }

  return payload;
}

export async function selectRows(table, { query = {}, limit = 1000 } = {}) {
  const payload = await supabaseRequest(`/rest/v1/${encodeURIComponent(table)}`, {
    query: { select: '*', limit, ...query }
  });
  return Array.isArray(payload) ? payload : [];
}

export async function upsertRows(table, rows, { onConflict, returning = 'minimal' } = {}) {
  const cleanRows = Array.isArray(rows) ? rows.filter(Boolean) : [rows].filter(Boolean);
  if (!cleanRows.length) return { skipped: true, reason: 'empty_rows' };
  return supabaseRequest(`/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    query: onConflict ? { on_conflict: onConflict } : {},
    body: cleanRows,
    headers: {
      Prefer: `resolution=merge-duplicates,return=${returning}`
    }
  });
}

export async function insertRows(table, rows, { returning = 'minimal' } = {}) {
  const cleanRows = Array.isArray(rows) ? rows.filter(Boolean) : [rows].filter(Boolean);
  if (!cleanRows.length) return { skipped: true, reason: 'empty_rows' };
  return supabaseRequest(`/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    body: cleanRows,
    headers: {
      Prefer: `return=${returning}`
    }
  });
}

export async function callRpc(name, payload = {}) {
  return supabaseRequest(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: payload
  });
}

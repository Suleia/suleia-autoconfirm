import crypto from 'node:crypto';

const TARGET_TEMPLATES = [
  'dropea_pedido_nuevo_v1',
  'dropea_pedido_preparado_v1',
  'dropea_incidencia_mercancia_v1'
];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function templateSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[a-z]{2}_[a-z]{2}\s+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findWamid(value, visited = new Set()) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/wamid\.[A-Za-z0-9_.:-]+/);
    return match?.[0] || null;
  }
  if (typeof value !== 'object' || visited.has(value)) return null;
  visited.add(value);
  for (const nested of Object.values(value)) {
    const found = findWamid(nested, visited);
    if (found) return found;
  }
  return null;
}

function messageTimestamp(message) {
  const value = message?.created_at
    || message?.createdAt
    || message?.timestamp
    || message?.sent_at
    || message?.sentAt
    || message?.ts
    || null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function collectMessageText(value, parentKey = '', depth = 0, result = [], visited = new Set()) {
  if (value == null || depth > 5) return result;
  if (typeof value === 'string') {
    if (/content|message|text|title|body|caption|template|name|param|button/i.test(parentKey)) {
      result.push(value);
    }
    return result;
  }
  if (typeof value !== 'object' || visited.has(value)) return result;
  visited.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (/mid|wamid|id|timestamp|created|updated|sent_at|date|time/i.test(key)) continue;
    collectMessageText(nested, key, depth + 1, result, visited);
  }
  return result;
}

function messageFingerprint(message) {
  const normalized = collectMessageText(message)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length < 12) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function technicalKeys(value, depth = 0, result = new Set(), visited = new Set()) {
  if (!value || typeof value !== 'object' || depth > 3 || visited.has(value)) return result;
  visited.add(value);
  for (const [key, nested] of Object.entries(value)) {
    result.add(String(key).toLowerCase());
    technicalKeys(nested, depth + 1, result, visited);
  }
  return result;
}

function provenanceHint(message) {
  const keys = [...technicalKeys(message)];
  if (keys.some((key) => /automation|flow|campaign|broadcast|sequence/.test(key))) return 'automation_metadata';
  if (keys.some((key) => /api|webhook|integration/.test(key))) return 'api_metadata';
  return 'undetermined';
}

async function readJson(url, headers, source) {
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) throw new Error(`${source}_HTTP_${response.status}`);
  return response.json();
}

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const supabaseKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const chatbyToken = required('CHATBY_TOKEN');
  const chatbyBaseUrl = String(process.env.CHATBY_BASE_URL || 'https://app.chatby.io/api').replace(/\/+$/, '');
  const lookbackHours = Math.max(1, Math.min(168, Number(process.env.DUPLICATE_AUDIT_LOOKBACK_HOURS || 72)));
  const since = new Date(Date.now() - lookbackHours * 3600000).toISOString();

  const ledgerUrl = new URL(`${supabaseUrl}/rest/v1/template_delivery_ledger`);
  ledgerUrl.searchParams.set('select', 'template_name,status,attempted_at,sent_at,chatby_user_ns');
  ledgerUrl.searchParams.set('attempted_at', `gte.${since}`);
  ledgerUrl.searchParams.set('order', 'attempted_at.desc');
  ledgerUrl.searchParams.set('limit', '300');
  const ledger = await readJson(ledgerUrl, {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json'
  }, 'SUPABASE');

  const rows = (Array.isArray(ledger) ? ledger : []).filter((row) => (
    TARGET_TEMPLATES.includes(templateSlug(row.template_name)) && row.chatby_user_ns
  ));
  const conversations = new Map();
  for (const userNs of new Set(rows.map((row) => String(row.chatby_user_ns)))) {
    const url = new URL(`${chatbyBaseUrl}/subscriber/chat-messages`);
    url.searchParams.set('user_ns', userNs);
    const payload = await readJson(url, {
      Authorization: `Bearer ${chatbyToken}`,
      Accept: 'application/json'
    }, 'CHATBY');
    conversations.set(userNs, Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []);
  }

  const pairKeys = new Set();
  const byTemplate = Object.fromEntries(TARGET_TEMPLATES.map((template) => [template, {
    ledger_rows: 0,
    duplicate_pairs: 0,
    gaps_seconds: [],
    provenance_hints: {
      automation_metadata: 0,
      api_metadata: 0,
      undetermined: 0
    }
  }]));

  for (const row of rows) {
    const template = templateSlug(row.template_name);
    const summary = byTemplate[template];
    summary.ledger_rows += 1;
    const attemptedAt = Date.parse(row.attempted_at || row.sent_at || '');
    if (!Number.isFinite(attemptedAt)) continue;
    const messages = (conversations.get(String(row.chatby_user_ns)) || [])
      .map((message) => ({
        message,
        at: messageTimestamp(message),
        mid: findWamid(message),
        fingerprint: messageFingerprint(message)
      }))
      .filter((item) => item.mid && item.fingerprint && Number.isFinite(item.at))
      .filter((item) => item.at >= attemptedAt - 10 * 60000 && item.at <= attemptedAt + 30 * 60000)
      .sort((left, right) => left.at - right.at);

    for (let index = 1; index < messages.length; index += 1) {
      const first = messages[index - 1];
      const second = messages[index];
      if (first.fingerprint !== second.fingerprint) continue;
      const gapSeconds = Math.round((second.at - first.at) / 1000);
      if (gapSeconds < 0 || gapSeconds > 10 * 60) continue;
      if (Math.min(Math.abs(first.at - attemptedAt), Math.abs(second.at - attemptedAt)) > 3 * 60000) continue;
      const pairKey = crypto.createHash('sha256')
        .update([first.mid, second.mid, template].sort().join('|'))
        .digest('hex');
      if (pairKeys.has(pairKey)) continue;
      pairKeys.add(pairKey);
      summary.duplicate_pairs += 1;
      summary.gaps_seconds.push(gapSeconds);
      const hints = new Set([provenanceHint(first.message), provenanceHint(second.message)]);
      for (const hint of hints) summary.provenance_hints[hint] += 1;
    }
  }

  const result = {
    ok: true,
    lookback_hours: lookbackHours,
    ledger_rows_checked: rows.length,
    conversations_checked: conversations.size,
    duplicate_pairs: pairKeys.size,
    by_template: Object.fromEntries(Object.entries(byTemplate).map(([template, summary]) => [
      template,
      {
        ...summary,
        min_gap_seconds: summary.gaps_seconds.length ? Math.min(...summary.gaps_seconds) : null,
        max_gap_seconds: summary.gaps_seconds.length ? Math.max(...summary.gaps_seconds) : null,
        gaps_seconds: undefined
      }
    ])),
    pii_logged: false,
    external_writes: 0
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error?.message || error).replace(/https?:\/\/\S+/g, '[URL REDACTED]'),
    pii_logged: false,
    external_writes: 0
  })}\n`);
  process.exitCode = 1;
});

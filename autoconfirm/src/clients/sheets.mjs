import crypto from 'node:crypto';
import { getAppConfig } from '../config.mjs';
import { loadState, saveState } from '../storage.mjs';

const config = getAppConfig();
let simulationDecisionCache = null;
let spreadsheetMetadataCache = null;
const sheetValuesCache = new Map();

function cacheEntry(key) {
  const entry = sheetValuesCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

function setCacheEntry(key, values) {
  sheetValuesCache.set(key, {
    expiresAt: Date.now() + 60000,
    values
  });
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizePrivateKey(privateKey) {
  return privateKey.replace(/\\n/g, '\n').trim();
}

async function getAccessToken() {
  if (!config.googleServiceAccountEmail || !config.googlePrivateKey) {
    throw new Error('Faltan credenciales de Google Sheets.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.googleServiceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();

  const signature = signer.sign(normalizePrivateKey(config.googlePrivateKey));
  const jwt = `${unsigned}.${signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Google token respondió ${response.status}: ${JSON.stringify(data)}`);
  if (!data?.access_token) throw new Error('Google no devolvió access_token.');
  return data.access_token;
}

async function sheetsRequest(method, url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Sheets respondió ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function valuesUrl(range, query = '') {
  return `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}/values/${encodeURIComponent(range)}${query}`;
}

async function getSpreadsheetMetadata() {
  if (spreadsheetMetadataCache && spreadsheetMetadataCache.expiresAt > Date.now()) {
    return spreadsheetMetadataCache.metadata;
  }

  const metadata = await sheetsRequest('GET', `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}`);
  spreadsheetMetadataCache = {
    expiresAt: Date.now() + 300000,
    metadata
  };
  return metadata;
}

async function ensureSheetTitle() {
  const targetTitle = config.googleSheetName || 'Pedidos';
  const metadata = await getSpreadsheetMetadata();
  const sheets = metadata.sheets || [];
  const existing = sheets.find((sheet) => sheet.properties?.title === targetTitle);
  if (existing) return targetTitle;

  await sheetsRequest('POST', `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: targetTitle } } }]
  });
  spreadsheetMetadataCache = null;

  return targetTitle;
}

async function ensureNamedSheet(sheetTitle) {
  const metadata = await getSpreadsheetMetadata();
  const sheets = metadata.sheets || [];
  const existing = sheets.find((sheet) => sheet.properties?.title === sheetTitle);
  if (existing) return sheetTitle;

  await sheetsRequest('POST', `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: sheetTitle } } }]
  });
  spreadsheetMetadataCache = null;

  return sheetTitle;
}

async function getSheetProperties(sheetTitle) {
  const metadata = await getSpreadsheetMetadata();
  return metadata.sheets?.find((sheet) => sheet.properties?.title === sheetTitle)?.properties || null;
}

async function getCachedValues(range) {
  const cached = cacheEntry(range);
  if (cached) return cached.values;

  const current = await sheetsRequest('GET', valuesUrl(range));
  const values = current.values || [];
  setCacheEntry(range, values);
  return values;
}

async function ensureHeaders(sheetTitle, values) {
  const headers = [
    'orderId',
    'nombre',
    'telefono',
    'fecha_creacion',
    'estado',
    'importe',
    'en_incidencia',
    'codigo_incidencia',
    'detalle_incidencia',
    'fecha_confirmacion'
  ];

  if (values.length > 0) {
    const currentHeaders = values[0] || [];
    const mergedHeaders = [...currentHeaders];
    headers.forEach((header, index) => {
      mergedHeaders[index] = header;
    });
    if (headers.some((header, index) => currentHeaders[index] !== header)) {
      await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:J1`, '?valueInputOption=RAW'), { values: [mergedHeaders.slice(0, headers.length)] });
      values[0] = mergedHeaders.slice(0, headers.length);
    }
    return mergedHeaders;
  }

  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:J1`, '?valueInputOption=RAW'), { values: [headers] });
  values[0] = headers;
  return headers;
}

async function ensureControlHeaders(sheetTitle, values) {
  if (values.length > 0) return values[0];

  const headers = [
    'orderId',
    'decision_simulacion',
    'motivo',
    'fuente',
    'actualizado_en'
  ];
  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:E1`, '?valueInputOption=RAW'), { values: [headers] });
  values[0] = headers;
  return headers;
}

async function ensureAgentDecisionHeaders(sheetTitle, values) {
  if (values.length > 0) return values[0];

  const headers = [
    'fecha',
    'orderId',
    'accion',
    'intent',
    'confianza',
    'fuente',
    'mensaje_cliente',
    'motivo',
    'dry_run'
  ];
  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:I1`, '?valueInputOption=RAW'), { values: [headers] });
  values[0] = headers;
  return headers;
}

async function ensureAgentMemoryHeaders(sheetTitle, values) {
  if (values.length > 0) return values[0];

  const headers = [
    'id',
    'tipo',
    'regla',
    'fuente',
    'creado_en'
  ];
  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:E1`, '?valueInputOption=RAW'), { values: [headers] });
  values[0] = headers;
  return headers;
}

function formatSheetDate(value) {
  if (!value) return '';
  const raw = String(value);
  const dropeaDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (dropeaDate) {
    return `${dropeaDate[3]}/${dropeaDate[2]}/${dropeaDate[1]} ${dropeaDate[4]}:${dropeaDate[5]}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: config.timezone || 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

export async function upsertSheetRow(order) {
  if (!config.googleSheetsEnabled) return { skipped: true, reason: 'google_sheets_disabled' };
  if (!config.googleSheetId) return { skipped: true };

  const sheetTitle = await ensureSheetTitle();
  const range = `${sheetTitle}!A:Z`;
  const values = await getCachedValues(range);
  const headers = await ensureHeaders(sheetTitle, values);

  const orderIdIndex = headers.indexOf('orderId');
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[orderIdIndex]) === String(order.orderId));
  const existingConfirmedAt = rowIndex > 0 ? values[rowIndex]?.[9] || '' : '';
  const issue = order.raw?.issues || null;
  const hasIssue = Boolean(issue);
  const issueDetail = [
    issue?.status || '',
    issue?.solutions ? `Solucion: ${issue.solutions}` : ''
  ].filter(Boolean).join(' | ');
  const row = [
    order.orderId,
    order.customerName || '',
    order.customerPhone || '',
    formatSheetDate(order.raw?.created_at || order.raw?.createdAt || order.createdAt),
    order.status || '',
    order.orderAmount ?? '',
    hasIssue ? 'Si' : 'No',
    issue?.incidence_code || '',
    issueDetail,
    order.confirmedAt || existingConfirmedAt || ''
  ];

  if (rowIndex > 0) {
    await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A${rowIndex + 1}:J${rowIndex + 1}`, '?valueInputOption=RAW'), { values: [row] });
    values[rowIndex] = row;
    setCacheEntry(range, values);
    return { updated: true, rowIndex };
  }

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  values.push(row);
  setCacheEntry(range, values);
  return { appended: true };
}

export async function getSimulationDecision(orderId) {
  if (!config.googleSheetsEnabled) return null;
  if (!config.googleSheetId) return null;

  const now = Date.now();
  if (!simulationDecisionCache || simulationDecisionCache.expiresAt <= now) {
    const sheetTitle = await ensureNamedSheet('Control Simulacion');
    const range = `${sheetTitle}!A:Z`;
    const values = await getCachedValues(range);
    const headers = await ensureControlHeaders(sheetTitle, values);
    simulationDecisionCache = {
      expiresAt: now + 60000,
      values,
      headers
    };
  }

  const values = simulationDecisionCache.values || [];
  const headers = simulationDecisionCache.headers || [];
  const orderIdIndex = headers.indexOf('orderId') >= 0 ? headers.indexOf('orderId') : 0;
  const decisionIndex = headers.indexOf('decision_simulacion') >= 0 ? headers.indexOf('decision_simulacion') : 1;
  const reasonIndex = headers.indexOf('motivo') >= 0 ? headers.indexOf('motivo') : 2;
  const sourceIndex = headers.indexOf('fuente') >= 0 ? headers.indexOf('fuente') : 3;

  const row = values.find((item, index) => index > 0 && String(item[orderIdIndex]) === String(orderId));
  if (!row) return null;

  const decision = String(row[decisionIndex] || '').trim().toUpperCase();
  if (!decision) return null;

  return {
    orderId: String(orderId),
    decision,
    reason: row[reasonIndex] || '',
    source: row[sourceIndex] || 'sheet_training'
  };
}

export async function upsertSimulationDecision({ orderId, decision, reason = '', source = 'training' }) {
  if (!config.googleSheetsEnabled) return { skipped: true, reason: 'google_sheets_disabled' };
  if (!config.googleSheetId) return { skipped: true };
  simulationDecisionCache = null;

  const sheetTitle = await ensureNamedSheet('Control Simulacion');
  const range = `${sheetTitle}!A:Z`;
  const values = await getCachedValues(range);
  const headers = await ensureControlHeaders(sheetTitle, values);
  const orderIdIndex = headers.indexOf('orderId') >= 0 ? headers.indexOf('orderId') : 0;
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[orderIdIndex]) === String(orderId));
  const row = [
    orderId,
    decision,
    reason,
    source,
    new Date().toISOString()
  ];

  if (rowIndex > 0) {
    await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A${rowIndex + 1}:E${rowIndex + 1}`, '?valueInputOption=RAW'), { values: [row] });
    values[rowIndex] = row;
    setCacheEntry(range, values);
    return { updated: true, rowIndex };
  }

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  values.push(row);
  setCacheEntry(range, values);
  return { appended: true };
}

export async function appendAgentDecision({
  orderId,
  action,
  intent = '',
  confidence = '',
  source = '',
  customerMessage = '',
  reason = '',
  dryRun = ''
}) {
  if (!config.googleSheetsEnabled) return { skipped: true, reason: 'google_sheets_disabled' };
  if (!config.googleSheetId) return { skipped: true };

  const sheetTitle = await ensureNamedSheet('Decisiones Agente');
  const range = `${sheetTitle}!A:Z`;
  const values = await getCachedValues(range);
  await ensureAgentDecisionHeaders(sheetTitle, values);

  const row = [
    new Date().toISOString(),
    orderId,
    action,
    intent,
    confidence,
    source,
    String(customerMessage || '').slice(0, 500),
    String(reason || '').slice(0, 500),
    String(dryRun)
  ];

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  values.push(row);
  setCacheEntry(range, values);
  return { appended: true };
}

export async function getAgentMemoryRules() {
  if (!config.googleSheetsEnabled) return [];
  if (!config.googleSheetId) return [];

  const sheetTitle = await ensureNamedSheet('Memoria Agente');
  const range = `${sheetTitle}!A:Z`;
  const values = await getCachedValues(range);
  const headers = await ensureAgentMemoryHeaders(sheetTitle, values);
  const index = (name, fallback) => {
    const found = headers.indexOf(name);
    return found >= 0 ? found : fallback;
  };
  const idIndex = index('id', 0);
  const typeIndex = index('tipo', 1);
  const textIndex = index('regla', 2);
  const sourceIndex = index('fuente', 3);
  const createdIndex = index('creado_en', 4);

  return values.slice(1)
    .filter((row) => row?.[textIndex])
    .map((row) => ({
      id: row[idIndex] || '',
      type: row[typeIndex] || '',
      text: row[textIndex] || '',
      source: row[sourceIndex] || '',
      createdAt: row[createdIndex] || ''
    }));
}

export async function appendAgentMemoryRule(rule) {
  if (!config.googleSheetsEnabled) return { skipped: true, reason: 'google_sheets_disabled' };
  if (!config.googleSheetId || !rule?.text) return { skipped: true };

  const sheetTitle = await ensureNamedSheet('Memoria Agente');
  const range = `${sheetTitle}!A:Z`;
  const values = await getCachedValues(range);
  await ensureAgentMemoryHeaders(sheetTitle, values);
  const existing = values.slice(1).some((row) => String(row[2] || '').trim().toLowerCase() === String(rule.text || '').trim().toLowerCase());
  if (existing) return { skipped: true, reason: 'duplicate_rule' };

  const row = [
    rule.id || `lesson_${Date.now()}`,
    rule.type || 'feedback_rule',
    String(rule.text || '').slice(0, 1000),
    rule.source || 'dashboard',
    rule.createdAt || new Date().toISOString()
  ];

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  values.push(row);
  setCacheEntry(range, values);
  return { appended: true };
}

export async function replaceSheetValues(sheetTitle, rows, { frozenRows = 1, headerColor = { red: 0.02, green: 0.28, blue: 0.22 } } = {}) {
  if (!config.googleSheetsEnabled) return { skipped: true, reason: 'google_sheets_disabled' };
  if (!config.googleSheetId) return { skipped: true };

  await ensureNamedSheet(sheetTitle);
  const safeRows = Array.isArray(rows) && rows.length ? rows : [['Sin datos']];
  const width = safeRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 1), 1);
  const normalizedRows = safeRows.map((row) => {
    const current = Array.isArray(row) ? row : [row];
    return [...current, ...Array(Math.max(0, width - current.length)).fill('')];
  });

  await sheetsRequest('POST', valuesUrl(`${sheetTitle}!A:Z`, ':clear'), {});
  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1`, '?valueInputOption=RAW'), { values: normalizedRows });
  sheetValuesCache.delete(`${sheetTitle}!A:Z`);

  const properties = await getSheetProperties(sheetTitle);
  if (!properties?.sheetId) return { updated: true, rows: normalizedRows.length };

  const sheetId = properties.sheetId;
  await sheetsRequest('POST', `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}:batchUpdate`, {
    requests: [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: frozenRows }
          },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: Math.min(frozenRows, normalizedRows.length)
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: headerColor,
              textFormat: {
                foregroundColor: { red: 1, green: 1, blue: 1 },
                bold: true
              }
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: Math.min(width, 26)
          }
        }
      }
    ]
  });

  return { updated: true, rows: normalizedRows.length };
}

export async function getSheetRows(sheetTitle, range = 'A:Z') {
  if (!config.googleSheetsEnabled) return [];
  if (!config.googleSheetId) return [];

  await ensureNamedSheet(sheetTitle);
  return getCachedValues(`${sheetTitle}!${range}`);
}

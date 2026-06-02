import crypto from 'node:crypto';
import { getAppConfig } from '../config.mjs';
import { loadState, saveState } from '../storage.mjs';

const config = getAppConfig();
let simulationDecisionCache = null;

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
  return sheetsRequest('GET', `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}`);
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

  return sheetTitle;
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
    }
    return mergedHeaders;
  }

  await sheetsRequest('PUT', valuesUrl(`${sheetTitle}!A1:J1`, '?valueInputOption=RAW'), { values: [headers] });
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
  if (!config.googleSheetId) return { skipped: true };

  const sheetTitle = await ensureSheetTitle();
  const range = `${sheetTitle}!A:Z`;
  const current = await sheetsRequest('GET', valuesUrl(range));
  const values = current.values || [];
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
    return { updated: true, rowIndex };
  }

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  return { appended: true };
}

export async function getSimulationDecision(orderId) {
  if (!config.googleSheetId) return null;

  const now = Date.now();
  if (!simulationDecisionCache || simulationDecisionCache.expiresAt <= now) {
    const sheetTitle = await ensureNamedSheet('Control Simulacion');
    const range = `${sheetTitle}!A:Z`;
    const current = await sheetsRequest('GET', valuesUrl(range));
    const values = current.values || [];
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
  if (!config.googleSheetId) return { skipped: true };
  simulationDecisionCache = null;

  const sheetTitle = await ensureNamedSheet('Control Simulacion');
  const range = `${sheetTitle}!A:Z`;
  const current = await sheetsRequest('GET', valuesUrl(range));
  const values = current.values || [];
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
    return { updated: true, rowIndex };
  }

  await sheetsRequest('POST', valuesUrl(range, ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), { values: [row] });
  return { appended: true };
}

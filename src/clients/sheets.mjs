import crypto from 'node:crypto';
import { getAppConfig } from '../config.mjs';
import { loadState, saveState } from '../storage.mjs';

const config = getAppConfig();

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

export async function upsertSheetRow(order) {
  if (!config.googleSheetId) return { skipped: true };

  const sheet = encodeURIComponent(config.googleSheetName || 'Pedidos');
  const range = `${sheet}!A:Z`;
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}/values/${range}`;
  const current = await sheetsRequest('GET', getUrl);
  const values = current.values || [];
  const headers = values[0] || [
    'orderId',
    'nombre',
    'telefono',
    'fecha_creacion',
    'estado',
    'importe',
    'fecha_confirmacion'
  ];

  const orderIdIndex = headers.indexOf('orderId');
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[orderIdIndex]) === String(order.orderId));
  const row = [
    order.orderId,
    order.customerName || '',
    order.customerPhone || '',
    order.createdAt || '',
    order.status || '',
    order.orderAmount ?? '',
    order.confirmedAt || ''
  ];

  if (rowIndex > 0) {
    const updateRange = `${sheet}!A${rowIndex + 1}:G${rowIndex + 1}`;
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=RAW`;
    await sheetsRequest('PUT', updateUrl, { values: [row] });
    return { updated: true, rowIndex };
  }

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await sheetsRequest('POST', appendUrl, { values: [row] });
  return { appended: true };
}

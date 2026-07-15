import crypto from 'node:crypto';

const BASE_URL = 'https://api.consignee.gls-spain.es/api/v5';
const API_SECRET = process.env.GLS_TRACKING_SECRET || 'gls';

function trackingCoordinates({ trackingUrl, tracking } = {}) {
  const url = String(trackingUrl || '');
  const match = url.match(/\/e\/(\d+)\/([0-9A-Za-z-]+)(?:\/|$)/i);
  return {
    reference: match?.[1] || String(tracking || '').replace(/\D/g, '') || null,
    postalCode: match?.[2] || null
  };
}

function signedHeaders(path) {
  const timestamp = new Date().toISOString();
  const signature = crypto.createHmac('sha256', API_SECRET)
    .update(`POST\n${path}\n${timestamp}`)
    .digest('hex');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'MyGls-Agent': 'pwa',
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}

function wallClock(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}

export async function getGlsTrackingHistory({ trackingUrl, tracking } = {}) {
  const { reference, postalCode } = trackingCoordinates({ trackingUrl, tracking });
  if (!reference || !postalCode) return null;

  const path = '/expeditions/find';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: signedHeaders(path),
      body: JSON.stringify({
        find: {
          reference,
          destination: { address: { postalCode } }
        }
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GLS tracking no respondio en 10000 ms.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GLS tracking respondio ${response.status}: ${JSON.stringify(payload)}`);
  }

  const found = payload?.found || null;
  if (!found) return null;
  const history = (found.tracking || [])
    .map((event) => ({
      eventAt: event?.at || null,
      displayAt: wallClock(event?.at),
      text: event?.description || event?.code || 'Evento GLS',
      code: event?.code || null
    }))
    .sort((left, right) => new Date(left.eventAt || 0) - new Date(right.eventAt || 0));

  return {
    history,
    latest: history[history.length - 1] || null,
    incidence: found.state?.incidenceDatetime
      ? {
          eventAt: found.state.incidenceDatetime,
          displayAt: wallClock(found.state.incidenceDatetime),
          text: found.state.reason || 'Incidencia de transporte',
          code: found.state.code || null
        }
      : null,
    state: found.state || null,
    expeditionCode: found.expeditionCode || reference,
    expeditionUuid: found.expeditionUuid || null,
    source: 'GLS tracking oficial'
  };
}

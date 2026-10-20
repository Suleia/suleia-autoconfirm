export function localDay(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (key) => parts.find((p) => p.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function dateRange(input, timezone, now = new Date()) {
  const today = localDay(now, timezone);
  const text = input.trim().toLowerCase() || 'hoy';
  if (text === 'hoy') return { since: today, until: today, partial: true };
  if (text === 'ayer') return { since: shiftDay(today, -1), until: shiftDay(today, -1), partial: false };
  if (['7d', '30d'].includes(text)) return { since: shiftDay(today, -Number(text.slice(0, -1))), until: shiftDay(today, -1), partial: false };
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/.exec(text);
  if (!match) throw new Error('Usa hoy, ayer, 7d, 30d o AAAA-MM-DD AAAA-MM-DD.');
  const [, since, until] = match;
  const valid = (day) => !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!valid(since) || !valid(until) || since > until || until > today || (Date.parse(until) - Date.parse(since)) / 86400000 > 30) throw new Error('Fechas inválidas: máximo 31 días y sin fechas futuras.');
  return { since, until, partial: until === today };
}
export function previousRange(range) {
  const days = Math.round((Date.parse(range.until) - Date.parse(range.since)) / 86400000) + 1;
  return { since: shiftDay(range.since, -days), until: shiftDay(range.since, -1), partial: false };
}
export const amount = (value, currency = 'EUR') => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'no disponible' : new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(Number(value));
const metric = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'no disponible' : `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 2 })}${suffix}`;
export function purchase(actions) {
  if (!Array.isArray(actions)) return null;
  const item = actions.find((a) => a.action_type === 'purchase') || actions.find((a) => a.action_type === 'omni_purchase') || actions.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase');
  return item ? Number(item.value) : null;
}
export function reportText(account, range, rows) {
  const sum = (field) => rows.length && rows.every((r) => r[field] !== undefined && r[field] !== null && Number.isFinite(Number(r[field]))) ? rows.reduce((n, r) => n + Number(r[field]), 0) : null;
  return [
    `Meta Ads · ${account.name}`,
    `${range.since} → ${range.until} · ${account.timezone_name}${range.partial ? ' · período en curso' : ''}`,
    `Gasto: ${amount(sum('spend'), account.currency)} · Impresiones: ${metric(sum('impressions'))} · Clics: ${metric(sum('clicks'))}`,
    'Compras y ROAS atribuidos por Meta con la configuración de atribución de la cuenta. No equivalen a beneficio ni a pedidos entregados.',
    ...(!rows.length ? ['Meta no devuelve filas para este período.'] : []),
    ...rows.map((r) => [
      `\n${r.campaign_name} · ID ${r.campaign_id}`,
      `Gasto ${amount(r.spend, account.currency)} · Compras ${metric(purchase(r.actions))} · Valor atribuido ${amount(purchase(r.action_values), account.currency)}`,
      `ROAS ${metric(purchase(r.purchase_roas), 'x')} · CTR ${metric(r.ctr, '%')} · CPC ${amount(r.cpc, account.currency)}`
    ].join('\n'))
  ].join('\n');
}
export function comparisonText(account, current, previous, rows, prior) {
  const before = new Map(prior.map((r) => [r.campaign_id, r]));
  const after = new Map(rows.map((r) => [r.campaign_id, r]));
  const money = (row, key) => row ? amount(row[key], account.currency) : 'sin fila';
  const ratio = (row) => row ? metric(purchase(row.purchase_roas), 'x') : 'sin fila';
  const lines = [...new Set([...after.keys(), ...before.keys()])].map((id) => {
    const a = after.get(id), b = before.get(id);
    return `${a?.campaign_name || b.campaign_name} · ID ${id}\nGasto: ${money(b, 'spend')} → ${money(a, 'spend')}\nROAS atribuido: ${ratio(b)} → ${ratio(a)}\nCPC: ${money(b, 'cpc')} → ${money(a, 'cpc')}`;
  });
  return [`Comparación · ${account.name} · ${account.timezone_name}`, `Anterior ${previous.since} → ${previous.until}`, `Actual ${current.since} → ${current.until}`, 'Atribución de la cuenta Meta. Sin fila significa dato no disponible; no se interpreta como cero.', ...lines].join('\n\n');
}

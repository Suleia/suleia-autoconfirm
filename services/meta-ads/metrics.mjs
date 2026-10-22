export const CONTRACT = 'meta-v2:7d_click+1d_view:conversion:website-first:v1';
export const number = (v) => !['number','string'].includes(typeof v) || (typeof v==='string'&&!v.trim()) || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
export const ratio = (a, b, scale = 1) => a === null || b === null || b <= 0 ? null : a / b * scale;

// Aliases describe overlapping events: select one, never sum aliases. Invalid
// preferred data cannot silently fall through to a different attribution scope.
export function action(rows, types) {
  for (const type of types) {
    const matches = (rows || []).filter(r => r.action_type === type);
    if (!matches.length) continue;
    const values = matches.map(r => number(r.value));
    if (values.includes(null) || new Set(values).size !== 1) return { value: null, status: 'AMBIGUOUS', type };
    return { value: values[0], status: values[0] === 0 ? 'ZERO' : 'VALID', type };
  }
  return { value: null, status: 'MISSING', type: null };
}
import {selectPurchaseRoas} from './purchase-roas.mjs';
const purchases = ['offsite_conversion.fb_pixel_purchase','omni_purchase','purchase'];
export function normalizeInsight(row, context) {
  const nativeRoas=selectPurchaseRoas(row);
  const nativeCount=nativeRoas.action_type?action(row.actions,[nativeRoas.action_type]):{value:null,status:'MISSING'};
  const nativeValue=nativeRoas.action_type?action(row.action_values,[nativeRoas.action_type]):{value:null,status:'MISSING'};
  const spend = number(row.spend), impressions = number(row.impressions), clicks = number(row.inline_link_clicks);
  const count = action(row.actions, purchases);
  // Value and count must have the same event scope.
  const value = count.type ? action(row.action_values, [count.type]) : { value: null, status: 'MISSING', type: null };
  const roasStatus = [count.status, value.status].includes('AMBIGUOUS') ? 'AMBIGUOUS' : spend === null || value.value === null || count.value === null ? 'MISSING' : spend === 0 ? 'ZERO_SPEND' : value.value === 0 ? 'ZERO' : 'VALID';
  const outbound = action(row.outbound_clicks, ['outbound_click']);
  const landing = action(row.actions, ['landing_page_view','omni_landing_page_view']);
  const cart = action(row.actions, ['offsite_conversion.fb_pixel_add_to_cart','add_to_cart','omni_add_to_cart']);
  const checkout = action(row.actions, ['offsite_conversion.fb_pixel_initiate_checkout','initiate_checkout','omni_initiated_checkout']);
  return {
    level: context.level, entityId: String(row[`${context.level}_id`] || ''), campaignId: String(row.campaign_id || ''), adsetId: String(row.adset_id || ''), adId: String(row.ad_id || ''),
    name: String(row[`${context.level}_name`] || ''), since: row.date_start, until: row.date_stop,
    spend, impressions, reach: number(row.reach), frequency: number(row.frequency),
    cpm: ratio(spend, impressions, 1000), linkClicks: clicks, linkCtr: ratio(clicks, impressions, 100),
    outboundClicks: outbound.value, outboundCtr: ratio(outbound.value, impressions, 100), linkCpc: ratio(spend, clicks),
    landingPageViews: landing.value, addToCart: cart.value, initiateCheckout: checkout.value,
    costPerCart: ratio(spend, cart.value), costPerCheckout: ratio(spend, checkout.value),
    purchases: count.value, purchaseValue: value.value, purchaseType: count.type, cpa: ratio(spend, count.value),
    roas: ['VALID','ZERO'].includes(roasStatus) ? ratio(value.value, spend) : null, roasStatus,
    metaRoas:nativeRoas.value,metaRoasStatus:nativeRoas.status==='AVAILABLE'?(nativeRoas.value===0?'ZERO':'VALID'):nativeRoas.status==='AMBIGUOUS'?'AMBIGUOUS':'MISSING',metaRoasPurchaseType:nativeRoas.action_type,
    metaPurchases:nativeCount.value,metaPurchaseValue:nativeValue.value,metaPurchaseStatus:nativeCount.status,metaPurchaseValueStatus:nativeValue.status,
    funnel: { clickToLanding: ratio(landing.value, clicks), landingToCart: ratio(cart.value, landing.value), cartToCheckout: ratio(checkout.value, cart.value), checkoutToPurchase: ratio(count.value, checkout.value) },
    quality: { purchase: count.status, purchaseValue: value.status, landing: landing.status, cart: cart.status, checkout: checkout.status },
    source: 'META_INSIGHTS', contract: CONTRACT, ...context
  };
}

export function localDay(now = Date.now(), zone = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
}
export function windowFor(period, now, zone = 'Europe/Madrid') {
  const day = localDay(now, zone), shift = n => new Date(Date.parse(day+'T12:00:00Z') - n*86400000).toISOString().slice(0,10);
  if(period && typeof period==='object') {
    const {since,until}=period,valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
    if(!valid(since)||!valid(until)||since>until||until>day||Date.parse(until)-Date.parse(since)>30*86400000)throw Error('QUERY_INVALID');
    return {since,until,partial:until===day};
  }
  if (period === 'hoy') return { since: day, until: day, partial: true };
  if (period === 'ayer') return { since: shift(1), until: shift(1), partial: false };
  const n = Number(String(period).replace('d',''));
  if (![3,7,30].includes(n)) throw new Error('PERIOD_REQUIRED: hoy, ayer, 3d, 7d o 30d');
  return { since: shift(n), until: shift(1), partial: false };
}

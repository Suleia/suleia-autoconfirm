import { getGlsTrackingHistory } from '../../../autoconfirm/src/clients/gls.mjs';
import { mapDropeaOrderState } from '../../../packages/platform-core/src/operational-truth/dropea-canonical.mjs';
import { verifiedAbsentOrderPhone } from '../../../packages/platform-core/src/incident/absent-resolution.mjs';

// Reuse the established official tracking read. Its POST /expeditions/find is
// a search, not a delivery, pickup, address or return mutation.
export function createAbsentLogisticsReader(clients, { glsRead = getGlsTrackingHistory, privacyKey='' } = {}) {
  return async issue => {
    if (issue.type !== 'RECIPIENT_ABSENT' || issue.initial_carrier_code === 'NAM' && issue.raw_type !== 'RECIPIENT_ABSENT') return { reason: 'ABSENT_MAPPING_NOT_VERIFIED', gls: {} };
    const entry = clients.find(c=>c.store.market===issue.market && String(c.store.store_id)===String(issue.store_id));
    if (!entry) return { reason: 'DROPEA_READ_CLIENT_NOT_AVAILABLE', gls: {} };
    try {
      const payload = await entry.client.request('getOrder', { id: Number(issue.dropea_order_id) });
      const order = payload?.data;
      if (!order || String(order.id)!==String(issue.dropea_order_id)) return { reason: 'DROPEA_ORDER_READ_IDENTITY_MISMATCH', gls: {} };
      const observedAt=new Date().toISOString();
      const phone=verifiedAbsentOrderPhone({issue,providerOrder:order,observedAt,privacyKey});
      const tracking = String(order.tracking_number || '');
      const postal = String(order.shipping_address?.postal_code || '');
      const url = order.tracking_url || (tracking && postal ? `https://m.gls-spain.es/e/${encodeURIComponent(tracking)}/${encodeURIComponent(postal)}/` : '');
      // A tracking outage must not erase separately verified order identity or
      // phone evidence. Carrier capability remains unknown in either case.
      let result=null;
      try { result=await glsRead({ trackingUrl: url, tracking }); } catch { /* tracking unavailable */ }
      // The tracking endpoint does not document retention, slot capability or
      // operational pickup acceptance. Those remain UNKNOWN, never fabricated.
      return { dropea_order_observed_at: observedAt, verified_phone:phone, order_state: mapDropeaOrderState(order.status, order.sub_status).canonical_state,
        gls: result ? { observed_at: new Date().toISOString(), source: result.source,
          capability_status: 'UNKNOWN', package_operable: null } : {} };
    } catch { return { reason: 'ABSENT_LOGISTICS_READ_UNAVAILABLE', gls: {} }; }
  };
}

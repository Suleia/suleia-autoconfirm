export function phone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export function completed(order) {
  if (order.status === 'FINISH' && ['DELIVERED', 'PAID'].includes(order.sub_status)) return 'delivered';
  if (order.status === 'FINISH' && order.sub_status === 'CANCELLED') return 'cancelled';
  // Separately owner-authorized on 2026-10-20. This does NOT assert that a
  // physical return has completed. Unresolved issues still block deletion.
  if (order.status === 'ERROR' && order.sub_status === 'REJECTED') return 'rejected_closed';
  // A rejection or return request is not proof that the parcel was returned.
  if (['FINISH', 'ERROR'].includes(order.status)
      && ['RETURNED', 'REJECTED', 'REFUSED'].includes(order.sub_status)
      && Number.isFinite(Date.parse(order.returned_at))) return 'returned';
  return null;
}

const canonical = value => String(value || '').trim().replace(/^#/, '');
export function decide(contact, orders, issues) {
  const p = phone(contact.phone || contact.user_id);
  if (!contact.user_ns || !p) return { eligible: false, reason: 'invalid_contact' };
  const related = orders.filter(o => phone(o.shipping_address?.phone_number) === p);
  const fields = Array.isArray(contact.user_fields) ? contact.user_fields : [];
  const reference = canonical(fields.find(f => f.name === '#Pedido')?.value);
  let exact = reference ? related.filter(o =>
    canonical(o.external_order_id) === reference || String(o.id) === reference) : [];
  if (!exact.length && !reference) {
    const ids = fields.filter(f => ['LOG-Payload', 'CON-Payload'].includes(f.name)).flatMap(f => {
      try { const v = JSON.parse(f.value); return [v.resource_id, v.resource?.id].filter(Boolean).map(String); }
      catch { return []; }
    });
    exact = related.filter(o => ids.includes(String(o.id)));
    // Some old contacts have no order fields. For deletion only, a unique
    // phone with exclusively completed orders is sufficient; never use this
    // rule to confirm, message or resolve an order.
    if (!ids.length && related.length && related.every(completed)) {
      exact = [...related].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,1);
    }
  }
  if (exact.length !== 1) return { eligible: false, reason: 'unmatched_or_ambiguous_order' };
  const order = exact[0];
  const reason = completed(order);
  if (!reason) return { eligible: false, reason: 'order_not_completed' };
  if (related.some(o => !completed(o) && !(o.status === 'FINISH' && o.sub_status === 'CANCELLED'))) {
    return { eligible: false, reason: 'other_nonterminal_order' };
  }
  const ids = new Set(related.map(o => String(o.id)));
  if (issues.some(i => {
    // Dropea Issue contract: carrier closure changes is_active/resolved_at,
    // not the preserved user-workflow status (which may remain PENDING/INFO).
    // Only an explicit boolean false proves this operational closure.
    if (!ids.has(String(i.order_id)) || i.status === 'RESOLVED' || i.is_active === false) return false;
    const linked = related.find(o => String(o.id) === String(i.order_id));
    // A later completed delivery supersedes an earlier carrier incident.
    // Never ignore incidents opened/updated after delivery or unknown dates.
    return !(completed(linked) === 'delivered'
      && Date.parse(linked.delivered_at) > Date.parse(i.updated_at || i.created_at));
  })) {
    return { eligible: false, reason: 'unresolved_issue' };
  }
  return { eligible: true, reason, orderId: order.id };
}

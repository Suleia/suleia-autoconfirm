import { verifiedSecondAbsence } from './absent-discount-policy.mjs';
import { findVerifiedTemplateDelivery, isCustomerInteraction, messageTimestamp } from './incident-discount-policy.mjs';

export function absentDiscountReturnDecision({ incident, discountRecovery, now = Date.now(), messages } = {}) {
  const deny = reason => ({ eligible: false, status: 'BLOCKED_ABSENT_RETURN', reason });
  const issue = incident?.absentDiscountIssue;
  if (!issue || String(issue.id) !== String(incident.incidenceId) || String(issue.order_id) !== String(incident.orderId)
      || issue.is_active !== true || issue.status !== 'PENDING' || !verifiedSecondAbsence(issue)) return deny('second_absence_current_issue_unverified');
  if (incident.chatbyReadVerified !== true || incident.chatbyOrderAssociation !== 'EXACT_ORDER' || !incident.chatbyUserNs) return deny('chatby_exact_order_unverified');
  const sent = Date.parse(discountRecovery?.sentAt), created = Date.parse(incident.absentDiscountOrderCreatedAt), issueAt = Date.parse(issue.created_at);
  if (!discountRecovery?.verified || !discountRecovery.templateName || !Number.isFinite(sent) || !Number.isFinite(created)
      || !Number.isFinite(issueAt) || !Number.isFinite(Number(now)) || sent < Math.max(created, issueAt) || sent > now) return deny('current_order_discount_unverified');
  if (discountRecovery.responseStatus !== 'NO_RESPONSE') return deny('customer_activity_requires_resolution');
  if (messages !== undefined) {
    if (!Array.isArray(messages)) return deny('chatby_read_failed');
    const delivery = findVerifiedTemplateDelivery(messages, discountRecovery.templateName);
    if (!delivery || Date.parse(delivery.sentAt) !== sent) return deny('discount_delivery_changed_or_missing');
    if (messages.some(m => isCustomerInteraction(m) && (!Number.isFinite(messageTimestamp(m)) || messageTimestamp(m) >= sent))) return deny('customer_activity_after_discount');
  }
  const dueAt = new Date(sent + 24 * 3600000).toISOString();
  return { eligible: Number(now) >= Date.parse(dueAt), status: Number(now) >= Date.parse(dueAt) ? 'READY_FOR_RETURN' : 'WAITING_24_HOURS',
    action: 'return_to_origin', ruleId: 'absent_discount_no_response_return_24h_v1', responseStatus: 'NO_RESPONSE', dueAt,
    reason: 'Segunda ausencia verificada y 24 horas desde el descuento sin actividad posterior del cliente.' };
}

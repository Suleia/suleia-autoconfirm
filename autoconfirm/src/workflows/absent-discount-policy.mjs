import { findVerifiedTemplateDelivery, customerInteractionAfter, messageTimestamp, isCustomerInteraction } from './incident-discount-policy.mjs';

export function verifiedSecondAbsence(issue = {}) {
  const description = String(issue.initial_carrier_description || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (String(issue.delivery_attempt_number || '') === '1') return false;
  return issue.type === 'RECIPIENT_ABSENT' && (String(issue.delivery_attempt_number || '') === '2'
    || (issue.carrier === 'GLS' && issue.market === 'ES'
      && ['-30', '14'].includes(String(issue.initial_carrier_code))
      && String(issue.initial_carrier_substatus_code) === '15'
      && /\bAUSENTE SEGUNDA VEZ\b/.test(description)));
}

export function absentDiscountPolicy({ incident, messages = [], now = Date.now(), discountTemplateName, discountPersistentDelivery } = {}) {
  const deny = reason => ({ eligible: false, reason });
  const issue = incident?.absentDiscountIssue;
  if (!issue || String(issue.id) !== String(incident.incidenceId) || String(issue.order_id) !== String(incident.orderId)
      || issue.is_active !== true || issue.status !== 'PENDING') return deny('absent_current_issue_unverified');
  if (!verifiedSecondAbsence(issue)) return deny('second_absence_not_verified');
  if (incident.chatbyReadVerified !== true || incident.chatbyOrderAssociation !== 'EXACT_ORDER') return deny('chatby_context_unverified');
  const v3Messages = messages.filter(m => {
    const raw = m.raw || m;
    const name = raw.payload?.name || raw.content?.name || raw.template_name || raw.templateName || (typeof raw.content === 'string' ? raw.content : '');
    return String(name).toLowerCase().replace(/^es_es[ _-]+/, '').trim() === 'dropea_ausente_v3';
  });
  const initial = findVerifiedTemplateDelivery(v3Messages, 'dropea_ausente_v3');
  const sent = Date.parse(initial?.sentAt), created = Date.parse(incident.absentDiscountOrderCreatedAt);
  if (!Number.isFinite(sent) || !Number.isFinite(created) || sent < created || sent > Number(now)) return deny('absent_v3_current_order_not_verified');
  const anchor = { merchandiseTemplateSentAt: initial.sentAt, eligibilityAnchorAt: initial.sentAt };
  const prior = discountTemplateName && findVerifiedTemplateDelivery(messages, discountTemplateName);
  const ledgerAt = ['sent', 'already_seen'].includes(discountPersistentDelivery?.status) ? discountPersistentDelivery.sent_at : null;
  if (prior || ledgerAt) return { ...deny('discount_template_already_sent'), ...anchor, discountTemplateSentAt: prior?.sentAt || ledgerAt };
  if (customerInteractionAfter(messages, initial.sentAt) || messages.some(m => isCustomerInteraction(m) && messageTimestamp(m) === sent))
    return { ...deny('customer_interaction_after_absent_v3'), ...anchor };
  const dueAt = new Date(sent + 24 * 3600000).toISOString();
  return { eligible: Number(now) >= Date.parse(dueAt), reason: Number(now) >= Date.parse(dueAt) ? 'discount_template_due' : 'waiting_discount_window', ...anchor, dueAt, discountAmountEur: 5 };
}

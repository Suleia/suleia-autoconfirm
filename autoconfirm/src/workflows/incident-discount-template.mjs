import { setSubscriberUserFieldByName } from '../clients/chatby.mjs';

export const INCIDENT_DISCOUNT_TEMPLATE_NAME = 'es_es_dropea_incidencia_descuento_5';
export const INCIDENT_DISCOUNT_FIELD_NAME = 'Dropea: Valor Total - 5 EUR';
export const INCIDENT_DISCOUNT_FIELD_NS = 'f273883v15902977';
export const INCIDENT_DISCOUNT_TEMPLATE_BINDINGS = Object.freeze({
  'BODY_{{1}}': '{{first_name}}',
  'BODY_{{2}}': '{{f273883v13996841}}',
  'BODY_{{3}}': `{{${INCIDENT_DISCOUNT_FIELD_NS}}}`
});
export const INCIDENT_DISCOUNT_BUTTONS = Object.freeze({
  ACCEPT: 'ACCEPT_DISCOUNT_5',
  REJECT: 'REJECT_ORDER'
});

function numericMoney(value) {
  if (typeof value === 'string') {
    let normalized = value.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (!/\d/.test(normalized)) return null;
    const comma = normalized.lastIndexOf(',');
    const dot = normalized.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? ',' : '.';
      const grouping = decimal === ',' ? /\./g : /,/g;
      normalized = normalized.replace(grouping, '').replace(decimal, '.');
    } else if (comma >= 0) {
      normalized = normalized.replace(',', '.');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatSpanishMoney(value, currency = 'EUR') {
  const amount = numericMoney(value);
  if (amount === null) throw new Error('El importe no es numerico.');
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function calculateIncidentDiscount(order, discountAmount = 5) {
  if (order?.incidentDiscountApplied === true || order?.incidentDiscount5Applied === true) {
    const error = new Error('El descuento de incidencia ya estaba aplicado al pedido.');
    error.code = 'INCIDENT_DISCOUNT_ALREADY_APPLIED';
    throw error;
  }
  const originalAmount = numericMoney(order?.totalAmount ?? order?.orderAmount ?? order?.amount);
  const discount = numericMoney(discountAmount);
  if (originalAmount === null || originalAmount < 0) {
    const error = new Error('Shopify no devolvio un importe valido para el pedido.');
    error.code = 'SHOPIFY_ORDER_AMOUNT_INVALID';
    throw error;
  }
  if (discount === null || discount < 0) throw new Error('El descuento no es valido.');
  if (discount > 5) {
    const error = new Error('El descuento de incidencia no puede superar 5 EUR.');
    error.code = 'INCIDENT_DISCOUNT_LIMIT_EXCEEDED';
    throw error;
  }
  const finalAmount = Math.max(0, Math.round((originalAmount - discount + Number.EPSILON) * 100) / 100);
  return {
    originalAmount,
    discountAmount: discount,
    finalAmount,
    currencyCode: order?.currencyCode || 'EUR',
    originalFormatted: formatSpanishMoney(originalAmount, order?.currencyCode || 'EUR'),
    finalFormatted: formatSpanishMoney(finalAmount, order?.currencyCode || 'EUR')
  };
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function productTitle(item) {
  return String(
    item?.title
    || item?.name
    || item?.product_name
    || item?.productName
    || item?.shopify_name_item
    || item?.product?.title
    || item?.product?.name
    || ''
  ).trim();
}

function productSummaryFromOrder(order) {
  const raw = order?.raw && typeof order.raw === 'object' ? order.raw : {};
  const candidates = [
    order?.products,
    order?.items,
    order?.lines,
    raw?.products,
    raw?.items,
    raw?.lines,
    raw?.line_items
  ];

  for (const items of candidates) {
    if (!Array.isArray(items)) continue;
    const titles = items.map(productTitle).filter(Boolean);
    if (titles.length) return titles.join(', ');
  }

  return String(
    order?.productSummary
    || order?.productName
    || order?.product
    || raw?.productSummary
    || raw?.productName
    || raw?.product
    || ''
  ).trim();
}

export function incidentDiscountTemplateData({ order, customerName, productSummary }) {
  const pricing = calculateIncidentDiscount(order, 5);
  const name = firstName(customerName || order?.firstName || order?.customerName || order?.raw?.customerName);
  const product = String(productSummary || productSummaryFromOrder(order)).trim();
  if (!name || !product) {
    const error = new Error('Faltan nombre o producto para construir la plantilla de descuento.');
    error.code = 'INCIDENT_DISCOUNT_TEMPLATE_DATA_INVALID';
    throw error;
  }
  return {
    templateName: INCIDENT_DISCOUNT_TEMPLATE_NAME,
    language: 'es_ES',
    variables: [name, product, pricing.finalFormatted],
    params: {
      'BODY_{{1}}': name,
      'BODY_{{2}}': product,
      'BODY_{{3}}': pricing.finalFormatted
    },
    defaultBindings: INCIDENT_DISCOUNT_TEMPLATE_BINDINGS,
    subscriberField: {
      name: INCIDENT_DISCOUNT_FIELD_NAME,
      value: pricing.finalFormatted
    },
    originalPrice: pricing.originalFormatted,
    finalPrice: pricing.finalFormatted,
    originalAmount: pricing.originalAmount,
    finalAmount: pricing.finalAmount,
    buttonActions: INCIDENT_DISCOUNT_BUTTONS,
    discountApplied: 5,
    sourceAmount: 'Shopify order total',
    dedupeKey: `${String(order?.orderId || order?.id || 'unknown')}|${INCIDENT_DISCOUNT_TEMPLATE_NAME}`
  };
}

export async function prepareIncidentDiscountTemplateRecipient({
  userNs,
  order,
  customerName,
  productSummary
}) {
  if (!userNs) throw new Error('Falta user_ns para preparar la plantilla de descuento.');
  const data = incidentDiscountTemplateData({ order, customerName, productSummary });
  await setSubscriberUserFieldByName({
    user_ns: userNs,
    field_name: data.subscriberField.name,
    value: data.subscriberField.value
  });
  return data;
}

export function incidentDiscountTemplatePayload() {
  return {
    name: INCIDENT_DISCOUNT_TEMPLATE_NAME,
    category: 'MARKETING',
    language: 'es_ES',
    components: [
      {
        type: 'BODY',
        text: '👋 Hola, {{1}}.\n\nTenemos todo preparado para realizar la entrega de tu pedido.\n\nHemos visto que finalmente no pudiste aceptar el pedido y queremos ofrecerte una última oportunidad para que puedas disfrutar de tu compra.\n\n🎁 Queremos aplicarte un descuento inmediato de 5 € en tu pedido de {{2}}.\n\nEl importe final de tu pedido sería de {{3}}.\n\nSi decides aprovechar el descuento, gestionaremos de nuevo la entrega lo antes posible.\n\nSelecciona una de las siguientes opciones:',
        example: { body_text: [['Ana', 'NIDA premium', '24,99 €']] }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Quiero el descuento' },
          { type: 'QUICK_REPLY', text: 'No quiero el pedido' }
        ]
      }
    ]
  };
}

export function assertIncidentDiscountTemplateDisabled(config) {
  if (config?.enableIncidentDiscountTemplate === true) {
    throw new Error('La plantilla de descuento no puede activarse durante esta tarea.');
  }
  return true;
}

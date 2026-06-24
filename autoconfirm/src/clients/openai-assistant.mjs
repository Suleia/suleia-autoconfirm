import { getAppConfig } from '../config.mjs';
import { findOrder, upsertOrder } from '../storage.mjs';
import { getChatMessages, findSubscriberForOrder, subscriberConfirmsOrder } from './chatby.mjs';
import { getDropeaOrderById } from './dropea.mjs';
import { getShopifyOrderFinancialStatus } from './shopify.mjs';
import { upsertSheetRow } from './sheets.mjs';

const config = getAppConfig();
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
let assistantSyncPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function openaiRequest(path, { method = 'GET', body } = {}) {
  if (!config.openaiApiKey) throw new Error('Falta OPENAI_API_KEY.');

  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI Assistants respondiÃ³ ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function assistantTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_chatby_order_context',
        description:
          'Obtiene el contexto completo de un pedido para decidir la accion correcta. Devuelve el pedido, el hilo de Chatby, el ultimo mensaje del cliente, el ultimo boton pulsado y el estado actual de la direccion.',
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'ID del pedido en Dropea' },
            chatby_user_ns: { type: 'string', description: 'Identificador de la conversacion en Chatby' },
            customer_phone: { type: 'string', description: 'Telefono del cliente' }
          },
          required: ['order_id', 'chatby_user_ns', 'customer_phone'],
          additionalProperties: false
        },
        strict: true
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_dropea_action',
        description:
          'Aplica la accion operativa correcta sobre un pedido de Dropea segun la conversacion de Chatby. Nunca debe confirmar si el cliente pide cambiar direccion, no lo quiere o no confirma. Si hay cambio de direccion, debe registrar una nota en Google Sheets y dejar el pedido sin confirmar.',
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'ID del pedido en Dropea' },
            chatby_user_ns: { type: 'string', description: 'ID de la conversacion en Chatby' },
            action: {
              type: 'string',
              enum: ['CONFIRM_ORDER', 'REGISTER_ADDRESS_CHANGE', 'DO_NOT_CONFIRM', 'WAITING_CUSTOMER', 'MANUAL_REVIEW'],
              description: 'Accion final que debe ejecutarse'
            },
            latest_chatby_event: {
              type: 'string',
              enum: ['CONFIRM_BUTTON', 'CHANGE_ADDRESS_BUTTON', 'TEXT_CONFIRM', 'TEXT_CHANGE_ADDRESS', 'TEXT_CANCEL', 'UNCLEAR'],
              description: 'Ultimo evento detectado en Chatby'
            },
            customer_message: { type: 'string', description: 'Ultimo mensaje escrito por el cliente o texto del boton pulsado' },
            shipping_address: { type: 'string', description: 'Direccion actual del pedido en Dropea si esta disponible' },
            sheet_note: { type: 'string', description: 'Nota exacta para registrar en Google Sheets' },
            dry_run: { type: 'boolean', description: 'Si es true, solo simula la accion sin ejecutarla en Dropea' }
          },
          required: [
            'order_id',
            'chatby_user_ns',
            'action',
            'latest_chatby_event',
            'customer_message',
            'shipping_address',
            'sheet_note',
            'dry_run'
          ],
          additionalProperties: false
        },
        strict: true
      }
    }
  ];
}

function assistantInstructions() {
  return `
Eres el operador de pedidos de Suleia.

Tu tarea es revisar pedidos de Dropea con contexto de Chatby y decidir la accion correcta.

Reglas obligatorias:
- Nunca confirmes si el cliente pulsa "CAMBIAR DATOS DE ENVÍO" o si pide modificar direccion/datos de entrega.
- Nunca confirmes si el cliente dice "no lo quiero", "no confirmo", "cancelar", "anular" o equivalente.
- Solo confirma si hay confirmacion explicita y clara: boton "CONFIRMAR MI PEDIDO" o texto inequívoco como "Confirmo", "Confirmado", "Si lo quiero", "Lo quiero", "Vale", "Perfecto".
- Si existe contradiccion entre una señal antigua y una nueva, manda siempre la señal mas reciente.
- Si hay cambio de direccion, la accion correcta es REGISTER_ADDRESS_CHANGE.
- Si el pedido acaba de entrar y el cliente aún no ha respondido, usa WAITING_CUSTOMER.
- Si un pedido de Dropea supera 36 horas sin confirmacion clara y sin cambio de direccion/datos, no lo confirmes ni lo dejes esperando: la regla operativa es rechazarlo/cancelarlo automaticamente en Dropea.
- Si no hay certeza, usa MANUAL_REVIEW.
- Si se pide cambio de direccion, registra una nota operativa para Google Sheets.
- No inventes confirmaciones.
- Trata el flujo como simulacion salvo que el sistema indique lo contrario.

Flujo de trabajo:
1. Llama primero a get_chatby_order_context.
2. Evalua la ultima señal real del cliente.
3. Llama a apply_dropea_action con la accion correcta.
4. Si tienes duda, usa MANUAL_REVIEW.
`.trim();
}

function addHours(value, hours) {
  const date = value ? new Date(value) : new Date();
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Date(base.getTime() + (Number(hours) || 1) * 36e5).toISOString();
}

async function ensureAssistantConfigured() {
  if (!config.openaiAssistantId) {
    throw new Error('Falta OPENAI_ASSISTANT_ID.');
  }

  if (assistantSyncPromise) {
    return assistantSyncPromise;
  }

  assistantSyncPromise = (async () => {
    const current = await openaiRequest(`/assistants/${config.openaiAssistantId}`);
    const desired = {
      model: current.model || config.openaiModel,
      instructions: assistantInstructions(),
      tools: assistantTools()
    };

    await openaiRequest(`/assistants/${config.openaiAssistantId}`, {
      method: 'POST',
      body: desired
    });

    return { ...current, ...desired };
  })();

  return assistantSyncPromise.catch((error) => {
    assistantSyncPromise = null;
    throw error;
  });
}

function normalizeMessage(message) {
  return {
    role: String(message.role || message.sender || message.direction || 'message').toLowerCase(),
    content: message.content || message.message || message.text || message.button_text || message.buttonText || '',
    raw: message
  };
}

function isCustomerMessage(message) {
  const role = normalizeText(message.role);
  const raw = message.raw || {};
  const direction = normalizeText(raw.direction || raw.type || raw.message_type || raw.messageType || raw.from_type || raw.fromType);
  const sender = normalizeText(raw.sender || raw.sender_type || raw.senderType || raw.author || raw.from || raw.source);

  if (['in', 'inbound', 'incoming', 'received', 'customer', 'subscriber', 'user', 'client', 'cliente'].includes(role)) return true;
  if (['in', 'inbound', 'incoming', 'received'].includes(direction)) return true;
  if (['customer', 'subscriber', 'user', 'client', 'cliente'].includes(sender)) return true;
  if (raw.is_from_customer === true || raw.isFromCustomer === true || raw.from_customer === true) return true;
  if (raw.is_echo === true || raw.isEcho === true) return false;
  if (['out', 'outbound', 'sent', 'bot', 'agent', 'admin', 'system', 'tienda', 'store'].includes(role)) return false;
  if (['out', 'outbound', 'sent'].includes(direction)) return false;
  return false;
}

function messageTimestamp(message) {
  const raw = message?.raw || {};
  const numeric = Number(raw.ts || raw.timestamp || raw.created || raw.time);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const iso = raw.created_at || raw.createdAt || message?.created_at || message?.createdAt;
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function detectLatestEvent(messages) {
  const ordered = [...messages].sort((a, b) => messageTimestamp(a) - messageTimestamp(b));
  const customerOnly = ordered.filter((message) => isCustomerMessage(message));
  const last = customerOnly[customerOnly.length - 1];
  if (!last) {
    return {
      latest_chatby_event: 'UNCLEAR',
      customer_message: '',
      confidence: 20,
      reason: 'Sin mensaje entrante del cliente.'
    };
  }

  const text = normalizeText([
    last.content,
    last.raw?.payload?.title,
    last.raw?.payload?.body,
    last.raw?.title,
    last.raw?.button_text,
    last.raw?.buttonText
  ].filter(Boolean).join(' '));

  const msgType = normalizeText(last.raw?.msg_type || last.raw?.message_type || last.raw?.type);

  if (msgType.includes('postback') || text.includes('confirmar mi pedido')) {
    if (text.includes('cambiar') || text.includes('direccion') || text.includes('datos de envio')) {
      return {
        latest_chatby_event: 'CHANGE_ADDRESS_BUTTON',
        customer_message: last.content || '',
        confidence: 100,
        reason: 'El ultimo boton pulsado corresponde a cambio de direccion.'
      };
    }
    if (text.includes('confirm')) {
      return {
        latest_chatby_event: 'CONFIRM_BUTTON',
        customer_message: last.content || '',
        confidence: 100,
        reason: 'El ultimo boton pulsado corresponde a confirmacion.'
      };
    }
  }

  if (/\bno lo quiero\b|\bno quiero\b|\bno confirmo\b|\bno confirmar\b|\bcancel(ar|o|ado)?\b|\bquiero cancelar\b|\banular\b|\banulad[oa]\b|\bno enviar\b|\bno lo envie(s)?\b|\bno me lo envie(s)?\b|\bno me lo mand(e|es|en)\b|\bno lo mand(e|es|en)\b|\bme arrepenti\b|\bme he arrepentido\b|\bya no lo quiero\b|\bya no quiero\b|\bya no me interesa\b|\bno me interesa\b|\bno lo voy a recibir\b|\bno voy a aceptarlo\b|\bno acepto\b|\brechaz(o|ar|ado)\b|\bno recogere\b|\bpedido por error\b|\bme equivoque\b|\berror al pedir\b|\bno lo necesito\b|\bno hace falta\b|\bdejadlo\b|\bdejalo\b|\bdejarlo\b|\bpaso\b/.test(text)) {
    return {
      latest_chatby_event: 'TEXT_CANCEL',
      customer_message: last.content || '',
      confidence: 100,
      reason: 'El ultimo mensaje del cliente rechaza el pedido.'
    };
  }

  if (/\bcambiar datos\b|\bcambiar direccion\b|\bmodificar datos\b|\bdireccion (mal|incorrecta|equivocada)\b/.test(text)) {
    return {
      latest_chatby_event: 'TEXT_CHANGE_ADDRESS',
      customer_message: last.content || '',
      confidence: 100,
      reason: 'El ultimo mensaje del cliente pide cambio de direccion o datos.'
    };
  }

  if (/\bconfirmo\b|\bconfirmado\b|\bsi lo quiero\b|\blo quiero\b|\bvale\b|\bperfecto\b/.test(text)) {
    return {
      latest_chatby_event: 'TEXT_CONFIRM',
      customer_message: last.content || '',
      confidence: 100,
      reason: 'El ultimo mensaje del cliente confirma el pedido.'
    };
  }

  return {
    latest_chatby_event: 'UNCLEAR',
    customer_message: last.content || '',
    confidence: 50,
    reason: 'El ultimo mensaje no es inequívoco.'
  };
}

async function buildChatbyContext({ order, orderId, chatbyUserNs, customerPhone }) {
  let subscriber = null;
  let resolvedUserNs = chatbyUserNs || order?.chatbyUserNs || null;

  if (!resolvedUserNs && customerPhone) {
    subscriber = await findSubscriberForOrder({ phone: customerPhone, orderId });
    resolvedUserNs = subscriber?.user_ns || null;
  }

  if (!subscriber && resolvedUserNs) {
    subscriber = await findSubscriberForOrder({ phone: customerPhone, orderId });
  }

  const messages = resolvedUserNs ? await getChatMessages(resolvedUserNs) : [];
  const normalizedMessages = Array.isArray(messages) ? messages.map(normalizeMessage) : [];
  const latestEvent = detectLatestEvent(normalizedMessages);

  return {
    order: {
      orderId: order?.orderId || orderId,
      status: order?.status || null,
      customerName: order?.customerName || null,
      customerPhone: order?.customerPhone || customerPhone || null,
      customerEmail: order?.customerEmail || null,
      orderAmount: order?.orderAmount ?? null,
      currencyCode: order?.currencyCode || 'EUR',
      createdAt: order?.createdAt || null,
      chatbyUserNs: resolvedUserNs || null,
      aiIntent: order?.aiIntent || null,
      aiConfidence: order?.aiConfidence ?? null,
      operationalNote: order?.operationalNote || null
    },
    chatby: {
      user_ns: resolvedUserNs || null,
      subscriber: subscriber
        ? {
            user_ns: subscriber.user_ns || null,
            phone: subscriber.phone || null,
            lead_status: subscriber.lead_status || null,
            labels: subscriber.labels || [],
            tags: subscriber.tags || [],
            user_fields: subscriber.user_fields || []
          }
        : null,
      messages: normalizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.raw?.created_at || message.raw?.createdAt || null,
        raw: {
          direction: message.raw?.direction || null,
          type: message.raw?.type || null,
          message_type: message.raw?.message_type || null,
          msg_type: message.raw?.msg_type || null,
          button_text: message.raw?.button_text || message.raw?.buttonText || null
        }
      })),
      latest_customer_event: latestEvent.latest_chatby_event,
      latest_customer_message: latestEvent.customer_message,
      latest_customer_reason: latestEvent.reason,
      subscriber_confirms_order: subscriberConfirmsOrder(subscriber)
    },
    policy: {
      confirm_only_on_clear_confirm: true,
      address_change_never_confirms: true,
      simulation_default: Boolean(config.defaultStore?.agentDryRun ?? true)
    }
  };
}

async function executeApplyAction(args, store) {
  const orderId = String(args.order_id || '').trim();
  if (!orderId) throw new Error('Falta order_id.');

  const dryRun = Boolean(store.agentDryRun ?? config.defaultStore.agentDryRun);
  const current = findOrder(store.id, orderId) || (await getDropeaOrderById(orderId)) || { orderId, status: 'PENDING' };
  const action = String(args.action || 'MANUAL_REVIEW').toUpperCase();
  const noteFromAssistant = String(args.sheet_note || '').trim();
  const customerMessage = String(args.customer_message || '').trim();
  const latestEvent = String(args.latest_chatby_event || 'UNCLEAR').toUpperCase();
  const shippingAddress = String(args.shipping_address || '').trim();
  const assistantCheckedAt = new Date().toISOString();

  const basePatch = {
    ...current,
    assistantCheckedAt,
    aiConfidence: action === 'CONFIRM_ORDER' ? 100 : current.aiConfidence ?? null,
    aiIntent:
      action === 'CONFIRM_ORDER'
        ? 'CONFIRM'
        : action === 'REGISTER_ADDRESS_CHANGE'
          ? 'ADDRESS_CHANGE_REQUESTED'
          : action === 'DO_NOT_CONFIRM'
            ? 'NO_CONFIRM'
            : 'MANUAL_REVIEW'
  };

  if (action === 'CONFIRM_ORDER') {
    if (!(current.raw?.payment_method === 'SHOPIFY' || current.raw?.source === 'shopify')) {
      const delayHours = Number(store.confirmationDelayHours ?? config.defaultStore.confirmationDelayHours ?? 1) || 1;
      const startedAt = assistantCheckedAt;
      const dueAt = addHours(startedAt, delayHours);
      const updated = upsertOrder(store.id, {
        ...basePatch,
        status: 'PENDING',
        aiIntent: 'CONFIRM_DELAY_PENDING',
        confirmationDelayStartedAt: startedAt,
        confirmationDueAt: dueAt,
        confirmationSource: 'openai_assistant',
        operationalNote: noteFromAssistant || `Confirmacion detectada por asistente. El agente esperara ${delayHours}h y revisara Chatby antes de confirmar en Dropea.`
      });
      await upsertSheetRow(updated);
      return {
        action: 'confirmation_scheduled',
        dryRun: false,
        orderId,
        dueAt,
        latest_chatby_event: latestEvent,
        customer_message: customerMessage,
        source: 'openai_assistant',
        updatedOrderStatus: updated.status
      };
    }

    if (dryRun) {
      const updated = upsertOrder(store.id, {
        ...basePatch,
        status: 'MANUAL_REVIEW',
        operationalNote: noteFromAssistant || 'Simulacion: el asistente habria confirmado el pedido.'
      });
      await upsertSheetRow(updated);
      return {
        action: 'would_confirm',
        dryRun: true,
        orderId,
        latest_chatby_event: latestEvent,
        customer_message: customerMessage,
        source: 'openai_assistant',
        updatedOrderStatus: updated.status
      };
    }

    if (current.raw?.payment_method === 'SHOPIFY' || current.raw?.source === 'shopify') {
      const financialStatus = await getShopifyOrderFinancialStatus(orderId);
      if (financialStatus !== 'paid') {
        const updated = upsertOrder(store.id, {
          ...basePatch,
          status: 'MANUAL_REVIEW',
          operationalNote: noteFromAssistant || 'Pedido pendiente de pago en Shopify. No se confirma automaticamente.'
        });
        await upsertSheetRow(updated);
        return {
          action: 'manual_review_non_paid',
          dryRun: false,
          orderId,
          financialStatus,
          source: 'openai_assistant'
        };
      }

      const updated = upsertOrder(store.id, {
        ...basePatch,
        status: 'CONFIRMED',
        confirmedAt: new Date().toISOString(),
        operationalNote: noteFromAssistant || 'Pedido Shopify confirmado localmente por el asistente.'
      });
      await upsertSheetRow(updated);
      return {
        action: 'confirmed_shopify_local',
        dryRun: false,
        orderId,
        financialStatus,
        source: 'openai_assistant',
        updatedOrderStatus: updated.status
      };
    }
  }

  if (action === 'REGISTER_ADDRESS_CHANGE') {
    const defaultNote =
      'Cliente solicito cambiar datos/direccion de envio. No confirmar en Dropea hasta revisar y corregir direccion.';
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'MANUAL_REVIEW',
      operationalNote: noteFromAssistant || defaultNote
    });
    await upsertSheetRow(updated);
    return {
      action: 'address_change_registered',
      dryRun,
      orderId,
      latest_chatby_event: latestEvent,
      shipping_address: shippingAddress || null,
      source: 'openai_assistant',
      updatedOrderStatus: updated.status
    };
  }

  if (action === 'DO_NOT_CONFIRM') {
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'MANUAL_REVIEW',
      operationalNote:
        noteFromAssistant ||
        'El cliente no confirma o rechaza el pedido. No confirmar en Dropea.'
    });
    await upsertSheetRow(updated);
    return {
      action: 'not_confirmed',
      dryRun,
      orderId,
      latest_chatby_event: latestEvent,
      source: 'openai_assistant',
      updatedOrderStatus: updated.status
    };
  }

  if (action === 'WAITING_CUSTOMER') {
    const updated = upsertOrder(store.id, {
      ...basePatch,
      status: 'PENDING',
      operationalNote:
        noteFromAssistant ||
        'Pedido nuevo en espera de respuesta del cliente. El asistente ya quedo a la espera de confirmacion.'
    });
    await upsertSheetRow(updated);
    return {
      action: 'waiting_customer',
      dryRun,
      orderId,
      latest_chatby_event: latestEvent,
      source: 'openai_assistant',
      updatedOrderStatus: updated.status
    };
  }

  const updated = upsertOrder(store.id, {
    ...basePatch,
    status: 'MANUAL_REVIEW',
    operationalNote:
      noteFromAssistant ||
      'El asistente marco el pedido para revision manual por falta de certeza.'
  });
  await upsertSheetRow(updated);
  return {
    action: 'manual_review',
    dryRun,
    orderId,
    latest_chatby_event: latestEvent,
    source: 'openai_assistant',
    updatedOrderStatus: updated.status
  };
}

async function executeToolCall(toolCall, store) {
  const name = toolCall?.function?.name || '';
  const args = safeJsonParse(toolCall?.function?.arguments, {});

  if (name === 'get_chatby_order_context') {
    const orderId = String(args.order_id || '').trim();
    const order = findOrder(store.id, orderId) || (orderId ? await getDropeaOrderById(orderId) : null);
    const context = await buildChatbyContext({
      order,
      orderId,
      chatbyUserNs: args.chatby_user_ns,
      customerPhone: args.customer_phone
    });
    return { tool_call_id: toolCall.id, output: JSON.stringify(context) };
  }

  if (name === 'apply_dropea_action') {
    const result = await executeApplyAction(args, store);
    return { tool_call_id: toolCall.id, output: JSON.stringify(result) };
  }

  return {
    tool_call_id: toolCall.id,
    output: JSON.stringify({
      error: `Funcion desconocida: ${name}`
    })
  };
}

async function waitForTerminalRun(threadId, runId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    const run = await openaiRequest(`/threads/${threadId}/runs/${runId}`);
    if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
      return run;
    }

    if (run.status === 'requires_action') {
      return run;
    }

    await sleep(750);
  }

  throw new Error('El run del asistente ha excedido el tiempo de espera.');
}

async function submitToolOutputs(threadId, runId, outputs) {
  return openaiRequest(`/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
    method: 'POST',
    body: {
      tool_outputs: outputs.map((item) => ({
        tool_call_id: item.tool_call_id,
        output: item.output
      }))
    }
  });
}

async function getLastAssistantMessage(threadId) {
  const messages = await openaiRequest(`/threads/${threadId}/messages?limit=10`);
  const data = Array.isArray(messages?.data) ? messages.data : [];
  const latest = data.find((message) => message.role === 'assistant');
  if (!latest) return null;
  const content = latest.content || [];
  const text = content
    .map((item) => item?.text?.value || item?.text || '')
    .join('\n')
    .trim();
  return text || null;
}

export async function ensureOpenAIAssistantReady() {
  if (!config.openaiAssistantEnabled || !config.openaiAssistantId) {
    return { enabled: false };
  }

  const assistant = await ensureAssistantConfigured();
  return { enabled: true, assistantId: config.openaiAssistantId, model: assistant.model || config.openaiModel };
}

export async function runOpenAIAssistantAnalysis(order, store = config.defaultStore) {
  if (!config.openaiAssistantEnabled || !config.openaiAssistantId) {
    return null;
  }

  await ensureAssistantConfigured();

  const thread = await openaiRequest('/threads', {
    method: 'POST',
    body: {
      metadata: {
        store_id: String(store.id),
        order_id: String(order.orderId)
      }
    }
  });

  const userMessage = [
    'Analiza este pedido y decide la accion correcta usando las herramientas disponibles.',
    '',
    `order_id: ${order.orderId}`,
    `chatby_user_ns: ${order.chatbyUserNs || ''}`,
    `customer_phone: ${order.customerPhone || ''}`,
    `dry_run: ${Boolean(store.agentDryRun ?? config.defaultStore.agentDryRun)}`,
    '',
    'Importante:',
    '- Usa primero get_chatby_order_context.',
    '- Nunca confirmes si hay cambio de direccion.',
    '- Si el cliente confirma claramente, llama a apply_dropea_action con CONFIRM_ORDER.',
    '- Si el cliente pide cambio de direccion, usa REGISTER_ADDRESS_CHANGE.',
    '- Si el cliente rechaza o no confirma, usa DO_NOT_CONFIRM.',
    '- Si hay duda, usa MANUAL_REVIEW.'
  ].join('\n');

  await openaiRequest(`/threads/${thread.id}/messages`, {
    method: 'POST',
    body: {
      role: 'user',
      content: userMessage
    }
  });

  let run = await openaiRequest(`/threads/${thread.id}/runs`, {
    method: 'POST',
    body: {
      assistant_id: config.openaiAssistantId
    }
  });

  const toolResult = { assistant_thread_id: thread.id, assistant_run_id: run.id, source: 'openai_assistant' };

  while (true) {
    run = await waitForTerminalRun(thread.id, run.id);

    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
      const outputs = [];
      for (const toolCall of toolCalls) {
        outputs.push(await executeToolCall(toolCall, store));
      }

      const applied = outputs.find((item) => {
        const parsed = safeJsonParse(item.output, {});
        return parsed?.source === 'openai_assistant' && ['confirmed', 'would_confirm', 'address_change_registered', 'not_confirmed', 'waiting_customer', 'manual_review', 'manual_review_non_paid'].includes(parsed?.action);
      });

      if (applied) {
        const parsed = safeJsonParse(applied.output, {});
        toolResult.action = parsed.action;
        toolResult.dryRun = parsed.dryRun;
        toolResult.orderId = parsed.orderId || order.orderId;
        toolResult.analysis = {
          intent:
            parsed.action === 'confirmed' || parsed.action === 'would_confirm'
              ? 'CONFIRM'
              : parsed.action === 'address_change_registered'
                ? 'ADDRESS_CHANGE_REQUESTED'
                : parsed.action === 'waiting_customer'
                  ? 'WAITING_CUSTOMER'
                : parsed.action === 'not_confirmed'
                  ? 'CANCEL'
                  : 'UNCLEAR',
          confidence: parsed.action === 'confirmed' || parsed.action === 'would_confirm' ? 100 : 100,
          reason: 'Decision tomada por OpenAI Assistant.'
        };
        toolResult.result = parsed;
      }

      run = await submitToolOutputs(thread.id, run.id, outputs);
      continue;
    }

    break;
  }

  if (toolResult.result) {
    return toolResult.result;
  }

  const message = await getLastAssistantMessage(thread.id);
  if (message) {
    return {
      action: 'assistant_message',
      dryRun: Boolean(store.agentDryRun ?? config.defaultStore.agentDryRun),
      orderId: order.orderId,
      message,
      source: 'openai_assistant'
    };
  }

  return toolResult;
}

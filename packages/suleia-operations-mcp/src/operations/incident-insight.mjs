import { interpretChatbyCustomerReply } from '../../../platform-core/src/operational-truth/chatby-customer-instruction.mjs';

const intentLabels = {
  CONFIRM: 'El cliente confirma que quiere recibir el pedido.',
  CUSTOMER_STILL_WANTS_ORDER: 'El cliente confirma que todavía quiere recibir el pedido.',
  DELIVERY_RETRY: 'El cliente solicita un nuevo intento de entrega.',
  PICKUP_AT_AGENCY: 'El cliente solicita recoger el paquete en una agencia.',
  REJECT: 'El cliente rechaza o solicita cancelar el pedido.',
  FINAL_REJECTION: 'El cliente rechaza definitivamente el pedido.',
  RETURN_REQUEST: 'El cliente solicita la devolución.',
  ADDRESS_CHANGE: 'El cliente solicita cambiar los datos de entrega.',
  CHANGE_ADDRESS: 'El cliente facilita o solicita cambiar los datos de entrega.',
  PROVIDE_MISSING_DATA: 'El cliente aporta los datos que faltaban.',
  DISCOUNT_ACCEPTED: 'El cliente ha aceptado expresamente el descuento de 5 EUR.',
  DISCOUNT_REJECTED: 'El cliente ha rechazado expresamente el descuento.',
  PROMOTION_CHANGE: 'El cliente solicita modificar la oferta o el contenido del pedido.',
  UNCLEAR: 'La respuesta existe, pero no permite decidir con seguridad.',
  UNKNOWN: 'La intención de la respuesta no está determinada.'
};

const deliveryDayLabels = {
  MONDAY: 'el lunes', TUESDAY: 'el martes', WEDNESDAY: 'el miércoles', THURSDAY: 'el jueves',
  FRIDAY: 'el viernes', SATURDAY: 'el sábado', SUNDAY: 'el domingo'
};

function normalizedIntent(value) {
  const intent = String(value || 'UNKNOWN').toUpperCase();
  if (intent === 'CUSTOMER_STILL_WANTS_ORDER') return 'CONFIRM';
  if (['FINAL_REJECTION','RETURN_REQUEST'].includes(intent)) return 'REJECT';
  if (intent === 'CHANGE_ADDRESS') return 'ADDRESS_CHANGE';
  return intent;
}

function discountRecovery(item) {
  const observed = item.discount_recovery_response_status !== null
    && item.discount_recovery_response_status !== undefined;
  const rawStatus = String(item.discount_recovery_response_status || 'NOT_SENT').toUpperCase();
  const deliveryVerified = item.discount_delivery_verified === true;
  const qualityVerified = item.discount_signal_quality === 'VERIFIED';
  const responseVerified = qualityVerified && deliveryVerified
    && (!['DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED', 'OTHER_RESPONSE'].includes(rawStatus)
      || Boolean(item.discount_responded_at));
  const status = observed && responseVerified ? rawStatus
    : observed && rawStatus === 'NOT_SENT' && qualityVerified ? 'NOT_SENT'
      : observed ? 'NOT_VERIFIABLE' : 'NOT_AVAILABLE';
  const presentations = {
    DISCOUNT_ACCEPTED: ['Descuento aceptado', 'El cliente aceptó expresamente el descuento de 5 € después de recibir la plantilla.', 'accepted'],
    DISCOUNT_REJECTED: ['Descuento no aceptado', 'El cliente rechazó expresamente la oferta después de recibirla.', 'rejected'],
    NO_RESPONSE: ['Sin respuesta al descuento', 'La plantilla de descuento está entregada, pero el cliente aún no ha contestado.', 'waiting'],
    OTHER_RESPONSE: ['Respondió · revisar', 'El cliente contestó después de la oferta, pero no aceptó ni rechazó de forma inequívoca.', 'review'],
    NOT_SENT: ['Descuento aún no enviado', 'No existe una entrega verificada de la plantilla de descuento para esta incidencia.', 'not-sent'],
    NOT_VERIFIABLE: ['Estado no verificable', 'La evidencia disponible no permite atribuir una aceptación o rechazo con seguridad.', 'review'],
    NOT_AVAILABLE: ['Seguimiento no disponible', 'Esta incidencia todavía no tiene una observación del automatismo de descuento.', 'not-sent']
  };
  const [title, summary, tone] = presentations[status] || presentations.NOT_VERIFIABLE;
  return {
    applies: observed || item.interpreted_type === 'REFUSED_BY_RECIPIENT',
    status, title, summary, tone,
    delivery_verified: deliveryVerified,
    initial_template_sent_at: item.discount_initial_template_sent_at || null,
    due_at: item.discount_due_at || null,
    sent_at: item.discount_sent_at || null,
    responded_at: item.discount_responded_at || null,
    original_amount: item.discount_original_amount ?? null,
    discount_amount: item.discount_amount_eur ?? null,
    final_amount: item.discount_final_amount ?? null,
    cross_source_verified: item.discount_cross_source_verified === true,
    source_updated_at: item.discount_source_updated_at || null
  };
}

function customerEvidence(item) {
  const exactMessage = item.latest_customer_message || null;
  const messageAt = item.latest_private_customer_message_at || item.latest_customer_activity_at || null;
  const relation = item.latest_customer_message_relation || null;
  const privateInterpretation = exactMessage ? interpretChatbyCustomerReply({
    customerText: exactMessage,
    precedingOperatorText: item.latest_operator_message || ''
  }) : null;
  const privateIntent = normalizedIntent(privateInterpretation?.intent);
  const privateCurrentSignal = exactMessage && relation === 'AFTER_INCIDENT' && privateIntent !== 'UNKNOWN';
  if (!item.chatby_sync_current) return {
    code: 'NOT_VERIFIABLE', title: 'Chatby pendiente de actualizar',
    summary: 'La última lectura de Chatby no está vigente; no se atribuye una acción nueva al cliente.',
    messages: 0, latest_message: exactMessage, at: messageAt, relation
  };
  if (item.conversation_status === 'NONE') return {
    code: 'NO_CONVERSATION', title: 'Sin conversación exacta',
    summary: 'No se ha localizado una conversación enlazada técnicamente con este pedido. Esto no equivale a que el cliente no haya contestado.',
    messages: 0, latest_message: null, at: null, relation: null
  };
  if (item.operational_response_status === 'VALID_RESPONSE' || privateCurrentSignal) {
    const discount = discountRecovery(item);
    const fallbackIntent = privateCurrentSignal
      ? privateInterpretation.intent
      : item.customer_intent || item.latest_private_customer_intent || 'UNKNOWN';
    const fallbackNormalized = normalizedIntent(fallbackIntent);
    const rawIntent = discount.status === 'DISCOUNT_ACCEPTED'
      ? 'DISCOUNT_ACCEPTED'
      : discount.status === 'DISCOUNT_REJECTED'
        ? 'DISCOUNT_REJECTED'
        : ['DISCOUNT_ACCEPTED', 'DISCOUNT_REJECTED'].includes(fallbackNormalized)
          ? 'UNKNOWN'
          : fallbackIntent;
    const intent = normalizedIntent(rawIntent);
    const title = intent === 'CONFIRM' ? 'Cliente confirma'
      : intent === 'REJECT' ? 'Cliente rechaza'
      : intent === 'ADDRESS_CHANGE' ? 'Cliente cambia datos'
      : intent === 'PICKUP_AT_AGENCY' ? 'Cliente pide recogida en agencia'
      : intent === 'DELIVERY_RETRY' ? 'Cliente pide nueva entrega'
      : intent === 'DISCOUNT_ACCEPTED' ? 'Descuento de 5 € aceptado'
      : intent === 'DISCOUNT_REJECTED' ? 'Descuento rechazado' : 'Cliente respondió';
    return {
      code: intent, raw_intent: rawIntent, title,
      summary: item.interpretation_summary || intentLabels[rawIntent] || intentLabels[intent] || intentLabels.UNKNOWN,
      messages: Number(item.messages_used || 0), latest_message: exactMessage,
      at: messageAt, relation: relation || 'AFTER_INCIDENT',
      delivery_instruction: privateInterpretation?.delivery || null,
      address_instruction: privateInterpretation?.address || null,
      interpretation_basis: privateInterpretation?.interpretation_basis || null
    };
  }
  if (item.conversation_status === 'FOUND') {
    if (exactMessage && relation === 'BEFORE_INCIDENT') return {
      code: 'NO_VALID_RESPONSE', title: 'Sin respuesta nueva a la incidencia',
      summary: 'Existe una conversación exacta, pero el último mensaje del cliente es anterior a esta incidencia.',
      messages: 0, latest_message: exactMessage, at: messageAt, relation
    };
    if (exactMessage) return {
      code: 'UNCLEAR', title: 'Respondió sin una instrucción concluyente',
      summary: 'Hay un mensaje posterior asociado al pedido, pero no permite resolver la incidencia de forma segura.',
      messages: Number(item.messages_used || 0), latest_message: exactMessage, at: messageAt,
      relation: relation || 'AFTER_INCIDENT'
    };
    return {
      code: 'NO_VALID_RESPONSE', title: 'No ha contestado a esta incidencia',
      summary: 'La conversación está asociada correctamente, pero no hay ningún mensaje entrante del cliente posterior a la incidencia.',
      messages: 0, latest_message: null, at: null, relation: null
    };
  }
  return {
    code: 'NOT_VERIFIABLE', title: 'Respuesta no verificable',
    summary: 'No existe evidencia suficiente para atribuir una acción al cliente.',
    messages: 0, latest_message: exactMessage, at: messageAt, relation
  };
}

function option(item, ...preferred) {
  const allowed = new Set(item.allowed_resolution_options || []);
  return preferred.find((value) => allowed.has(value)) || null;
}

function proposal(code, title, summary, resolutionOption, steps, confidence = 'MEDIUM', details = {}) {
  return { code, title, summary, resolution_option: resolutionOption,
    steps, confidence, external_action_required: true, ...details };
}

function recommendation(item, customer) {
  const description = String(item.initial_carrier_description_sanitized || '');
  const secondAttempt = /SEGUNDA\s+VEZ|SEGUNDO\s+INTENTO/i.test(description)
    || Number(item.delivery_attempt_number || 0) >= 2;
  const mentionsTomorrow = /\bMA[NÑ]ANA\b/i.test(description);
  if (customer.code === 'DISCOUNT_ACCEPTED') return proposal(
    'APPLY_ACCEPTED_DISCOUNT_AND_REDELIVER', 'Cliente ha aceptado el descuento de 5 €',
    'La respuesta posterior y asociada a esta incidencia acepta expresamente la oferta. Debe aplicarse una sola vez un descuento máximo de 5 € y gestionarse una nueva entrega.',
    option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
    ['Verificar que la aceptación pertenece a este pedido y es posterior a la oferta', 'Comprobar que el descuento no se aplicó anteriormente', 'Aplicar exactamente 5 € sin superar el total del pedido', 'Trasladar a Dropea la nueva entrega y verificar que la incidencia sale de la cola'],
    'HIGH', {
      decision_goal: 'RECOVER_REJECTED_DELIVERY_WITH_ACCEPTED_FIXED_DISCOUNT',
      reasoning: 'El cliente ha revocado el rechazo al aceptar de forma explícita la oferta comercial vinculada a esta incidencia.',
      guardrail: 'No aplicar más de 5 €, no repetir el descuento y no actuar si la respuesta pertenece a otro pedido.'
    });
  if (customer.code === 'DISCOUNT_REJECTED') return proposal(
    'RETURN_AFTER_DISCOUNT_REJECTION', 'Solicitar devolución tras rechazar la oferta',
    'El cliente ha rechazado expresamente el descuento; no corresponde insistir con otra oferta ni programar una nueva entrega.',
    option(item, 'RETURN_REQUESTED'),
    ['Verificar que el rechazo corresponde a esta incidencia', 'No enviar más descuentos', 'Seleccionar RETURN_REQUESTED', 'Comprobar la salida de la cola pendiente'], 'HIGH');
  if (!item.dropea_sync_current) return proposal(
    'REFRESH_DROPEA_SOURCE', 'Actualizar Dropea antes de resolver',
    'La incidencia no tiene una lectura vigente. La solución queda bloqueada hasta confirmar que sigue pendiente.',
    null, ['Actualizar la cola pendiente', 'Confirmar que esta incidencia continúa activa', 'Recalcular con la lectura nueva'], 'BLOCKED');
  if (!item.interpreted_type || ['UNKNOWN','UNMAPPED'].includes(item.interpreted_type)) return proposal(
    'CLASSIFY_INCIDENT', 'Clasificar el motivo real',
    'Dropea no aporta una tipología interpretable; hace falta identificar el problema antes de elegir una resolución.',
    null, ['Revisar el motivo original', 'Contrastar el código del transportista', 'Asignar la tipología correcta'], 'REVIEW');
  if (customer.code === 'NO_CONVERSATION') return proposal(
    'LINK_CHATBY_CONVERSATION', 'Vincular la conversación correcta y contactar al cliente',
    'No hay evidencia de Chatby asociada con exactitud. La solución inmediata es localizar el chat del pedido y solicitar la información necesaria.',
    option(item, 'MANAGED_BY_CLIENT'), ['Buscar por el ID Dropea exacto', 'Validar identidad y fecha del chat', 'Enviar la consulta adecuada al motivo de la incidencia'], 'REVIEW');

  if (item.interpreted_type === 'RECIPIENT_ABSENT') {
    if (customer.code === 'REJECT') return proposal(
      'RETURN_AFTER_REJECTION', 'Solicitar devolución del paquete',
      'El cliente rechaza el pedido; no corresponde programar otro intento de entrega.',
      option(item, 'RETURN_REQUESTED'), ['Verificar que el rechazo corresponde a este pedido', 'Seleccionar RETURN_REQUESTED', 'Comprobar que Dropea lo retira de incidencias pendientes'], 'HIGH');
    if (customer.code === 'PICKUP_AT_AGENCY') return proposal(
      'PICKUP_AT_AGENCY', 'Gestionar recogida en agencia',
      'El cliente solicita recoger el paquete. Debe usarse el punto verificado por el transportista.',
      option(item, 'PICKUP_AT_AGENCY'), ['Validar que el paquete admite recogida', 'Confirmar agencia y plazo de custodia', 'Seleccionar PICKUP_AT_AGENCY'], 'HIGH');
    if (customer.code === 'DELIVERY_RETRY' && customer.delivery_instruction?.requested_day === 'NEXT_DAY') {
      const callBeforeDelivery = customer.delivery_instruction.call_before_delivery || Boolean(item.customer_phone);
      const window = customer.delivery_instruction.requested_window === 'MORNING_OR_AFTERNOON'
        ? 'en la franja de mañana o tarde indicada por el cliente'
        : customer.delivery_instruction.requested_window === 'MORNING' ? 'por la mañana'
          : customer.delivery_instruction.requested_window === 'AFTERNOON' ? 'por la tarde' : 'en la franja acordada';
      const callInstruction = callBeforeDelivery
        ? ' y solicita una llamada antes de la entrega' : '';
      return proposal(
        'NOTIFY_DROPEA_NEXT_DAY_DELIVERY', 'Notificar a Dropea la entrega al día siguiente',
        `El cliente confirma que quiere recibir el pedido al día siguiente ${window}${callInstruction}.`,
        option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
        ['Seleccionar PROVIDE_SOLUTION en Dropea', `Indicar entrega al día siguiente ${window}`,
          callBeforeDelivery ? 'Indicar que deben llamar al teléfono del pedido antes de entregar' : 'Registrar la franja acordada',
          'Verificar que la incidencia sale de la cola pendiente'],
        'HIGH', { customer_instruction: {
          requested_day: 'NEXT_DAY', requested_window: customer.delivery_instruction.requested_window,
          call_before_delivery: callBeforeDelivery,
          callback_phone_available: Boolean(item.customer_phone)
        } });
    }
    if (customer.code === 'DELIVERY_RETRY' && customer.delivery_instruction?.requested_day) {
      const requestedDay = customer.delivery_instruction.requested_day;
      const day = deliveryDayLabels[requestedDay] || 'en la fecha indicada por el cliente';
      const window = customer.delivery_instruction.requested_window === 'MORNING_OR_AFTERNOON'
        ? 'en horario de mañana o tarde'
        : customer.delivery_instruction.requested_window === 'MORNING' ? 'por la mañana'
          : customer.delivery_instruction.requested_window === 'AFTERNOON' ? 'por la tarde' : 'en la franja indicada';
      return proposal(
        'NOTIFY_DROPEA_SCHEDULED_DELIVERY', `Notificar a Dropea la entrega ${day}`,
        `El cliente ha indicado de forma verificable que puede recibir el pedido ${day} ${window}.`,
        option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
        ['Comprobar que la fecha indicada sigue siendo operativamente viable', `Seleccionar PROVIDE_SOLUTION e indicar entrega ${day} ${window}`, 'Confirmar al cliente que la instrucción se ha trasladado', 'Verificar que la incidencia sale de la cola'],
        'HIGH', {
          decision_goal: 'COMPLETE_DELIVERY_IN_CUSTOMER_CONFIRMED_SLOT',
          reasoning: 'La ausencia deja de ser un bloqueo cuando el cliente aporta una disponibilidad concreta y posterior a la incidencia.',
          guardrail: 'No prometer la fecha si el transportista no la admite o si el mensaje es anterior a la incidencia.',
          customer_instruction: { ...customer.delivery_instruction }
        });
    }
    if (['CONFIRM','DELIVERY_RETRY'].includes(customer.code)) return proposal(
      secondAttempt ? 'FINAL_REDELIVERY_REVIEW' : 'SCHEDULE_REDELIVERY',
      secondAttempt ? 'Preparar un último reintento con revisión' : 'Pactar un nuevo intento de entrega',
      secondAttempt
        ? 'El cliente quiere recibirlo, pero Dropea registra una segunda ausencia; el nuevo intento requiere confirmar disponibilidad y revisión humana.'
        : 'El cliente quiere recibirlo. Debe acordarse una fecha operativa y registrar la solución permitida en Dropea.',
      option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
      ['Confirmar fecha o franja disponible', 'Validar el reintento con GLS', 'Registrar la solución y verificar la salida de la cola'],
      secondAttempt ? 'REVIEW' : 'HIGH');
    if (secondAttempt) return proposal(
      'OFFER_PICKUP_THEN_RETURN', 'Ofrecer recogida en agencia; si no responde, devolver',
      'Dropea registra una segunda ausencia y el cliente aún no ha contestado. No conviene prometer otro reparto sin disponibilidad confirmada.',
      option(item, 'MANAGED_BY_CLIENT'),
      ['Contactar al cliente ofreciendo recogida o disponibilidad concreta', 'Esperar la respuesta dentro del plazo operativo', 'Sin respuesta, seleccionar RETURN_REQUESTED'], 'MEDIUM');
    return proposal(
      mentionsTomorrow ? 'VERIFY_TOMORROW_REDELIVERY' : 'REQUEST_REDELIVERY_AVAILABILITY',
      mentionsTomorrow ? 'Verificar la entrega indicada para mañana' : 'Pactar un reintento; sin respuesta, solicitar devolución',
      mentionsTomorrow
        ? 'La anotación de Dropea menciona mañana, pero el cliente no lo ha confirmado en Chatby. Debe validarse antes de registrar la solución.'
        : 'Es una primera ausencia sin respuesta posterior. La solución es obtener disponibilidad y, si vence el plazo sin respuesta, devolver el paquete.',
      option(item, 'MANAGED_BY_CLIENT'),
      ['Solicitar fecha o franja de disponibilidad', 'Validar que GLS admite el reintento', 'Si no responde en 48 h, seleccionar RETURN_REQUESTED'], 'MEDIUM');
  }

  if (item.interpreted_type === 'ADDRESS_INCORRECT') {
    if (customer.code === 'ADDRESS_CHANGE' && (customer.address_instruction?.complete || customer.address_instruction?.actionable_correction)) return proposal(
      'PROVIDE_CORRECTED_ADDRESS_TO_DROPEA', 'Trasladar a Dropea la dirección facilitada por el cliente',
      customer.address_instruction.complete
        ? 'El cliente ha contestado después de la incidencia con una dirección completa. La propuesta usa literalmente esos datos y no completa ningún campo por suposición.'
        : 'El cliente ha aportado después de la incidencia una corrección accionable de vía y número, portal, piso o puerta. Se conserva literalmente y no se inventan código postal ni localidad.',
      option(item, 'PROVIDE_SOLUTION'),
      ['Confirmar que la respuesta pertenece a este pedido y es posterior a la incidencia', 'Comparar la corrección con la dirección actual sin sustituir datos no mencionados', 'Seleccionar PROVIDE_SOLUTION y trasladar literalmente la indicación', 'Añadir la llamada previa al teléfono del pedido', 'Verificar que Dropea saca la incidencia de la cola'], 'HIGH', {
        decision_goal: 'RESTORE_DELIVERABILITY_WITH_VERIFIED_ADDRESS',
        reasoning: 'La causa logística es una dirección inválida y el cliente ha aportado datos nuevos en respuesta a la solicitud exacta.',
        guardrail: 'No cerrar la incidencia si los datos pertenecen a otro pedido o Dropea no confirma que ha guardado la corrección.',
        prepared_dropea_solution: {
          resolution_option: 'PROVIDE_SOLUTION',
          source: 'CHATBY_CUSTOMER_MESSAGE_AFTER_INCIDENT',
          address: customer.address_instruction,
          customer_message_at: customer.at,
          execution_status: 'READY_FOR_GOVERNED_AUTOMATION'
        }
      });
    if (customer.code === 'ADDRESS_CHANGE' && customer.address_instruction?.has_address_data) return proposal(
      'REQUEST_MISSING_ADDRESS_FIELDS', 'Completar los datos de dirección que faltan',
      `El cliente ha aportado parte de la dirección, pero faltan: ${customer.address_instruction.missing_fields.join(', ')}. No debe enviarse una dirección incompleta a Dropea.`,
      option(item, 'MANAGED_BY_CLIENT'),
      ['Conservar literalmente los datos ya aportados', 'Solicitar únicamente los campos que faltan', 'Validar la respuesta posterior', 'Después, recalcular la propuesta para Dropea'], 'MEDIUM', {
        decision_goal: 'COMPLETE_ADDRESS_BEFORE_DROPEA_UPDATE',
        reasoning: 'La respuesta del cliente es relevante, pero no contiene todavía todos los campos mínimos de entrega.',
        guardrail: 'No inventar localidad, código postal, vía ni número a partir de la dirección anterior.',
        prepared_dropea_solution: {
          resolution_option: null,
          source: 'CHATBY_CUSTOMER_MESSAGE_AFTER_INCIDENT',
          address: customer.address_instruction,
          customer_message_at: customer.at,
          execution_status: 'BLOCKED_INCOMPLETE_ADDRESS'
        }
      });
    return proposal(
      'REQUEST_COMPLETE_ADDRESS', 'Solicitar y validar la dirección completa',
      'Dropea marca la dirección como incorrecta y Chatby no contiene una corrección posterior. Deben pedirse los datos exactos antes de resolver.',
      option(item, 'MANAGED_BY_CLIENT'),
      ['Indicar al cliente qué dato necesita corrección', 'Obtener vía, número, localidad y código postal', 'Validar y registrar la solución en Dropea'], 'MEDIUM');
  }

  if (item.interpreted_type === 'PENDING_DATA') return proposal(
    'REQUEST_MISSING_DATA', customer.code === 'PROVIDE_MISSING_DATA' ? 'Validar los datos aportados y resolver' : 'Solicitar los datos concretos que faltan',
    customer.code === 'PROVIDE_MISSING_DATA'
      ? 'El cliente ha facilitado información; debe contrastarse con el requisito de Dropea antes de marcar la solución.'
      : 'Dropea indica que faltan datos y no hay una respuesta posterior del cliente. La incidencia debe mantenerse gestionada con el cliente.',
    option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
    customer.code === 'PROVIDE_MISSING_DATA'
      ? ['Comprobar el dato recibido', 'Validar formato y coherencia', 'Seleccionar PROVIDE_SOLUTION']
      : ['Identificar el dato exigido por Dropea', 'Solicitarlo al cliente', 'Validarlo antes de seleccionar PROVIDE_SOLUTION'],
    customer.code === 'PROVIDE_MISSING_DATA' ? 'HIGH' : 'MEDIUM');

  if (item.interpreted_type === 'REFUSED_BY_RECIPIENT') {
    if (['CONFIRM','DELIVERY_RETRY'].includes(customer.code)) return proposal(
      'RECOVER_DELIVERY_AFTER_REFUSAL', 'Recuperar la entrega tras la nueva aceptación del cliente',
      'El transportista registró un rechazo, pero el cliente ha confirmado después y de forma verificable que sí quiere recibir este pedido. La evidencia más reciente sustituye al rechazo anterior.',
      option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
      ['Comprobar que la respuesta corresponde al pedido y es posterior a la incidencia', 'Acordar una fecha o franja viable', 'Seleccionar PROVIDE_SOLUTION y trasladar literalmente la disponibilidad', 'Verificar que la incidencia sale de la cola'],
      'HIGH', {
        decision_goal: 'RECOVER_DELIVERY_AFTER_PRIOR_REFUSAL',
        reasoning: 'Una aceptación posterior, fresca y exacta cambia la decisión; no se devuelve un pedido que el cliente aún quiere recibir.',
        guardrail: 'Sin aceptación posterior verificable, mantener la devolución como propuesta y exigir revisión.'
      });
    return proposal(
      'RETURN_AFTER_REJECTION', 'Solicitar devolución salvo aceptación posterior verificable',
      customer.code === 'REJECT'
        ? 'El cliente confirma el rechazo; insistir en otro reparto aumentaría coste y riesgo de un nuevo rechazo.'
        : 'Dropea registra rechazo y no existe una aceptación posterior verificable del cliente.',
      option(item, 'RETURN_REQUESTED'),
      ['Confirmar que el rechazo pertenece a este pedido', 'Comprobar que no existe una aceptación posterior', 'Seleccionar RETURN_REQUESTED', 'Verificar la salida de la cola'],
      'HIGH', {
        decision_goal: 'STOP_UNWANTED_DELIVERY_AND_RETURN',
        reasoning: 'El rechazo vigente prevalece mientras el cliente no lo revoque con una señal nueva y exacta.',
        guardrail: 'Si el cliente revoca el rechazo después, recalcular y proponer recuperación de la entrega.'
      });
  }
  if (customer.code === 'REJECT') return proposal(
    'RETURN_AFTER_REJECTION', 'Solicitar devolución del paquete',
    'El cliente rechaza el pedido; no corresponde programar otro intento de entrega.',
    option(item, 'RETURN_REQUESTED'), ['Verificar que el rechazo corresponde a este pedido', 'Seleccionar RETURN_REQUESTED', 'Comprobar que Dropea lo retira de incidencias pendientes'], 'HIGH');

  if (['DAMAGED_PACKAGE','LOST_PACKAGE','CUSTOMS_ISSUE'].includes(item.interpreted_type)) return proposal(
    'ESCALATE_CARRIER_INCIDENT', 'Escalar la incidencia al transportista',
    'El motivo requiere evidencia logística y no debe resolverse únicamente con una respuesta del cliente.',
    null, ['Revisar tracking y documentación del transportista', 'Confirmar responsabilidad y estado', 'Aplicar la resolución admitida por Dropea'], 'REVIEW');

  return proposal(
    'MANAGE_SPECIFIC_INCIDENT', 'Gestionar la incidencia con la opción permitida',
    `Dropea identifica ${String(item.interpreted_type).toLowerCase().replaceAll('_',' ')}. La propuesta debe validarse con la evidencia del pedido antes de cerrar.`,
    option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT','RETURN_REQUESTED'),
    ['Revisar el motivo y la descripción de Dropea', 'Contrastar la última evidencia del cliente', 'Aplicar la opción permitida y verificar el resultado'], 'REVIEW');
}

export function incidentInsight(item) {
  const discount = discountRecovery(item);
  const customer = customerEvidence(item);
  const proposed = recommendation(item, customer);
  const existingStatus = String(item.operational_action_status || item.external_action_status || '').toUpperCase();
  const handlingStatus = existingStatus && existingStatus !== 'NOT_EXECUTED'
    ? existingStatus
    : item.is_active !== true || item.status !== 'PENDING'
      ? 'CLOSED_OUTSIDE_PENDING_QUEUE'
      : proposed.code === 'PROVIDE_CORRECTED_ADDRESS_TO_DROPEA'
        ? 'READY_FOR_ADDRESS_AUTOMATION'
        : customer.code === 'NO_VALID_RESPONSE' || customer.code === 'NO_CONVERSATION'
          ? 'MANUAL_REVIEW_NO_RESPONSE'
          : 'MANUAL_REVIEW';
  return {
    ...item,
    customer_evidence: customer,
    discount_recovery: discount,
    tailored_recommendation: proposed,
    source_truth: item.is_active && item.status === 'PENDING' ? 'PENDING_IN_DROPEA' : 'NOT_PENDING_IN_DROPEA',
    external_action_status: existingStatus || 'NOT_EXECUTED',
    handling_status: handlingStatus
  };
}

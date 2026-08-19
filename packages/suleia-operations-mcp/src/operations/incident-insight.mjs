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
  PROMOTION_CHANGE: 'El cliente solicita modificar la oferta o el contenido del pedido.',
  UNCLEAR: 'La respuesta existe, pero no permite decidir con seguridad.',
  UNKNOWN: 'La intención de la respuesta no está determinada.'
};

function normalizedIntent(value) {
  const intent = String(value || 'UNKNOWN').toUpperCase();
  if (intent === 'CUSTOMER_STILL_WANTS_ORDER') return 'CONFIRM';
  if (['FINAL_REJECTION','RETURN_REQUEST'].includes(intent)) return 'REJECT';
  if (intent === 'CHANGE_ADDRESS') return 'ADDRESS_CHANGE';
  return intent;
}

function customerEvidence(item) {
  const exactMessage = item.latest_customer_message || null;
  const messageAt = item.latest_private_customer_message_at || item.latest_customer_activity_at || null;
  const relation = item.latest_customer_message_relation || null;
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
  if (item.operational_response_status === 'VALID_RESPONSE') {
    const rawIntent = item.customer_intent || item.latest_private_customer_intent || 'UNKNOWN';
    const intent = normalizedIntent(rawIntent);
    const title = intent === 'CONFIRM' ? 'Cliente confirma'
      : intent === 'REJECT' ? 'Cliente rechaza'
      : intent === 'ADDRESS_CHANGE' ? 'Cliente cambia datos'
      : intent === 'PICKUP_AT_AGENCY' ? 'Cliente pide recogida en agencia'
      : intent === 'DELIVERY_RETRY' ? 'Cliente pide nueva entrega' : 'Cliente respondió';
    return {
      code: intent, raw_intent: rawIntent, title,
      summary: item.interpretation_summary || intentLabels[rawIntent] || intentLabels[intent] || intentLabels.UNKNOWN,
      messages: Number(item.messages_used || 0), latest_message: exactMessage,
      at: messageAt, relation: relation || 'AFTER_INCIDENT'
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

function proposal(code, title, summary, resolutionOption, steps, confidence = 'MEDIUM') {
  return { code, title, summary, resolution_option: resolutionOption,
    steps, confidence, external_action_required: true };
}

function recommendation(item, customer) {
  const description = String(item.initial_carrier_description_sanitized || '');
  const secondAttempt = /SEGUNDA\s+VEZ|SEGUNDO\s+INTENTO/i.test(description)
    || Number(item.delivery_attempt_number || 0) >= 2;
  const mentionsTomorrow = /\bMA[NÑ]ANA\b/i.test(description);
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
    if (customer.code === 'ADDRESS_CHANGE') return proposal(
      'VALIDATE_NEW_ADDRESS', 'Corregir la dirección con los datos del cliente',
      'El cliente ha aportado un cambio de dirección; debe validarse código postal, localidad, vía y número antes de enviarlo a Dropea.',
      option(item, 'PROVIDE_SOLUTION','MANAGED_BY_CLIENT'),
      ['Comparar la respuesta con la dirección actual', 'Validar código postal y localidad', 'Registrar la dirección corregida y verificar la incidencia'], 'HIGH');
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

  if (item.interpreted_type === 'REFUSED_BY_RECIPIENT' || customer.code === 'REJECT') return proposal(
    'REVIEW_REJECTION', 'Devolver el paquete salvo nueva aceptación explícita',
    'La evidencia indica rechazo; no debe reintentarse la entrega sin una confirmación nueva y verificable.',
    option(item, 'RETURN_REQUESTED'), ['Confirmar el rechazo del pedido correcto', 'Validar el estado logístico', 'Seleccionar RETURN_REQUESTED'], 'HIGH');

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
  const customer = customerEvidence(item);
  const proposed = recommendation(item, customer);
  return {
    ...item,
    customer_evidence: customer,
    tailored_recommendation: proposed,
    source_truth: item.is_active && item.status === 'PENDING' ? 'PENDING_IN_DROPEA' : 'NOT_PENDING_IN_DROPEA',
    external_action_status: 'NOT_EXECUTED'
  };
}

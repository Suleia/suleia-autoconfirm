const intentLabels = {
  CONFIRM: 'El cliente confirma que quiere recibir el pedido.',
  REJECT: 'El cliente rechaza o solicita cancelar el pedido.',
  ADDRESS_CHANGE: 'El cliente solicita cambiar los datos de entrega.',
  PROMOTION_CHANGE: 'El cliente solicita modificar la oferta o el contenido del pedido.',
  UNCLEAR: 'La respuesta existe, pero no permite decidir con seguridad.',
  UNKNOWN: 'La intención de la respuesta no está determinada.'
};

function customerEvidence(item) {
  if (!item.chatby_sync_current) return {
    code: 'NOT_VERIFIABLE', title: 'Chatby no verificable',
    summary: 'La lectura de Chatby no está vigente; no se atribuye ninguna acción al cliente.', messages: 0
  };
  if (item.conversation_status === 'NONE') return {
    code: 'NO_CONVERSATION', title: 'Sin conversación asociada',
    summary: 'No hay una conversación enlazada exactamente con este pedido. Esto no equivale a que el cliente no haya contestado.', messages: 0
  };
  if (item.operational_response_status === 'VALID_RESPONSE') {
    const intent = item.customer_intent || 'UNKNOWN';
    return {
      code: intent, title: intent === 'CONFIRM' ? 'Cliente confirma' : intent === 'REJECT' ? 'Cliente rechaza' : intent === 'ADDRESS_CHANGE' ? 'Cliente cambia datos' : 'Cliente respondió',
      summary: item.interpretation_summary || intentLabels[intent] || intentLabels.UNKNOWN,
      messages: Number(item.messages_used || 0), at: item.latest_customer_activity_at || null
    };
  }
  if (item.conversation_status === 'FOUND') return {
    code: 'NO_VALID_RESPONSE', title: 'Sin acción válida del cliente',
    summary: Number(item.messages_used || 0) > 0
      ? 'Hay actividad asociada, pero no contiene una instrucción inequívoca para esta incidencia.'
      : 'La conversación está asociada al pedido, pero no hay mensajes entrantes válidos posteriores a la incidencia.',
    messages: Number(item.messages_used || 0)
  };
  return { code: 'NOT_VERIFIABLE', title: 'Respuesta no verificable', summary: 'No existe evidencia suficiente para atribuir una acción al cliente.', messages: 0 };
}

function recommendation(item, customer) {
  if (!item.dropea_sync_current) return {
    code: 'REFRESH_DROPEA_SOURCE', title: 'Actualizar estado en Dropea',
    summary: 'No proponer una resolución hasta obtener una lectura vigente de la incidencia.',
    steps: ['Actualizar la cola pendiente de Dropea', 'Confirmar que la incidencia sigue activa', 'Recalcular la propuesta con la evidencia vigente'], confidence: 'BLOCKED'
  };
  if (item.mapping_status === 'UNMAPPED' || item.interpreted_type === 'UNKNOWN') return {
    code: 'CLASSIFY_INCIDENT', title: 'Clasificar antes de actuar',
    summary: 'El tipo no está gobernado con suficiente precisión; cualquier solución concreta sería una suposición.',
    steps: ['Revisar el tipo y la descripción originales de Dropea', 'Validar el código del transportista', 'Asignar una tipología antes de resolver'], confidence: 'REVIEW'
  };
  if (customer.code === 'NO_CONVERSATION') return {
    code: 'LINK_CHATBY_CONVERSATION', title: 'Localizar la conversación de este pedido',
    summary: 'La prioridad es obtener evidencia exacta del cliente; no debe asumirse que no respondió.',
    steps: ['Buscar por el ID exacto del pedido en Chatby', 'Validar que la conversación sea posterior a la incidencia', 'Recalcular la solución con los mensajes asociados'], confidence: 'REVIEW'
  };
  if (item.interpreted_type === 'ADDRESS_INCORRECT') {
    if (customer.code === 'ADDRESS_CHANGE') return {
      code: 'VALIDATE_NEW_ADDRESS', title: 'Validar los nuevos datos de entrega',
      summary: 'El cliente ha enviado un cambio de datos para una incidencia de dirección.',
      steps: ['Comparar dirección y código postal con la respuesta del cliente', 'Validar compatibilidad logística', 'Preparar la corrección para aprobación humana'], confidence: 'HIGH'
    };
    return {
      code: 'REQUEST_COMPLETE_ADDRESS', title: 'Obtener o validar la dirección completa',
      summary: customer.code === 'CONFIRM' ? 'El cliente confirma el pedido, pero la incidencia de dirección sigue sin una corrección verificable.' : 'Faltan datos válidos del cliente para corregir la dirección.',
      steps: ['Identificar el dato señalado por Dropea', 'Solicitar o localizar el dato exacto', 'Validar la dirección antes de proponer cualquier actualización'], confidence: 'MEDIUM'
    };
  }
  if (item.interpreted_type === 'RECIPIENT_ABSENT') return customer.code === 'CONFIRM'
    ? { code: 'PROPOSE_REDELIVERY', title: 'Preparar una nueva entrega', summary: 'El cliente confirma recepción tras una ausencia.', steps: ['Verificar disponibilidad indicada', 'Validar la opción permitida por Dropea', 'Preparar reintento para aprobación'], confidence: 'HIGH' }
    : { code: 'CONFIRM_DELIVERY_AVAILABILITY', title: 'Confirmar disponibilidad de entrega', summary: 'No hay una disponibilidad inequívoca para programar otro intento.', steps: ['Revisar la última respuesta válida', 'Obtener fecha o franja de disponibilidad', 'Validar el reintento permitido'], confidence: 'MEDIUM' };
  if (item.interpreted_type === 'REFUSED_BY_RECIPIENT' || customer.code === 'REJECT') return {
    code: 'REVIEW_REJECTION', title: 'Revisar rechazo y retorno',
    summary: 'La evidencia indica rechazo; no debe programarse otro envío sin una nueva aceptación explícita.',
    steps: ['Confirmar que el rechazo corresponde a este pedido', 'Validar el estado logístico actual', 'Preparar cancelación o retorno para aprobación'], confidence: customer.code === 'REJECT' ? 'HIGH' : 'MEDIUM'
  };
  return {
    code: customer.code === 'NO_VALID_RESPONSE' ? 'WAIT_FOR_CUSTOMER' : 'REVIEW_INCIDENT_CONTEXT',
    title: customer.code === 'NO_VALID_RESPONSE' ? 'Esperar una acción válida del cliente' : 'Revisar el contexto de la incidencia',
    summary: customer.code === 'NO_VALID_RESPONSE' ? 'No existe una instrucción verificable del cliente para resolver esta incidencia.' : 'La propuesta requiere combinar el motivo exacto de Dropea con la evidencia asociada.',
    steps: ['Revisar descripción y estado actuales', 'Contrastar la conversación exacta del pedido', 'Preparar una solución compatible con las opciones permitidas'], confidence: 'REVIEW'
  };
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

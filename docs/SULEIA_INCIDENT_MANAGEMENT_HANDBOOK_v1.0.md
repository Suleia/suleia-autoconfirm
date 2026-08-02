# SULEIA INCIDENT MANAGEMENT HANDBOOK
## Manual funcional y técnico para Codex
### Versión 1.0 — Simulación, entrenamiento y solo lectura

**Estado:** especificación canónica inicial
**Sistema:** Suleia Operations Platform sobre VPS
**Transportista operativo:** GLS
**Fuente logística principal:** Dropea Public API V2
**Fuente conversacional principal:** Chatby
**Modo obligatorio:** `SHADOW_READ_ONLY` + `SIMULATION_ONLY`
**Escrituras y acciones externas autorizadas:** ninguna

---

## 0. Mandato de implementación

Implementa este documento como contrato funcional y técnico del módulo de incidencias de Suleia.

La entrega debe leer datos reales del espejo privado del VPS, correlacionar Dropea V2 con Chatby, aplicar las reglas operativas de GLS, interpretar la intención actual del cliente, calcular qué haría Suleia, registrar una decisión simulada y mostrarla en Operations Center y mediante las ocho herramientas MCP existentes.

No se enviará nada a Dropea, Chatby, GLS, Shopify, Releasit, correo electrónico ni ningún tercero. No debe existir ningún botón, endpoint o cliente activable capaz de ejecutar la propuesta.

No modificar la semántica de los agentes actuales de confirmación y cancelación de producción. No usar OpenAI API, IA externa ni modelos locales.

---

# 1. Objetivo operativo

Para cada incidencia real el sistema debe responder:

1. Qué ocurrió según Dropea.
2. Si la incidencia sigue pendiente y activa.
3. Qué resoluciones admite Dropea para ese caso.
4. Qué contexto operativo aplica según GLS.
5. Qué dijo realmente el cliente en Chatby.
6. Cuál es su intención vigente y si cambió.
7. Qué información falta o se contradice.
8. Qué política de Suleia aplica.
9. Qué decisión tomaría Suleia.
10. Qué acción simularía.
11. Qué bloqueos impiden considerarla segura.
12. Cuándo debe reevaluarse.

La complejidad debe quedar encapsulada dentro del `Incident Processor`; no crear agentes, servicios o bases independientes por tipología.

---

# 2. Arquitectura y responsabilidades

```text
Dropea V2 + webhooks entrantes ─┐
                                │
Chatby + eventos entrantes ─────┼──> Event Store
                                │         ↓
Reglas GLS ─────────────────────┘   Digital Twin
                                          ↓
                                  Incident Processor
                                          ↓
                         Interpretación + Policy + Risk + QA
                                          ↓
                               Simulated Decision Record
                                  ┌───────┴────────┐
                                  ↓                ↓
                           Operations Center      MCP
```

## Dropea aporta
Pedidos, estados, subestados, incidencias, tipos, actividad, resoluciones permitidas, códigos, textos del carrier, pickup point, timestamps, webhooks y resultados observados.

## Chatby aporta
Mensajes inbound/outbound, botones, plantillas, timestamps, conversación, intención, fechas, franjas, dirección, rechazo, aceptación, cambio de opinión y aceptación del descuento.

## GLS aporta
Intentos, segundo intento tras primer ausente, posible tercer intento, días laborables, corte de las 17:00, retención, agencia, recanalización, restricciones de horario y llamada, y proceso de cambio de reembolso.

## Suleia decide
Esperar, solicitar datos, proponer retry, cambio de dirección, agencia, retorno, descuento, revisión humana o simple observación. En esta fase todo queda en simulación.

---

# 3. Modo estricto de simulación

```env
APP_ENV=staging
RUN_MODE=SHADOW_READ_ONLY
SIMULATION_ONLY=true
REAL_DATA_READ_ENABLED=true
REAL_DATA_WRITE_ENABLED=false

DROPEA_READ_ENABLED=true
DROPEA_WRITE_ENABLED=false
DROPEA_MUTATION_CLIENT_ENABLED=false
CHATBY_READ_ENABLED=true
CHATBY_WRITE_ENABLED=false
GLS_WRITE_ENABLED=false

INCIDENT_INTERPRETATION_ENABLED=true
INCIDENT_DECISION_ENABLED=true
INCIDENT_SIMULATION_ENABLED=true

ISSUE_RESOLUTION_ENABLED=false
ORDER_CONFIRMATION_ENABLED=false
ORDER_CANCELLATION_ENABLED=false
RETURN_EXECUTION_ENABLED=false
ADDRESS_UPDATE_ENABLED=false
CUSTOMER_MESSAGES_ENABLED=false
TEMPLATE_SENDING_ENABLED=false
DISCOUNT_SENDING_ENABLED=false
EMAIL_SENDING_ENABLED=false
ACTION_EXECUTOR_ENABLED=false
PRODUCTION_WRITES_ENABLED=false

OPENAI_API_ENABLED=false
EXTERNAL_AI_CALLS_ENABLED=false
LOCAL_LLM_ENABLED=false
```

Invariantes:

```text
ACTIONS_EXECUTED=0
DROPEA_WRITE_REQUESTS=0
CHATBY_WRITE_REQUESTS=0
GLS_WRITE_REQUESTS=0
ISSUES_RESOLVED=0
ORDERS_CONFIRMED=0
ORDERS_CANCELLED=0
RETURNS_REQUESTED=0
ADDRESSES_UPDATED=0
MESSAGES_SENT=0
TEMPLATES_SENT=0
EMAILS_SENT=0
DISCOUNTS_APPLIED=0
PRODUCTION_WRITES=0
OPENAI_API_CALLS=0
OPENAI_API_COST=0_EUR
NEW_RECURRING_COST=0_EUR
```

Cualquier prueba que altere un contador debe fallar.
# 4. Contrato Dropea Public API V2

Versionar la especificación OpenAPI vigente:

```text
contracts/external/dropea/public-api-v2/<version>/openapi.json
```

Registrar versión, checksum SHA-256, origen, mercado, base URL, fecha, paths, operaciones, schemas, enums, scopes y diferencias con legacy.

Generar una matriz automática por operación:

```text
operation_id
method
path
scope
request_schema
response_schema
pagination
idempotency
async_behavior
errors
suleia_mode
canonical_target
implemented
verified_live
```

No inventar nombres de endpoints, campos o scopes. La especificación prevalece para tipos, nulabilidad y contrato externo. Las políticas de este manual prevalecen para la decisión interna.

En esta fase se implementan solo lecturas: pedidos, pedido individual, incidencias, incidencia individual, incidencias por pedido, pendientes, catálogos, estados, operaciones y salud read-only disponible.

Las mutaciones deben quedar solo documentadas como capacidades externas; no construir clientes invocables para confirmar, cancelar, actualizar, resolver ni registrar webhooks.

## Webhooks entrantes

Eventos previstos:

```text
order.created
order.status.changed
order.cancelled
issue.created
issue.status.changed
issue.resolved
```

Codex puede implementar el receptor si la suscripción ya existe, pero no crear/modificar/eliminar suscripciones.

El receptor debe validar body crudo, tamaño, Content-Type, HMAC, topic, event ID, mercado, schema y replay; deduplicar por `event_id`; persistir un evento seguro; responder 2xx rápido; y procesar asíncronamente.

Campos mínimos:

```text
topic
market
event_id
event_at
resource_id
resource_type
payload_hash
signature_valid
received_at
processing_status
processing_attempts
processed_at
failure_reason
```

---

# 5. Modelo de datos canónico

## 5.1 Pedido

Entidad lógica `canonical_orders`:

```text
canonical_order_id
dropea_order_id
external_order_id
store_id
status
sub_status
lifecycle_status
line_items
canonical_product_keys
product_summary
total_amount
currency
payment_method
carrier
service_type
tracking_reference_masked
created_at
updated_at
confirmed_at
processing_at
delivered_at
rejected_at
identity_status
source_version
schema_version
data_freshness
observed_at
payload_hash
record_version
```

Mantener `status`, `sub_status` y `lifecycle_status` separados. No mostrar estados Shopify en Operations Center.

## 5.2 Incidencia

Entidad lógica `canonical_incidents`:

```text
canonical_issue_id
dropea_issue_id
canonical_order_id
dropea_order_id
carrier
tracking_reference_masked
type
raw_type
mapping_status
status
is_active
resolution_status
resolution_data
allowed_resolution_options
initial_carrier_code
initial_carrier_description_sanitized
initial_carrier_substatus_code
pickup_point
created_at
updated_at
resolution_changed_at
resolved_at
delivery_attempt_number
carrier_retention_deadline
source_event_id
source_version
schema_version
data_freshness
observed_at
payload_hash
record_version
```

No fusionar `type`, `status`, `is_active`, `resolution_status` y `allowed_resolution_options`.

## 5.3 Unknown enum

```text
raw_type=<valor externo>
type=UNKNOWN
mapping_status=UNMAPPED
human_review=true
schema_drift_alert=true
```

Nunca mapear silenciosamente a `GENERAL_INCIDENCE`.

## 5.4 Identidad

Estados:

```text
EXACT
VERIFIED
PARTIAL
UNKNOWN
CONFLICTING
```

Solo `EXACT` y `VERIFIED` permiten una simulación plenamente accionable. No unir por nombre, dirección, importe, producto o coincidencias aproximadas.
# 6. Conversation Intelligence de Chatby

Reutilizar la lógica determinista existente; no reemplazarla por palabras clave ni IA externa.

## Eventos

Tabla sugerida `chatby_conversation_events`:

```text
chatby_conversation_id
chatby_contact_id
chatby_message_id
canonical_order_id
canonical_issue_id
direction
message_type
template_id
button_payload
sanitized_text
created_at
ingested_at
source_event_id
incident_version
relevance_status
intent
intent_confidence
superseded_by
payload_hash
```

Solo mensajes inbound y botones confirmados pueden modificar la intención. Plantillas, mensajes salientes y eventos técnicos no cuentan como respuesta.

## Read model de interpretación

`operations_incident_interpretation`:

```text
order_id
issue_id
issue_type
delivery_attempt
has_customer_replied
latest_inbound_message_at
latest_relevant_message_at
latest_relevant_message_sanitized
customer_wants_order
customer_intent
previous_intents
intent_changed
contradiction
requested_date
requested_time_window
requested_detail
requested_address
pickup_requested
return_requested
discount_accepted
discount_rejected
conversation_quality
interpretation_confidence
interpretation_summary
messages_used
messages_ignored
missing_information
freshness
created_at
updated_at
```

## Intent timeline

`incident_intent_timeline`:

```text
intent_id
canonical_issue_id
canonical_order_id
message_id
detected_at
detected_intent
confidence
contradiction
supersedes_intent_id
relevant_to_issue_version
summary
```

Conservar el histórico y usar la intención vigente más reciente.

Intenciones mínimas:

```text
DELIVERY_RETRY
DELIVERY_RETRY_ON_DATE
DELIVERY_RETRY_MORNING
DELIVERY_RETRY_AFTERNOON
DELIVERY_RETRY_EVENING
CHANGE_ADDRESS
PROVIDE_MISSING_DATA
PICKUP_AT_AGENCY
RETURN_REQUEST
FINAL_REJECTION
CUSTOMER_STILL_WANTS_ORDER
ACCIDENTAL_REFUSAL
NO_RESPONSE
DISCOUNT_ACCEPTED
DISCOUNT_REJECTED
INSPECT_BEFORE_PAYMENT
UNDECIDED
CONTRADICTORY
UNKNOWN
```
# 7. Reglas operativas GLS

Versionar estas políticas:

```text
GLS-01 Entregas ordinarias de lunes a viernes, no festivos.
GLS-02 Corte operativo: 17:00 Europe/Madrid.
GLS-03 Tras el corte no se garantiza el siguiente día.
GLS-04 Viernes tras las 17:00: gestión desde lunes y reparto posterior.
GLS-05 No prometer reparto el mismo día de la incidencia.
GLS-06 La llamada previa no está garantizada.
GLS-07 Primer ausente puede generar segundo intento automático.
GLS-08 Cambiar la fecha del segundo intento automático requiere gestión especial.
GLS-09 Máximo habitual dos intentos; tercero depende de agencia.
GLS-10 Rechazo inicial no genera nuevo reparto automático.
GLS-11 Reintento tras rechazo exige evidencia de aceptación.
GLS-12 Retención orientativa: 10 días naturales.
GLS-13 Cambio de reembolso: coordinación y al menos 48 horas hábiles.
GLS-14 Inspección antes del pago no permitida.
GLS-15 “MAL DOCUMENTADO” recanalizado: observar, no contactar.
GLS-16 Agencia/dirección/horario solo con evidencia.
GLS-17 Preferencia horaria no es garantía.
GLS-18 Comprobar is_active antes de decidir.
```

La guía también indica que con distancia a agencia superior a 15 km no debe ofrecerse un momento específico. Si el dato no existe, marcar `UNKNOWN`; nunca inferir.

Implementar:

```text
gls_delivery_feasibility(issue, requested_date, requested_time_window, attempt_number, now)
```

Salida:

```text
feasible
earliest_operational_date
business_day
cutoff_passed
automatic_attempt_expected
specific_time_allowed
requires_special_handling
reason_codes
```

---

# 8. Proceso canónico

```text
issue.created
  ↓
HMAC + event_id
  ↓
Persistir evento seguro
  ↓
Leer Issue completo
  ↓
¿PENDING e is_active=true?
  ├─ no → registrar y reconciliar
  └─ sí
       ↓
Clasificar type e intento
       ↓
Leer allowed_resolution_options
       ↓
Consultar Chatby vigente
       ↓
Interpretar intención
       ↓
¿Respuesta válida?
  ├─ sí → extraer hechos
  └─ no → iniciar/continuar timer
       ↓
Aplicar política Suleia
       ↓
Validar GLS
       ↓
Validar resolución permitida
       ↓
Risk + QA
       ↓
Generar simulated_action
       ↓
Registrar versión
       ↓
Operations Center + MCP
       ↓
Reconciliación
       ↓
actions_executed=0
```
# 9. Simulación y memoria de decisiones

Tabla `incident_simulation_decisions`:

```text
simulation_id
canonical_issue_id
canonical_order_id
issue_version
source_event_id
dropea_snapshot_at
chatby_snapshot_at
policy_version
connector_version
issue_type
delivery_attempt_number
customer_has_replied
customer_intent
interpretation_summary
facts_used
facts_ignored
allowed_resolution_options
gls_feasibility
simulated_decision
simulated_action
missing_data
blocking_reasons
risk
confidence
qa_status
human_review
timer_status
execution_available
external_write_attempted
actions_executed
created_at
superseded_at
```

Obligatorio:

```text
execution_available=false
external_write_attempted=false
actions_executed=0
```

Cada cambio relevante crea una versión; no sobrescribir.

Ejemplo:

```json
{
  "mode": "SIMULATION_ONLY",
  "decision": "CHANGE_ADDRESS",
  "simulated_action": {
    "action_type": "DROPEA_ISSUE_CHANGE_ADDRESS",
    "target_system": "DROPEA",
    "would_require_resolution": "CHANGE_ADDRESS",
    "normalized_parameters": {
      "street": "Calle Mayor 18",
      "address_line_2": "2.º B",
      "postal_code": "28013",
      "city": "Madrid",
      "state": "Madrid",
      "country": "ES"
    }
  },
  "execution_available": false,
  "external_write_attempted": false,
  "actions_executed": 0
}
```

La propuesta solo es `ACTIONABLE_IN_SIMULATION` si la resolución aparece en `allowed_resolution_options`. Si no, `BLOCKED` + revisión.
# 10. Política por tipología

## 10.1 Primer ausente

Identificación:

```text
type=RECIPIENT_ABSENT
delivery_attempt_number=1
```

Objetivo: no duplicar ni interferir con el segundo intento automático.

- Cliente disponible en el siguiente día hábil: `OBSERVE_AUTOMATIC_RETRY` o `RETRY` simulado si Dropea requiere solución y lo permite.
- “A partir de las 15:00”: `requested_time_window=afternoon`; no prometer hora.
- Fecha distinta al intento automático: `SPECIAL_RESCHEDULING_REVIEW`.
- No pudo coger llamada: no es rechazo; intención `DELIVERY_RETRY`.
- Pide agencia: solo si está permitida, identificada y disponible.
- Rechazo explícito: `RETURN_REQUESTED` simulado; sin descuento.
- No responde: timer 48h. Tras releer todo:
  - no expedido: `SIMULATED_CANCEL`;
  - expedido y no entregado: `SIMULATED_RETURN_REQUESTED`.
- No bloquear teléfono hasta observar `RETURN_TO_ORIGIN_COMPLETED`.

## 10.2 Segundo ausente

Identificación:

```text
type=RECIPIENT_ABSENT
delivery_attempt_number=2
```

Prioridad:

```text
1. PICKUP_AT_AGENCY
2. RETRY excepcional
3. RETURN_REQUESTED
```

- Agencia: solo con opción, punto y disponibilidad.
- Tercer intento: `RECOVERY_EXCEPTION`, siempre revisión; nunca automático.
- Rechazo: retorno simulado, sin descuento.
- No respuesta 48h: retorno simulado tras reconciliación.
- Descuento no aplica.

## 10.3 No acepta mercancía

Identificación:

```text
type=REFUSED_BY_RECIPIENT
```

Clasificar: `FINAL_REJECTION`, `ACCIDENTAL_REFUSAL`, `CUSTOMER_STILL_WANTS_ORDER`, `LOGISTICS_PROBLEM`, `MISUNDERSTANDING`, `UNDECIDED`, `NO_RESPONSE`.

- Rechazo explícito: retorno simulado, sin descuento.
- Cliente sí lo quiere: guardar evidencia y simular retry/agencia/solución según opciones y GLS; sin descuento.
- Respuesta ambigua: solicitar aclaración simulada; sin descuento.
- Única condición de descuento: ninguna respuesta inbound válida durante 48h, incidencia activa, pedido recuperable, oferta no enviada y retorno reversible.
- Descuento fijo y máximo: **5,00 €**.
- Nunca descuento para otra tipología, antes de 48h, si respondió, si rechazó o por importe distinto.
- Acepta descuento: simular `EMAIL_PREPARED → AWAITING_COD_CHANGE → READY_FOR_RETRY`; no enviar ni modificar.
- Rechaza descuento: retorno simulado.
- No responde tras oferta: segundo timer 48h y retorno simulado.

## 10.4 Dirección incorrecta

Identificación:

```text
type=ADDRESS_INCORRECT
```

Dirección mínima: calle/número, complemento, CP, ciudad, provincia y país ISO-2.

- Completa y vigente: simular `CHANGE_ADDRESS` si está permitido y pasa QA.
- Incompleta: `REQUEST_MISSING_ADDRESS_DATA`; indicar campos.
- Contradictoria: usar la última solo si invalida explícitamente la anterior; si no, revisión.
- Dice que la dirección es correcta: registrar referencia útil, sin sustituir datos obligatorios.
- “MAL DOCUMENTADO” recanalizado: `OBSERVE_CARRIER_RECHANNELING`.
- No respuesta 48h:
  - no expedido: cancelación simulada;
  - expedido: retorno simulado.
- Bloqueo telefónico solo al observar retorno completado.

## 10.5 Pending Data / Faltan datos

Subtipos:

```text
ADDRESS_COMPONENT
PHONE
POSTAL_CODE
CITY
REFERENCE
AUTHORIZATION
UNKNOWN
```

- Dato de dirección: validar y simular cambio.
- Otro dato: pedir solo ese dato.
- Solución libre: solo simulada y si está permitida.
- Desconocido: revisión.
- No respuesta 48h: cancelar simulado si no expedido; retorno simulado si expedido.

## 10.6 Possible Return

No equivale a retorno completado. Leer tracking, historial y Chatby. Recuperar solo si reversible; retorno si no quiere; timer si no responde. Nunca cerrar por el mero tipo.

## 10.7 Return Requested

Separar:

```text
RETURN_REQUESTED
RETURN_IN_TRANSIT
RETURN_TO_ORIGIN_COMPLETED
```

Cambio de opinión: no revertir automáticamente. Solo el retorno completado hace terminal el pedido y habilita simulaciones posteriores de limpieza/bloqueo.

## 10.8 Pickup at Agency

Distinguir:

```text
PICKUP_ALLOWED
PICKUP_POINT_IDENTIFIED
PACKAGE_AVAILABLE
```

Prioridad de fuentes: Dropea, tracking GLS, fuente oficial GLS España, revisión. Nunca inventar.

## 10.9 Delivery Failed

Subclasificar: `ABSENCE_LIKE`, `ADDRESS_LIKE`, `REFUSAL_LIKE`, `CARRIER_OPERATIONAL`, `UNKNOWN`. Aplicar política solo con subclasificación fiable.

## 10.10 Administrative Issue

Por defecto `OBSERVE_AND_RECONCILE`; no contactar salvo petición concreta o estancamiento.

## 10.11 Pending Authorization

Determinar quién autoriza. Por defecto revisión.

## 10.12 Retained

Determinar causa. Proponer solo con causa inequívoca.

## 10.13 Customs Issue

Siempre revisión y dependencia externa; no retry automático.

## 10.14 Damaged Package

Revisión; no retry automático. Registrar daño, recepción, rechazo, evidencia y proveedor.

## 10.15 Lost Package

Riesgo crítico, revisión, cancelar timers de cliente innecesarios, sin descuento.

## 10.16 General Incidence

Analizar código, texto, subestado, opciones y tracking. Sin mapeo: `UNKNOWN_ISSUE`.

## 10.17 Info

Registrar y actualizar timeline; sin timer ni cola operativa.

## 10.18 Managing with Client

No modificar Dropea. Usar estados internos:

```text
CONTACTING_CUSTOMER
WAITING_CUSTOMER_RESPONSE
CUSTOMER_RESPONDED
SOLUTION_READY
```
# 11. Timers

Tabla `incident_timers`.

Tipos:

```text
CUSTOMER_INITIAL_RESPONSE_48H
CUSTOMER_DISCOUNT_RESPONSE_48H
DROPEA_CONFIRMATION_WAIT
COD_CHANGE_WAIT
RETURN_COMPLETION_WAIT
OPERATION_VERIFICATION
RECONCILIATION
GLS_RETENTION_DEADLINE
```

Campos:

```text
timer_id
canonical_order_id
canonical_issue_id
issue_version
source_event_id
timer_type
started_at
due_at
status
policy_version
superseded_by
created_at
updated_at
```

Cancelar/superseder cuando responda el cliente, cambie la incidencia, `is_active=false`, se entregue, comience retorno o llegue un evento posterior. Sin duplicados.

---

# 12. Operations Center

Totalmente read-only. Sin botones de ejecución.

Mostrar siempre:

```text
MODO SIMULACIÓN
NO SE HA ENVIADO NADA
ACCIONES EJECUTADAS: 0
```

## Cola

Solo `status=PENDING AND is_active=true`.

Columnas:

```text
Pedido
Incidencia
Tipo
Intento
Antigüedad
Cliente respondió
Última respuesta
Intención
Resoluciones permitidas
Decisión simulada
Timer
Riesgo
Prioridad
Descuento
Frescura
Revisión
```

Orden: CRITICAL, HIGH, timer vencido, retención próxima, cliente respondió, lista para resolver, más antigua.

## Detalle: una pantalla, una decisión

### Dropea/GLS
IDs, tipo, estado, actividad, carrier, descripción, intento, opciones, pickup, fechas, corte, fecha viable y retención.

### Chatby
Respuesta, mensajes relevantes, inbound/outbound, botones, intención, cambios, contradicciones, fecha, franja, dirección y confianza.

### Interpretación Suleia
Hechos usados/ignorados, intención vigente, resumen, calidad y datos faltantes.

### Decision Card
Decisión simulada, `simulated_action`, política, opción permitida, viabilidad GLS, Risk, QA, bloqueos, revisión y acciones=0.

### Timeline
Eventos, incidencia, mensajes, timers, interpretaciones, decisiones y reconciliación.

### Descuento
Solo visible para `REFUSED_BY_RECIPIENT`.

Read models:

```text
operations_incidents_summary
operations_incidents_queue
operations_incident_detail
operations_incident_interpretation
operations_incident_decision_card
operations_incident_timeline
operations_incident_discount_workflow
operations_connector_health
operations_data_freshness
```

---

# 13. MCP

Mantener exactamente ocho tools. No añadir.

Apuntar el runtime a read models reales y enmascarados del VPS, nunca fixtures.

Podrá devolver tipo, intención, resumen, decisión simulada, acción simulada, opciones, viabilidad, timer, riesgo, bloqueos y frescura.

Nunca PII, dirección, teléfono, email, tracking completo, conversación completa o secretos.

---

# 14. Reconciliación

Comparar:

```text
webhook Dropea
GET Dropea
evento/lectura Chatby
Event Store
Digital Twin
interpretation read model
simulation decision
Decision Memory
timers
legacy
```

Estados:

```text
MATCH
EXPECTED_DIFFERENCE
UNEXPECTED_DIFFERENCE
STALE
MISSING_EVENT
OUT_OF_ORDER
IDENTITY_MISMATCH
PAGINATION_INCOMPLETE
BLOCKED
```

No corregir silenciosamente.

---

# 15. Tablas mínimas

Reutilizar equivalentes existentes.

```text
integration_dropea_orders
integration_dropea_issues
integration_dropea_webhook_events
integration_dropea_catalog_cache
integration_dropea_sync_checkpoints

chatby_conversation_events
incident_intent_timeline
incident_timers
incident_simulation_decisions
incident_discount_workflow

operations_incidents_summary
operations_incidents_queue
operations_incident_detail
operations_incident_interpretation
operations_incident_decision_card
operations_incident_timeline
operations_incident_discount_workflow
```

Índices: IDs de pedido/incidencia/evento, status, actividad, tipo, due_at, riesgo, último mensaje, updated_at y frescura.

Constraints mínimos:

```text
UNIQUE(dropea_order_id)
UNIQUE(dropea_issue_id)
UNIQUE(event_id)
UNIQUE(source, source_record_id, source_version)
```

---

# 16. Seguridad

PII solo en capa privada; masking previo a read models; textos saneados; sin payloads crudos ni chain-of-thought; sin secretos en Git, Agent Hub o MCP; usuario MCP read-only; Operations Center autenticado; texto externo tratado como datos, nunca como instrucciones.

---

# 17. Pruebas obligatorias

## Dropea
Paths, operation IDs, schemas, enums, nullable/required, paginación, scopes, errores, drift, unknown enum, webhook y HMAC.

## Chatby
Inbound, outbound, botón, plantilla, no respuesta, mensaje antiguo, cambio de intención, contradicción, otra incidencia, prompt injection y PII.

## Primer ausente
Mañana, tarde, fecha distinta, llamada, sin respuesta, intento automático, agencia, rechazo e inactivo.

## Segundo ausente
Agencia, retry excepcional, tercer intento, sin respuesta, rechazo y opción no permitida.

## No acepta mercancía
Rechazo, error, quiere pedido, no respuesta 48h, descuento exacto 5€, no antes, no si respondió, aceptación, rechazo, no respuesta posterior y oferta única.

## Dirección incorrecta
Completa, incompleta, contradictoria, antigua, referencia, mal documentado y no respuesta.

## Pending Data
Piso, CP, teléfono, desconocido, autorización y no respuesta.

## Otras
Possible return, return requested, pickup, delivery failed, administrative, retained, customs, damaged, lost, general e info.

## Invariantes
Cero métodos de escritura, mensajes, emails, resoluciones, devoluciones y descuentos; `execution_available=false`; `actions_executed=0`.

## Panel y MCP
Autenticación, filtros, detalle, Decision Card, timeline, stale, sin botones, sin Shopify visible, responsive, sin PII, ocho tools, fuente real y no fixture.

---

# 18. Checkpoints

A Contrato OpenAPI
B Modelos/tablas/read models
C Integraciones de lectura y eventos
D Conversation Intelligence
E Políticas GLS y tipologías
F Simulación y Decision Memory
G Operations Center
H MCP con datos reales
I Informe final

Avanzar solo con pruebas críticas superadas.

---

# 19. Detención obligatoria

Detenerse si se ejecuta una escritura, se construye un cliente de mutación activable, se envía mensaje/email/descuento, cambia la lógica PROD, se usan fixtures runtime, aparece PII/secreto, falla HMAC, se propone opción no permitida, se promete fecha no viable, se inventa agencia, falla un golden test, aparece coste o se necesita OpenAI API/SaaS nuevo.

---

# 20. Informe final

Entregar: OpenAPI/checksum, operaciones/campos/enums, unknown enums, tablas/índices/constraints, datos reales leídos, eventos Dropea/Chatby, reglas GLS, políticas implementadas, timers, interpretación, simulaciones, descuento, panel/URL/autenticación, MCP/fuente/fixtures, PII, pruebas/golden tests, rendimiento/recursos, commits/push, acciones y writes (todos cero), riesgos y próxima recomendación.

---

# 21. Criterios de aceptación

- Dropea V2 mapeada y validada en lectura.
- Chatby aporta contexto real y vigente.
- Cada incidencia real genera interpretación y simulación versionadas.
- Reglas GLS aplicadas.
- Descuento solo en `REFUSED_BY_RECIPIENT` sin respuesta 48h y siempre 5€.
- Operations Center explica qué pasó, qué dijo el cliente y qué haría Suleia.
- MCP muestra la misma realidad enmascarada.
- Confirmación/cancelación PROD intactas.
- Ningún endpoint, botón o cliente permite ejecutar.
- Todos los contadores de escritura permanecen en cero.

---

# 22. Fuentes oficiales

- Dropea, gestión de incidencias:
  https://support.dropea.com/portal/es/kb/articles/6-gestiona-tus-incidencias

- Dropea, reglas y recomendaciones GLS:
  https://support.dropea.com/portal/es/kb/articles/tips-para-gestionar-y-resolver-incidencias-de-gls

- Dropea, nuevo intento de entrega:
  https://support.dropea.com/portal/es/kb/articles/el-pedido-tuvo-una-incidencia-como-puedo-solicitar-un-nuevo-intento-de-entrega

- Dropea Public API:
  https://public-api.dropea.com/dropshipper/docs

Las reglas específicas de TIPSA quedan excluidas. La OpenAPI versionada prevalece para el contrato técnico; este manual prevalece para la política interna. Esta versión define exclusivamente simulación y entrenamiento.

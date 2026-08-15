# Integridad del panel de incidencias — 2026-08-14

## Alcance y puerta de seguridad

Estado objetivo: `NO_GO` productivo, `SHADOW_READ_ONLY`, `simulation_only=true`,
`actions_executed=0`, `production_writes=0`. El cambio solo añade lecturas,
proyecciones derivadas, pruebas y metadatos de build. No habilita el Action
Executor ni realiza llamadas a OpenAI o mutaciones en Dropea, GLS, Chatby o
Shopify. GLS es el único transportista operativo; TIPSA continúa fuera de
alcance (`NOT_APPLICABLE/DEPRECATED`).

Baseline reproducido por el MCP privado antes de editar (medición 2026-08-14):

- La consulta canónica `status='PENDING' AND is_active=true` devolvió 3 filas.
- El resumen legacy devolvía `pending=0` porque contaba `actionable`, no la cola.
- Los agregados de respuesta, riesgo, bloqueo y caducidad no limitaban el
  conjunto a la cola activa.
- Chatby estaba `STALE`; `FOUND` se exponía como si fuese respuesta del cliente.
- Un poll reciente ocultaba eventos Dropea antiguos.
- Los timers almacenados como `ACTIVE`, aunque vencidos, se mostraban activos.
- Los `Date` devueltos por `pg` se convertían en `{}` durante el enmascarado PII.
- Revisión y rama desplegadas no eran demostrables (`UNKNOWN`).

Las cifras son evidencia fechada, no constantes ni fixtures.

## Matriz de procedencia de campos

Consumidor común: vista `read_models.operations_incident_panel_context`, API
`GET /api/operations/incidents` y `GET /api/operations/incidents/:id`, MCP
`search_incidents/get_incident`, frontend `rowIncident/openDetail`. Todos los
ejemplos están enmascarados.

| Campo mostrado | Canónico | Fuente y ruta/columna observada | Transformación y fallback | Estado | Prueba contractual |
|---|---|---|---|---|---|
| ID incidencia | `canonical_issue_id` | Dropea `issue.id` + pedido canónico → `operations_incident_records.canonical_issue_id` | `stableId`; búsqueda acepta canónico o Dropea; nunca parámetro ambiguo | VERIFIED | `incident-panel-integrity-contract` |
| ID incidencia Dropea | `dropea_issue_id` | JSON `issue.id` → `operations_incident_records.dropea_issue_id` | `String`; ejemplo `1230***` | VERIFIED | mapper + búsqueda MCP |
| ID pedido | `canonical_order_id` | correlación técnica del pedido → columna homónima | resolución explícita canónico/Dropea | VERIFIED | consultas timers/decisiones |
| ID pedido Dropea | `dropea_order_id` | JSON `issue.order_id` | `String|null`; ejemplo `1323***` | VERIFIED | mapper |
| Mercado/tienda | `market`,`store_id` | contexto de poll → columnas homónimas | mayúsculas/String; falta → no correlacionar | VERIFIED | mapper |
| Identidad | `identity_status` | `operations_order_records.identity_status` | no exacta/verificada → revisión | VERIFIED | vista central |
| Estado/actividad | `status`,`is_active` | JSON `issue.status`,`issue.is_active` | cola exacta `PENDING AND true` | VERIFIED | migración 017 + builder compartido |
| Fechas/edad | `created_at`,`updated_at`,`age_seconds` | JSON `issue.created_at`,`issue.updated_at` | ISO UTC; edad calculada en lectura; inválido → `null` | VERIFIED | `timestamp-serialization` |
| Resolución/capacidad | `resolution_status`,`capability_status`,`allowed_resolution_options` | JSON `issue.resolution_status`,`issue.allowed_resolution_options` | capacidad `DECLARED/NOT_DECLARED`; ausente → lista vacía | VERIFIED | mapper + proyector |
| Transportista | `carrier` | JSON `issue.carrier` / pedido correlacionado | mayúsculas; solo GLS es operativo | VERIFIED | mapper |
| Código GLS | `initial_carrier_code` | JSON `issue.initial_carrier_code` | texto técnico saneado; no se mapea globalmente `-30` | VERIFIED | test prohíbe constante `-30` |
| Subestado GLS | `initial_carrier_substatus_code` | JSON homónimo | texto técnico saneado; ausente → `null` | VERIFIED | mapper |
| Descripción GLS | `initial_carrier_description_sanitized` | JSON `issue.initial_carrier_description` | saneado máximo 300; sin PII | VERIFIED | mapper |
| Tipo fuente | `raw_type` | JSON `issue.type` | mayúsculas, preservado aunque no haya mapping | VERIFIED | mapper |
| Mapping gobernado | `normalized_type`,`mapping_status` | registro `carrier_issue_code_registry` + mapper DI/NAM | solo mapping observado/gobernado; desconocido → `UNMAPPED` | VERIFIED | mapper + migración 017 |
| Interpretación prudente | `interpreted_type`,`interpretation_source` | `normalized_type`, después `raw_type` | `ADDRESS_INCORRECT` puede mostrarse sin afirmar mapping de `-30` | VERIFIED | migración 017 |
| Intento entrega | `delivery_attempt_number` | columna proyectada; la API Dropea actual no lo aporta de forma fiable | ausencia → `UNKNOWN`; no inferir | PARTIAL | proyector |
| Conversación localizada | `conversation_status` | `chatby_conversation_links.conversation_status` | `FOUND` solo significa enlace; UI “Conversación localizada” | VERIFIED | migración 013 + panel contract |
| Causa/identidad conversación | `conversation_reason`,`conversation_identity_method` | `reason_code`,`identity_method` | se conserva causa técnica; ausencia → `UNKNOWN` | VERIFIED | vista central |
| Snapshot/version Chatby | `conversation_snapshot_at`,`conversation_source_version` | `observed_at`,`conversation_source_version` | ISO UTC/null | VERIFIED | timestamp contract |
| Frescura Chatby | `conversation_freshness` | link + `core.source_freshness` | `STALE/UNAVAILABLE/UNKNOWN` → evidencia `NOT_VERIFIABLE` | VERIFIED | migración 017 |
| Actividad cliente/Suleia | `latest_customer_activity_at`,`latest_suleia_activity_at` | timestamps del link | ISO UTC/null; no texto ni PII | VERIFIED | timestamp contract |
| Respuesta válida | `customer_replied_after_issue`,`response_evidence_status` | link + interpretación + frescura | válida solo con fuente vigente, posterior y `messages_used>0`; stale → `NOT_VERIFIABLE` | VERIFIED | migración 017 |
| Intención/botón | `customer_intent`,`last_button_intent` | interpretación y link Chatby | sin evidencia válida → UI “NO VERIFICABLE” | VERIFIED | panel contract |
| Mensajes/evidencia | `messages_used`,`messages_ignored`,`interpretation_summary`,`contradiction` | `operations_incident_interpretations` | sin mensajes válidos no produce confianza de intención | VERIFIED | migración 017 |
| Confianza enlace | `evidence_classification_confidence` | clasificación del link | independiente de intención | VERIFIED | migración 017 |
| Confianza intención | `customer_intent_confidence` | `interpretation_confidence` | solo con respuesta válida y Chatby fresco; si no, `null` | VERIFIED | migración 017 |
| Confianza mapping | `mapping_confidence` | mapping gobernado | solo mapeado/verificado; si no, `null` | VERIFIED | migración 017 |
| Timer ID/tipo | `timer_id`,`timer_type` | `operations.incident_timers` | último timer por incidencia | VERIFIED | migración 017 |
| Inicio/vencimiento | `timer_started_at`,`timer_due_at` | `started_at`,`due_at` | ISO UTC/null | VERIFIED | timestamp contract |
| Estado almacenado | `stored_timer_status` | `incident_timers.status` | se conserva para auditoría | VERIFIED | migración 017 |
| Estado efectivo | `effective_timer_status`,`overdue_seconds` | estado + `due_at` + `now()` | `ACTIVE` vencido → `EXPIRED`; ninguna escritura | VERIFIED | migración 017 + MCP timer query |
| Política timer | `policy_version` | `incident_timers.policy_version` / decisión | versionada; ausencia → `null` | VERIFIED | vista central |
| Decisión | `current_decision_id`,`simulated_decision`,`simulated_action_type`,`decided_at` | `incident_simulation_decisions` | último registro, sin ejecutar | VERIFIED | migración 017 |
| Vigencia decisión | `decision_record_status` | `superseded_at`, `source_event_id`, `issue_version` | `CURRENT/SUPERSEDED/HISTORICAL/NOT_AVAILABLE`; un preview no materializado se declara aparte | VERIFIED | migración 017 |
| Bloqueo/explicación | `effective_blocking_reasons`,`reason_summary` | decisión + carencias derivadas | causas específicas; nunca solo `UNKNOWN_ISSUE_TYPE` | VERIFIED | migración 017 |
| Riesgo/QA/revisión | `effective_risk`,`effective_qa_status`,`effective_human_review` | última simulación contrastada con `source_event_id`, `issue_version` y `superseded_at` | solo se promueve cuando `decision_record_status=CURRENT`; los campos sin prefijo quedan como histórico auditor | VERIFIED | migración 017 + builder compartido |
| Política ID | `policy_id` | `operations_incident_records.policy_id` | si falta: `POLICY_NOT_PERSISTED`; no se inventa | BROKEN | migración 017 |
| Hash entrada/política | `input_snapshot_hash`,`policy_snapshot_hash` | no existen columnas observadas | se devuelve `null`; no fabricar hash con otra semántica | UNAVAILABLE | contrato de vista |
| Supersede explícito | `supersedes_decision_id` | esquema actual solo tiene `superseded_at` | `null`; requiere migración de ledger futura | UNAVAILABLE | contrato de vista |
| Propuesta segura | `conditional_proposal`,`external_action_status` | tipo interpretado + evidencia disponible | propuesta condicionada; siempre `NOT_EXECUTED` | VERIFIED | migración/panel contract |
| Observación/evento/ingesta/sync | `source_observed_at`,`source_event_at`,`ingested_at`,`last_successful_sync_at` | `operations_data_freshness` | timestamps separados ISO UTC/null | VERIFIED | migración 016/017 |
| Edades/lag/umbral | `poll_age_seconds`,`source_event_age_seconds`,`ingestion_lag_seconds`,`freshness_threshold_seconds` | timestamps anteriores | calculados independientemente | VERIFIED | freshness tests |
| Frescura efectiva | `effective_freshness_status`,`freshness_reason` | Dropea + Chatby requeridos | peor fuente requerida; poll reciente no tapa evento viejo | VERIFIED | `freshness.test.mjs` |

## Hallazgo, causa, corrección y evidencia

| Hallazgo | Causa raíz | Corrección | Evidencia |
|---|---|---|---|
| Pendientes 0 frente a 3 activos | resumen contaba `actionable` sobre todo el histórico | predicado canónico y mismo builder para tarjetas/tabla | migración 017 + contrato API |
| 329 históricos como espera actual | agregados sin filtro de cola | selector `ACTIVE/HISTORICAL/ALL`; default `ACTIVE` | UI + repositorio |
| `FOUND` tratado como respuesta | enlace y evidencia mezclados | `response_evidence_status`; traducción española | vista + panel |
| `NO_RESPONSE/1.0000` sin mensajes | una confianza reutilizada para semánticas distintas | tres confianzas; intención `null` sin mensajes válidos | contrato 017 |
| `UNKNOWN` tapa `ADDRESS_INCORRECT` | UI priorizaba mapping | tipo interpretado separado de mapping | fila/detalle panel |
| `-30` convertía todo en riesgo/bloqueo | mapping desconocido se usaba como estado universal | conservar `UNMAPPED`; causa concreta y propuesta condicionada | vista 017 |
| timer vencido mostrado `ACTIVE` | estado persistido usado directamente | estado efectivo calculado en lectura | SQL/MCP/UI |
| Dropea `FRESH` por poll reciente | evaluador solo medía último sync | edad de poll y evento independientes | test 118000 s |
| timestamps `{}` | `maskPii` recorría `Date` como objeto enumerable | serializar `Date` antes de recursión | test unitario anidado |
| consulta por pedido Dropea sin timers/decisiones | repositorio filtraba solo ID canónico | resolver ambos espacios de identidad | consulta MCP |
| commit/branch desconocidos | imagen sin procedencia OCI y runtime sin build metadata | labels OCI derivados de Git y `/version` | Dockerfile/compose/API |

## Migración, backup y rollback

- Up: `migrations/017_incident_panel_integrity.sql`.
- Down: `migrations/rollback/017_incident_panel_integrity.down.sql`.
- Aplicación: `infrastructure/vps/apply-incident-panel-integrity-migration.sh`.
- Drill: restaura un backup verificado en una base aislada, aplica 016+017,
  comprueba las vistas, revierte 017 y elimina la base temporal.
- El deploy crea y verifica backup antes de la primera escritura interna. Las
  escrituras de esquema se contabilizan como internas; acciones y escrituras
  externas permanecen a cero.

## Estado de Chatby y puerta final

Chatby continúa bloqueado por HTTP 401 del proveedor. Los tokens configurados
en los entornos observados no obtienen autorización; no se han mostrado,
extraído ni modificado secretos. Falta una credencial/token de lectura válido o
el permiso proveedor equivalente para el recurso de conversaciones. Hasta
demostrar GET 200, worker `HEALTHY`, materialización actual, identidad verificada
y respuesta posterior a incidencia, el panel expone `NOT_VERIFIABLE` y la puerta
permanece `NO_GO`.

No se declara despliegue completado sin: suite MCP con dependencias, backup y
rollback aislado, migración SQL real, E2E autenticado, paridad API/MCP/UI, digest
activo y `/version` coincidente. Producción permanece `NO_GO` incluso después de
superar esas comprobaciones, por instrucción del encargo.

## Addendum de auditoría y rendimiento — 2026-08-15

Una segunda revisión del recorrido completo detectó y corrigió, todavía sin
desplegar, los siguientes defectos adicionales:

| Hallazgo adicional | Impacto | Corrección y prueba |
|---|---|---|
| Un parámetro numérico ausente se convertía con `Number(null)=0` | el límite por defecto podía quedar reducido a una sola fila | `integer` distingue ausencia de cero; prueba API confirma `limit=25` |
| Tarjetas y tabla requerían dos lecturas completas independientes | más latencia y posibilidad de observar snapshots distintos | endpoint `GET /api/operations/incidents/overview`; una CTE materializada alimenta página y métricas en un solo round-trip |
| Las respuestas antiguas de filtros podían sobrescribir la vista actual | filas y contadores incoherentes al filtrar rápido | cancelación con `AbortController` y número monotónico de petición |
| Dos aperturas rápidas de expediente podían mostrar el detalle anterior | trazabilidad visual incorrecta | cancelación y control de vigencia independiente para el drawer |
| Una página podía quedar vacía al reducir el conjunto filtrado | paginación fuera de rango | reposicionamiento automático a la última página válida |
| `NULL` en mapping, capacidad o intento logístico evitaba una causa explícita | expediente incompleto sin explicar por qué se revisa | `coalesce` seguro a `UNMAPPED/UNKNOWN` y causas específicas |
| “Bloqueadas” contaba cualquier carencia, incluso sin decisión vigente bloqueada | inflación equivalente al error histórico observado | `currently_blocked` exige registro `CURRENT`, decisión `BLOCKED` y causa específica |
| El MCP enmascaraba nombres de esquemas, objetos y columnas como si fueran personas | catálogo auditor inutilizable | excepción cerrada para descriptores técnicos; `customer_name` sigue enmascarado en prueba |
| Los intervalos ausentes se presentaban como `0 min` | falsa precisión en frescura y timers | `null`, vacío o no numérico se presenta como `—` |
| El filtro de fecha dependía de la zona horaria de PostgreSQL | borde diario desplazable | límites convertidos con `AT TIME ZONE 'Europe/Madrid'` |

La tabla usa 25 filas por defecto (selector 25/50/100), expone paginación real y
mantiene un máximo servidor de 100. Los contadores se calculan sobre exactamente
la misma selección filtrada. Riesgo y QA históricos se conservan solo como
auditoría; los valores principales usan los campos efectivos. Una incidencia
sin decisión vigente muestra “Motivos de revisión”, no “Bloqueo”.

Validación local del addendum: 28 pruebas focalizadas pasan y la ejecución
ampliada deja 213 pruebas en verde. Seis pruebas MCP no llegan a arrancar porque
faltan los enlaces instalados de `@modelcontextprotocol/sdk` y `express`; el
entorno conserva una caché parcial, insuficiente para una instalación offline.
La migración aún requiere backup, ejecución PostgreSQL
real y rollback aislado en un runner con acceso al VPS. La revisión visual
productiva autenticada sigue pendiente de sesión Keycloak y, sin un despliegue
nuevo, producción continúa mostrando el frontend anterior.

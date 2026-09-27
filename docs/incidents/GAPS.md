# Gaps y contradicciones de la arquitectura de incidencias

**Fase:** 0 — auditoría

**Corte:** 2026-08-19

**Prioridad rectora:** seguridad > calidad de decisión > trazabilidad > automatización

## 1. Veredicto

**NO-GO para habilitar nuevas escrituras productivas de incidencias.**

Se puede avanzar con diseño, tests, migraciones aditivas locales y shadow mode siempre que:

- `production_writes=false` sea verificable;
- no se cambie la lógica productiva vigente;
- no se utilicen clientes reales como sujetos de prueba ni se les aplique una acción; shadow puede observar lecturas productivas autorizadas con salida mutadora bloqueada;
- cada diferencia `legacy/new` quede persistida sin ejecutar la decisión nueva.

Antes de comenzar la Fase 1 debe fijarse una base de integración reproducible entre `main@9569b01` y `deploy@e17141e`. Antes de desarrollar el executor deben cerrarse el diseño y los guards de G-001 a G-009; G-010 se cierra mediante las pruebas aisladas/fault injection de la Fase 7. **Antes de desplegar cualquier componente con credenciales o red mutadora deben estar cerrados todos los P0 y todos los P1 aplicables a esa capability.** La Fase 11 debe emitir un nuevo go/no-go explícito; ningún despliegue productivo queda autorizado por estos documentos.

Los P0 encontrados en Render afectan al legado activo, no solo a la arquitectura futura. Esta auditoría no cambia producción porque la Fase 0 lo prohíbe, pero exige abrir una **decisión de contención separada** con owner, aceptación explícita del riesgo y evidencia. Sus opciones —deshabilitar temporalmente una capability, introducir un guard mínimo o aceptar el riesgo por un plazo definido— requieren autorización productiva independiente y no deben resolverse dentro de este PR documental.

## 2. Escala de prioridad

| Prioridad | Significado |
|---|---|
| P0 | Puede causar una acción externa incorrecta, eludir un control de seguridad o impedir demostrar qué código/regla actuó. Bloquea promoción. |
| P1 | Degrada la verdad operativa, la decisión, la privacidad o la recuperación. Debe resolverse antes de un shadow concluyente o del executor. |
| P2 | Deuda de coherencia, observabilidad o experiencia que no habilita por sí sola una escritura peligrosa. |

## 3. Registro priorizado

### G-001 · Dos historiales y dos runtimes sin base integrada — P0

**Evidencia.** `main` y `deploy/contabo-operations-live` comparten `08a0aaa8`, pero tienen 11 y 192 commits exclusivos. Render ejecuta `9569b01`; la imagen Contabo ejecuta `e17141e`. El symlink del host permanece en `47add8f9`.

**Riesgo.** Una implementación basada solo en `deploy` puede omitir correcciones productivas de confirmación/cancelación; una basada solo en `main` no contiene la plataforma PostgreSQL/Operations. El puntero de release del host no acredita la imagen efectiva.

**Criterio de cierre.** Rama de integración creada desde SHA explícito, inventario de conflictos semánticos, suite completa en Node 22, imagen etiquetada con el mismo SHA y puntero de release alineado. No desplegar esa rama durante la Fase 0/0.5.

### G-002 · No existe un modo global de seguridad — P0

**Evidencia.** Contabo combina `SHADOW_READ_ONLY`, `SIMULATION_ONLY`, `PRODUCTION_WRITES_ENABLED` y `ACTION_EXECUTOR_ENABLED`; Render combina flags independientes de agente, dry-run, confirmación, cancelación e incidencias.

**Riesgo.** Son posibles combinaciones contradictorias. Un panel puede mostrar “agente desactivado” mientras una clasificación determinista sigue programando acciones; un flag real puede prevalecer sobre `agentDryRun`.

**Criterio de cierre.** Un único enum validado en el composition root:

```text
SIMULATION  -> lecturas permitidas, propuestas persistidas, cero egress mutador
READ_ONLY   -> lecturas permitidas, ninguna propuesta ejecutable, cero egress mutador
PRODUCTION  -> solo capacidades explícitas y política aprobada
```

Toda combinación imposible debe impedir el arranque. El valor por defecto debe ser `SIMULATION` y `production_writes=false`. En shadow, la prueba de cero escrituras requiere además credenciales técnicamente read-only, ausencia de secretos mutadores, egress mutador denegado y contraste con logs autoritativos del proveedor.

### G-003 · Los workflows productivos eluden Policy Gate y Action Executor — P0

**Evidencia.** `services/action-executor.mjs` aborta cualquier ejecución, mientras `orders.mjs`, `unanswered-cancellations.mjs` y el cliente Dropea V2 realizan llamadas directas. Los módulos de Risk, QA, Compliance, Conflict y Authorization se usan principalmente en tests/simulación.

**Riesgo.** No existe una puerta obligatoria para frescura, conflicto, versión de estado, capacidad, idempotencia y aprobación.

**Criterio de cierre.** El 100 % de imports/calls mutadores debe quedar detrás de una interfaz única `ActionExecutor`. Una prueba estática y otra de egress deben fallar si un workflow importa un cliente mutador directamente.

### G-004 · Cancelación sin respuesta no respeta de forma fiable flags y dry-run — P0

**Evidencia.** En `autoconfirm/src/workflows/unanswered-cancellations.mjs`, `dryRun = agentDryRun && !enabled`; con ciertas combinaciones desactivar el flag no garantiza cero escritura. La rama de cliente bloqueado puede cancelar antes del control dry-run posterior.

**Riesgo.** Cancelación real fuera de la política global o antes de 48 horas.

**Criterio de cierre.** Guard fail-closed al inicio y justo antes del egress; matriz exhaustiva de modos/flags; pruebas de cero llamadas para cada combinación no productiva. El bloqueo de cliente debe ser política configurable, sin PII hard-coded y sujeto al mismo gate.

### G-005 · Una señal posterior puede quedar eclipsada por una dirección anterior — P0

**Evidencia.** La ruta determinista devuelve una dirección completa antes de inspeccionar el último mensaje. Una cancelación posterior puede ignorarse y derivar en confirmación. Además, el código convierte una dirección completa en `CONFIRM` con 98 %, mientras `AGENTS.md` y los prompts indican que un cambio de dirección nunca confirma por sí solo.

**Riesgo.** Confirmación contra la intención más reciente del cliente.

**Criterio de cierre.** Regla temporal explícita: todas las evidencias candidatas se ordenan por tiempo y ámbito del pedido; cualquier cancelación/corrección posterior bloquea. Dirección se modela como dato a corregir, no como consentimiento. Pruebas de secuencia y property tests.

### G-006 · Endpoints cron pueden quedar fail-open — P0

**Evidencia.** La autorización de endpoints cron permite acceso cuando falta `CRON_SECRET`.

**Riesgo.** Un invocador no autorizado podría iniciar ciclos con capacidad productiva.

**Criterio de cierre.** Arranque bloqueado o endpoint deshabilitado si falta el secreto; autenticación fail-closed, rate limit, replay protection y test negativo. Todo webhook externo debe validar firma, antigüedad, nonce/idempotencia, tamaño, esquema y tenant antes de persistir o disparar trabajo.

### G-007 · Asistente y `AGENT_ENABLED` no delimitan todos los efectos — P0

**Evidencia.** `AGENT_ENABLED` selecciona el uso de OpenAI, no desactiva necesariamente la clasificación determinista. El asistente puede programar confirmación antes de comprobar dry-run.

**Riesgo.** La semántica visual/configurada no coincide con la capacidad real.

**Criterio de cierre.** Separar `reasoner_enabled` de `execution_mode`; ningún componente de decisión puede programar egress. Toda salida debe ser un `DecisionProposal` sin efectos.

### G-008 · Estado canónico duplicado y replay no demostrado — P0

**Evidencia.** Coexisten `InMemoryEventStore` + Digital Twin, `RealityEngine`, proyecciones directas de `OperationsProjector`, caches/Supabase Render y múltiples read models SQL. El proyector upserta el twin además de registrar eventos; el catálogo JS y los tipos persistidos difieren.

**Riesgo.** Dos agentes pueden decidir sobre estados distintos. No puede acreditarse que el mismo stream produzca el mismo estado/hash.

**Criterio de cierre.** Un solo catálogo versionado con constraint DB; raw inmutable; twin derivado de eventos; replay completo con hash idéntico; autoridad y propósito documentados para cada tabla/vista.

### G-009 · Snapshot y precondición de decisión incompletos — P0

**Evidencia.** La migración 017 expone `snapshot_status='NOT_PERSISTED'`, hashes nulos y sin precondición ejecutable `current_state_version == decision.state_version`.

**Riesgo.** Una decisión correcta al evaluarse puede ser peligrosa al ejecutarse después de un mensaje, estado GLS, entrega, devolución o timer nuevo.

**Criterio de cierre.** Snapshot de estado/evidencia/política persistido e inmutable; relectura inmediatamente anterior al egress; versión distinta produce `RE_EVALUATE`, nunca retry ciego.

### G-010 · Idempotencia y reconciliación parciales — P0

**Evidencia.** Confirmar/cancelar V2 usa clave estable y las plantillas Chatby tienen claim persistente. No hay prueba de concurrencia multiproceso, timeout después de commit remoto, crash/restart o reconciliación. El ledger de incidencias es local y acotado; las tablas de jobs/idempotencia no están conectadas a un executor.

**Riesgo.** Doble acción, acción remota ejecutada pero localmente desconocida o reintento que no distingue operación previa de una nueva.

**Criterio de cierre.** Una sola consecuencia remota bajo 100 solicitudes concurrentes y bajo fault injection en cada punto de commit; estados `PENDING/IN_FLIGHT/REMOTE_UNKNOWN/SUCCEEDED/FAILED/RECONCILED`; reconciliación antes de reintentar.

### G-011 · Cuatro motores de recomendación — P1

**Evidencia.** Render, `simulateIncidentProcess`, `DeterministicDecisionEngine` e `incident-insight` contienen reglas propias.

**Riesgo.** Panel, simulador y proceso productivo pueden mostrar acciones distintas para el mismo caso.

**Criterio de cierre.** Un `IncidentContext`, un Rule Engine versionado y adaptadores legacy/new que consumen el mismo contrato. `incident-insight` debe presentar, no decidir.

### G-012 · Confianza no compuesta ni calibrada — P1

**Evidencia.** Se usan porcentajes locales/constantes. `NO_RESPONSE` puede obtener `interpretation_confidence=1`; la frescura Dropea puede ocupar el campo de frescura Chatby.

**Riesgo.** Un 99 % visual no representa evidencia suficiente ni probabilidad calibrada.

**Criterio de cierre.** Breakdown versionado de fuerza de regla, calidad, frescura, intención, soporte histórico, missing data y conflictos. Calibración con outcomes y ECE/Brier score; ausencia de respuesta nunca incrementa por sí sola confianza.

### G-013 · Frescura contradictoria y no independiente — P1

**Evidencia.** En el corte auditado, Dropea estaba `STALE`, el estado global `STALE`, algunas capas `UNKNOWN`, pero la lista de incidencias indicaba `FRESH`. `shadow-sync` marca capas tras el mismo proyector, sin comparación independiente.

**Riesgo.** El panel puede habilitar o recomendar sobre datos obsoletos.

**Criterio de cierre.** Timestamps por fuente, `observed_at/received_at/projected_at`, thresholds versionados, freshness agregada fail-closed y tests de reloj. `UNKNOWN` debe bloquear acciones externas.

### G-014 · Reglas y timers contradictorios — P1

**Evidencia.** Coexisten 36 h, 48 h y 72 h para ausencia/unknown; la automatización formal de descuento está deshabilitada, pero las propuestas usan 24 h en Render/política dormant y 48 h en Contabo; incidencias a 360/480 min; timer interno, cron Render y timer VPS.

**Riesgo.** Distinto resultado según ruta o disparador.

**Criterio de cierre.** Registro de políticas versionado con fecha de vigencia, fuente/evidencia y owner; un scheduler; cada discrepancia requiere decisión humana documentada, no selección implícita.

### G-015 · Modelo de timers incompatible — P1

**Evidencia.** Los módulos/tablas usan combinaciones de `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`, `COMPLETED` y `SUPERSEDED`; falta `CONSUMED`. No hay servicio consumidor desplegado.

**Riesgo.** Timers vencidos pueden parecer activos o reutilizarse tras una nueva respuesta.

**Criterio de cierre.** Máquina de estados única `ACTIVE/EXPIRED/CONSUMED/CANCELLED/SUPERSEDED`, transiciones atómicas e idempotentes, supersession por nueva evidencia y reloj inyectable.

### G-016 · Mapping GLS/Dropea fragmentado — P1

**Evidencia.** Existe catálogo `UNKNOWN/UNMAPPED` seguro, pero Render, políticas GLS y presentación interpretan señales por rutas distintas. El ingestion worker permanente no incorpora una sincronización GLS independiente.

**Riesgo.** Una descripción histórica o textual puede convertirse en una acción logística vigente.

**Criterio de cierre.** Pipeline único `raw carrier code -> normalized carrier status -> canonical incident type`; evidencia, versión y test por mapping; desconocido siempre `UNMAPPED`, `automation_allowed=false`.

### G-017 · Pago Shopify se interpreta por substring — P1

**Evidencia.** Estados que contienen `paid/pagado` pueden tratarse como pagados, incluyendo textos negativos o parciales.

**Riesgo.** Confirmación sobre un estado de pago no válido.

**Criterio de cierre.** Enum/allowlist exacta de Shopify y tests para `unpaid`, `partially_paid`, `pending` y variantes localizadas.

### G-018 · “Sin hilo Chatby” puede convertirse en “sin respuesta” — P1

**Evidencia.** La cancelación diferencia fallo HTTP, pero la ausencia de hilo puede avanzar como ausencia de respuesta; `storedConfirmation` se calcula sin actuar siempre como guard.

**Riesgo.** Cancelar cuando falla la asociación, retención o recuperación de conversación.

**Criterio de cierre.** Estados separados `NOT_FOUND`, `FOUND_STALE`, `FOUND_NO_RELEVANT_MESSAGE`, `FOUND_VALID_RESPONSE`, `SOURCE_ERROR`; únicamente evidencia positiva y fresca permite una decisión irreversible.

### G-019 · Case Memory no cierra el ciclo — P1

**Evidencia.** El feedback actual conserva recomendación, veredicto, motivo, principal y fecha. No conserva snapshot completo, override, acción, outcome ni soporte histórico y no se consume en decisiones.

**Riesgo.** El sistema aparenta aprender sin disponer de datos válidos para medir éxito o calibración.

**Criterio de cierre.** Esquema estructurado con decisión original/humana, evidencia, política, outcome y calidad; uso solo como factor contextual, nunca como ejecutor.

### G-020 · Privacidad y acceso descifrado sin gobierno suficiente — P1

**Evidencia.** MCP está enmascarado y el contexto privado usa AES-GCM, pero `operations_reader` puede descifrar sin scope PII separado; no existe auditoría durable por descifrado, `key_id` ni rotación; se reutiliza material de clave. Render persiste PII/raw bajo service role.

**Riesgo.** Acceso excesivo, imposibilidad de rotación o trazabilidad de uso de PII.

**Criterio de cierre.** `operations:pii:read`, finalidad obligatoria, evento de auditoría por acceso, claves independientes con `key_id`, rotación probada, minimización y política de retención/borrado. Debe definirse cómo se propaga una supresión a read models, Case Memory y backups, y cómo se separa el payload personal borrable del sobre append-only (referencia/tombstone o crypto-erasure).

### G-021 · Auditoría no reconstruye el ciclo completo — P1

**Evidencia.** Existen tablas append-only, pero el runtime escribe principalmente a logs de vida limitada y no se observaron escrituras coherentes a `audit.*`. Algunas comprobaciones de cero acciones imprimen constantes.

**Riesgo.** No puede responderse de forma durable qué evidencia/política autorizó una acción ni demostrar cero writes.

**Criterio de cierre.** Correlation/causation ID desde ingestión a outcome; ledger append-only con sellado/tamper evidence y almacenamiento/rol independiente; sincronización temporal; raw response cifrada; métricas derivadas del ledger/egress; retención definida.

### G-022 · Shadow comparison no está conectado — P1

**Evidencia.** Existen parity, reconciliation, readiness y three-way comparator, pero no se usan en el worker desplegado ni alimentan comparaciones persistentes.

**Riesgo.** No hay una muestra representativa `legacy/new` para valorar calidad o seguridad.

**Criterio de cierre.** Comparación para >=99 % de casos elegibles y 100 % de alto riesgo; todos los diffs clasificados; cero egress mutador observado.

### G-023 · Decision engine y scheduler desplegados son placeholders — P1

**Evidencia.** `services/process-runner.mjs` devuelve `501/NOT_IMPLEMENTED`; el timer engine figura como no desplegado.

**Riesgo.** El diagrama/deployment aparenta capacidades que en realidad ejecuta el ingestion worker o Render.

**Criterio de cierre.** Eliminar servicios nominales o implementar workers reales con health que mida lag/cola; no declarar “ready” una capacidad inexistente.

### G-024 · Cobertura amplia sin pipeline de garantía — P1

**Evidencia.** 420 tests pasan en el snapshot `deploy` y 103 en `main`, pero no hay CI, cobertura, lint/typecheck obligatorios, property tests, load tests ni fault injection. El baseline local usó Node 24 fuera del rango declarado.

**Riesgo.** Una release puede omitir suites o fallar solo bajo carreras/crashes.

**Criterio de cierre.** CI en Node 22 con migración desde cero/rollback, suites agregadas, cobertura >=90 % en policy/executor/idempotencia/decisión, secret/PII scanning y escenarios de fallo. La release requiere dependencias fijadas, SBOM, SCA/CVE, artefacto firmado y attestation de procedencia.

### G-025 · Backup y rollback sin evidencia operativa completa — P1

**Evidencia.** Hay scripts de backup, checksum, restore y rollback, pero no evidencia de cifrado offsite, RPO/RTO aprobados ni restore mensual automático. Un rollback por extracción puede conservar archivos añadidos.

**Riesgo.** Recuperación incompleta o no reproducible.

**Criterio de cierre.** Backup cifrado offsite, RPO <=24 h, RTO <=60 min, restore drill mensual y release/rollback atómico por imagen inmutable.

### G-026 · Operations Center aún no es un centro de decisiones/excepciones/riesgo — P2

**Evidencia.** Dispone de pedidos, incidencias, detalle y feedback, pero no integra auto-decisions, bloqueos, overrides, outcomes, calibración ni timeline causal. Parte de las recomendaciones se calcula en presentación.

**Riesgo.** Campos repetitivos, baja accionabilidad y confusión entre estado observado y decisión real.

**Criterio de cierre.** UI solo sobre contratos/read models canónicos; ninguna regla en frontend/presentación; vistas y KPIs definidos en el plan.

### G-027 · IAM, aprobación y respuesta operativa no están definidos end-to-end — P1

**Evidencia.** Existen Keycloak, roles y scopes, pero no se acreditaron para acciones irreversibles MFA/reautenticación, separación proponente-aprobador, aprobación firmada/inmutable, owner on-call, circuit breaker o prueba periódica del kill switch.

**Riesgo.** Una cuenta o servicio con exceso de privilegios puede proponer y autorizar la misma acción, y una escritura errónea puede no contenerse dentro de un tiempo conocido.

**Criterio de cierre.** RBAC por capability, least privilege, MFA/reautenticación para alto riesgo, segregación de funciones, aprobación vinculada a snapshot/política, runbook `REMOTE_UNKNOWN`/escritura errónea, circuit breaker y kill switch con owner, SLO de propagación y drill periódico.

### G-028 · El shadow conserva credenciales con capacidad de escritura — P1

**Evidencia.** `infrastructure/docker/compose.yaml` inyecta `SUPABASE_SERVICE_ROLE_KEY` y `packages/suleia-operations-mcp/src/shadow/config.mjs` lo utiliza como token de fuente. El código observado limita la integración a GET, pero service role no es técnicamente read-only. El alcance efectivo de `CHATBY_TOKEN` tampoco está inventariado en el repositorio.

**Riesgo.** Un bug, dependencia comprometida o ruta futura podría escribir pese a `PRODUCTION_WRITES_ENABLED=false`; no puede acreditarse cero-write solo con flags.

**Criterio de cierre.** Sustituir service role por rol/token/proxy `SELECT`-only y allowlist de vistas; inventariar/reducir scopes Chatby; no montar secretos mutadores en shadow; test negativo de escritura y contraste con logs autoritativos.

## 4. Contradicciones de negocio que no deben resolverse en código sin decisión

| ID | Regla A | Regla B | Acción requerida |
|---|---|---|---|
| C-01 | Dirección completa produce `CONFIRM` determinista | Regla operativa y prompts: una dirección no confirma | Owner de operaciones debe fijar una política versionada; mientras tanto, bloquear auto-confirmación por dirección |
| C-02 | Cancelación sin respuesta a 48 h | Comparador legacy 36 h; unknown alerta a 72 h | Mantener 36 h solo como comparación; declarar bases temporales de 48/72 h |
| C-03 | Política autorizada: automatización de descuento deshabilitada, sin deadline productivo | Recomendación/política dormant a 24 h; simulación Contabo a 48 h | Mantener descuentos deshabilitados; decidir si existe política futura y su fuente temporal |
| C-04 | Texto histórico de transporte puede recomendar agencia | Contabo exige estado `AGENCY_PICKUP_CONFIRMED` vigente | Mantener la variante estricta hasta validar evidencia real |
| C-05 | Resumen Chatby prioriza cualquier rechazo histórico | Decisión usa último mensaje | Crear secuencia temporal común y reglas de supersession |
| C-06 | “sí/vale/ok” puede mostrarse como conformidad | Timer puede descartarlo como respuesta útil | Definir evidencia mínima por intención y contexto del pedido |
| C-07 | Config de incidencia 360 min | Blueprint 480 min; políticas 48/72 h | Eliminar etiquetas engañosas y separar polling de deadline de negocio |
| C-08 | “Notificaciones” cada 30 min | El ciclo solo sincroniza GET; no envía | Renombrar capacidad o implementarla en simulación, nunca asumir envío |
| C-09 | Blueprint raíz mínimo | Blueprint anidado contiene flags/cron | Declarar un único manifiesto autoritativo por servicio |

## 5. Matriz reutilizar / extender / crear / retirar

| Decisión | Pieza | Motivo |
|---|---|---|
| Reutilizar | `events.order_events` y trigger append-only | Es la base persistente más cercana al Event Store objetivo |
| Reutilizar | `OperationsProjector` y raw mirrors | Ya ingieren/proyectan Dropea y Chatby; deben perder decisiones implícitas |
| Reutilizar | catálogo de códigos de migración 010 | Ya conserva unknown/unmapped y bloquea automatización |
| Reutilizar | módulos Governance (Conflict, Risk, QA, Compliance, Authorization) | Cubren el esqueleto del Policy Gate |
| Reutilizar | protección MCP, Keycloak y contexto privado cifrado | Buena separación lectura pública/privada, con hardening pendiente |
| Reutilizar | parity/reconciliation/readiness/three-way comparator | Base del shadow mode, hoy sin orquestación |
| Extender | Digital Twin y Reality Engine | Unificarlos sobre stream PostgreSQL y contrato versionado |
| Extender | simulación de incidencias | Convertirla en `IncidentSupervisor` sin efectos |
| Extender | decision records/snapshots | Persistir versión, hash, evidencia y política reales |
| Extender | timers SQL/módulos | Adoptar una máquina de estados única |
| Extender | feedback migración 020 | Añadir override, outcome y vínculo a case memory |
| Crear mínimo | `IncidentContext` y sus builders/validadores | No existe un contrato canónico común |
| Crear mínimo | `ConfidenceEngine` puro y calibrable | Las confianzas actuales no son comparables |
| Crear mínimo | orquestador `DecisionPipeline` | Conectar Rule -> Reasoner opcional -> Conflict -> Policy sin efectos |
| Crear mínimo | ledger transaccional de comandos/intentos si las tablas actuales no bastan | Debe aprovechar jobs/idempotency antes de añadir tablas |
| Retirar gradualmente | reglas de decisión de `incident-insight` | Presentación no debe decidir |
| Retirar gradualmente | llamadas mutadoras directas desde workflows | Todo egress debe pasar por executor |
| Retirar o implementar | contenedores placeholder | No deben aparentar readiness |
| No crear | nueva base vectorial o microservicios por responsabilidad | PostgreSQL y monolito modular son suficientes inicialmente |

## 6. Gate de salida de Fase 0 / entrada a implementación

La Fase 0 se considera completa documentalmente cuando:

- los tres entregables están versionados y revisados;
- las ramas/runtime y su divergencia quedan registradas;
- todas las contradicciones anteriores permanecen explícitas;
- no se han aplicado migraciones ni cambios de producción;
- el baseline de tests y su limitación de Node quedan registrados;
- existe plan de integración, shadow y rollback.

La implementación puede empezar en local/simulación. La ejecución productiva permanece bloqueada hasta:

- cerrar **todos** los P0, incluido G-001;
- cerrar los P1 exigidos por la capability según la matriz siguiente;
- demostrar una ventana shadow representativa;
- obtener aprobación humana explícita y separada en Fase 11.

| Capability futura | Prerrequisitos mínimos además de todos los P0 |
|---|---|
| Cualquiera | G-013 frescura, G-020 privacidad, G-021 auditoría, G-022 shadow, G-024 CI/supply chain, G-025 recuperación, G-027 IAM/respuesta y G-028 credenciales read-only |
| `ORDER_CONFIRM` | G-014 reglas/timers, G-017 pago y pruebas de señal temporal vigente |
| `ORDER_CANCEL` | G-014, G-015 timers y G-018 estados Chatby/asociación |
| `INCIDENT_RESOLVE` / logística | G-011 decisión única, G-012 confidence, G-014–G-016 y outcome verificable |
| `CUSTOMER_MESSAGE` | G-018, consentimiento/base operativa, lifecycle idempotente y revisión de contenido |

Esta matriz solo define mínimos; Policy Gate puede añadir requisitos más estrictos por tienda, acción o riesgo. Acuerdo con el legado no sustituye ground truth ni outcome humano.

## 7. Evidencia de seguridad de esta auditoría

```text
files changed outside documentation: 0
migrations applied: 0
deployments: 0
production writes initiated by this audit: 0
customer messages initiated by this audit: 0
Dropea mutations initiated by this audit: 0
GLS mutations initiated by this audit: 0
```

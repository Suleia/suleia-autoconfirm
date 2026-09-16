# AUSENTE: implementación y validación SHADOW

Fecha: 16 de septiembre de 2026. Alcance autorizado: únicamente AUSENTE. Los descuentos y devoluciones de rechazos existentes en Render no se modifican ni se pausan.

## 1. Auditoría previa

Se reutilizan los componentes canónicos del VPS: ingestión Dropea V2, enlace exacto de conversación Chatby, almacenamiento cifrado de mensajes privados, interpretación, libro inmutable de simulaciones, timer general de 48 horas, historial operacional del cliente, read models y panel privado. No se crea un segundo motor en Render.

La entrada antigua de AUSENTE podía completar una fecha/franja ausente con una estimación del calendario y `afternoon`. Se elimina esa rama y ambas entradas delegan en la política canónica nueva. Otros tipos conservan su lógica. El mapping antiguo NAM se mantiene para no reclasificar otros procesos, pero NAM con tipo bruto genérico no se considera ausencia verificada. No se convierte globalmente el código numérico -30 en AUSENTE. Solo tipo explícito RECIPIENT_ABSENT o equivalentes gobernados AS/AUSENTE entran de forma inequívoca.

Se detectó divergencia entre la copia de código del panel y el trabajador publicado. Se preservan la caché y presupuesto equitativo de conversaciones y el contexto de plantillas del trabajador real para no aumentar consultas ni perjudicar los envíos de rechazo. La verificación posterior detectó y corrigió una ambigüedad SQL del JOIN nuevo: incidencia y pedido se unen por ambas identidades. Los diez filtros nuevos usan `normalized_type`, no la interpretación histórica de registros UNKNOWN; en la fotografía auditada esto evita mezclar otros 165 registros sin tipo canónico gobernado. Los filtros genéricos anteriores no cambian.

## 2–7. Arquitectura, ficheros, migrations, read model y política

Flujo: fuentes de solo lectura → evidencia del pedido exacto → `RECIPIENT_ABSENT_POLICY_V1` → ledger con hash de entrada → columna aditiva `absent_shadow` → API/MCP de lectura → representación en panel. El frontend no decide ni ejecuta.

Ficheros principales:

- `packages/platform-core/src/incident/recipient-absent-policy.mjs`: interpretación determinista, intentos, viabilidad, estados, hashes y propuestas.
- `packages/platform-core/src/incident/absent-template.mjs`: texto exacto, botones, respuestas futuras, integridad UTF-8/NFC y flags inmutables falsos.
- `packages/platform-core/src/incident/absent-panel-projection.mjs`: proyección de decisión canónica para lectores existentes.
- `simulation-record.mjs` y `incident-processor.mjs`: enrutamiento exclusivo de AUSENTE a la misma política.
- `services/incident-simulation-sync.mjs`, `shadow-readonly-worker.mjs`: reutilización del trabajador existente, evidencia cifrada, historia, timer y lectura logística.
- `services/integrations/gls/absent-read-context.mjs`: reutiliza `getOrder` y búsqueda de seguimiento GLS oficial; no modifica envíos.
- `services/integrations/chatby/readonly-sync.mjs`: botones exactos y preservación de caché/contexto publicados.
- `services/integrations/chatby/absent-template-admin.mjs`: catálogo, reutilización por igualdad exacta y una creación administrativa sin reintentos.
- `packages/suleia-operations-mcp/src/operations/{projector,repository,incident-insight}.mjs` y `src/data/postgres-read-repository.mjs`: persistencia/lectura privada.
- `apps/review-panel/{app.js,styles.css,index.html}`: tarjeta, filtros y actualización de versión de recursos.
- `scripts/replay-recipient-absent-shadow.mjs`: replay SELECT-only sin conectores ni proyector.
- `migrations/035_recipient_absent_shadow.sql` y rollback correspondiente; scripts de migration/despliegue aislado bajo `infrastructure/vps/`.
- Tests específicos de política, plantilla administrativa, lectura GLS, proyección y render real del código del panel en DOM sintético.

Migration 035: añade solamente `read_models.operations_incident_records.absent_shadow`, CHECK tipado que exige flags y marcadores falsos, vista privada `read_models.recipient_absent_shadow`, permisos de lectura para roles existentes. No cambia estados operativos, gastos, descuentos ni vencimientos. Los mensajes no se copian al snapshot; se conservan cifrados en el mecanismo privado existente. La columna/vista no incluyen teléfonos o conversaciones.

Reglas completas en la política versionada:

1. Filtrar evidencia exacta del pedido/incidencia actuales y posterior al inicio de la incidencia. Excluir confirmación del ciclo inicial y respuestas de descuento. La respuesta cronológicamente más reciente domina; contradicción simultánea o ambigüedad requiere revisión.
2. Payload estable conocido antes que texto exacto normalizado. Sin fuzzy matching. Extraer fecha relativa desde la hora original del mensaje en Europe/Madrid, franja, desde/hasta, todo el día y recogida. Sin completar fecha/franja faltante.
3. Primer/segundo intento por campo explícito o timeline verificado sin duplicados. Evidencia incompleta: ABSENCE_ATTEMPT_UNKNOWN.
4. Segunda ausencia/historial de ausencias verificado prioriza agencia como preferencia logística, no sanción. Fallo posterior a franja del cliente se distingue sin atribuir culpa.
5. Validar identidad, PENDING/activa, estado actual, allowed options, capacidad, retención, operabilidad, recogida, frescura ≤15 minutos, calendario gobernado y fecha solicitada. Datos incompletos/desactualizados bloquean la propuesta final con reason codes. El tracking oficial no prueba capacidad de recogida/franjas ni retención: esos campos permanecen UNKNOWN.
6. Reutilizar el timer general existente de 48 h sin actualizarlo ni cancelarlo. Si falta, solo puede registrarse el mismo timer general estándar, sin subtimers o recordatorios. Vencimiento solo propone devolución SHADOW tras validación.
7. Cambios a estado terminal bloquean propuestas incoherentes. Nunca AUTO_CLOSE/AUTO_CANCEL_TIMER/AUTO_RESOLVE_BY_DELIVERY.
8. Entrada estable produce el mismo hash/decision id. Ledger inmutable con ON CONFLICT DO NOTHING. No resolución operativa tipada: `proposed_resolution=null`; solo acciones WOULD_*.
9. Flags falsos, `execution_available=false`, `executed=false`, `external_action=false`, `production_write=false`. El permiso Meta no concede ejecución.

Máquina de estados conceptual:

`ABSENT_DETECTED → CUSTOMER_CONTACT_REQUIRED → WAITING_CUSTOMER_RESPONSE → CUSTOMER_RESPONSE_RECEIVED → RESPONSE_INTERPRETED → LOGISTICS_VALIDATION_REQUIRED → RESOLUTION_PROPOSED → WAITING_EXECUTION`

Estados y trace se exponen desde backend. Nunca EXECUTED. Las ramas sin evidencia fiable permanecen en validación/revisión, conservando la propuesta condicionada visible.

## 8–15. Plantilla exacta y aprobación

Nombre `dropea_ausente_v1`, locale `es_ES`, categoría propuesta UTILITY. Registro administrativo y último estado en `recipient-absent-template-approval.json`.

```text
Hola, {{1}}.

GLS nos indica que no ha podido entregarte tu pedido {{2}} porque no había nadie disponible en el momento de la entrega.

Para evitar que el paquete sea devuelto, indícanos cuándo te viene mejor recibirlo.

¿Qué opción prefieres?
```

| QUICK_REPLY exacto | ID interno |
| --- | --- |
| Mañana por la mañana | ABSENT_TOMORROW_AM |
| Mañana por la tarde | ABSENT_TOMORROW_PM |
| Otra fecha u horario | ABSENT_OTHER_SLOT |
| Recoger en agencia | ABSENT_PICKUP_AGENCY |

Chatby ID: **1549385**. Meta ID: **1490544536242876**. Submission: **2026-09-16T14:52:13Z**. Estado inicial PENDING; consulta de catálogo registrada a **2026-09-16T15:22:11Z: APPROVED**, UTILITY, igualdad de texto/botones verificada. No se ha reenviado para aprobación ni creado otra plantilla. Ejemplos sintéticos: Carlos, 1400000. {{1}} nombre; {{2}} referencia legible autorizada. No se han rellenado/enviado variables de clientes reales.

Body SHA-256: `f001e01ed2647314f46cadca4ac886533541f299625672bcb5641e5d0e5e17cb`.

Botones presentación SHA-256: `fccf8ae38cc4752c1ccfb7771f10807b19e50cd24044d8ade222b066a18bd561`.

Integridad: PASS; UTF-8/NFC, dos variables exactas, cuatro QUICK_REPLY exactos, round-trip JSON/catálogo Chatby igual al original. Cero botones CALL/PHONE_NUMBER. Sin llamadas, teléfonos, emojis, descuentos, HTML/Markdown, BOM, NBSP, zero-width, controles, escapes literales o caracteres corruptos. No sobrescritura de plantilla productiva, no duplicación y no bucle de resubmission. No se edita el antiguo flujo nativo Chatby.

La aprobación solo deja la plantilla disponible para simulación. No se conecta a un flujo de envío ni se envía una prueba real.

Los cuatro IDs internos están versionados. El lector reutiliza los campos de botón del proveedor cuando existen; el fallback exige la etiqueta aprobada exacta normalizada, sin fuzzy matching. No hay todavía un mensaje real pulsado de esta plantilla nueva: sería incorrecto presentar el round-trip del catálogo o los tests sintéticos como prueba de entrega o respuesta de un cliente.

## 16–19. Replay histórico e interpretación

La muestra procede del read model real, sin modificar pedidos históricos. Primera fotografía: 100 candidatos históricos NAM, todos inactivos y terminales; no acreditan por sí mismos una ausencia inequívoca. La sincronización natural incorporó otros nueve candidatos canónicos activos. Replay SELECT-only de la fotografía de **2026-09-16T15:51:32.313Z**, sin llamadas externas:

| Métrica | Resultado |
| --- | ---: |
| Candidatos canónicos analizados | 109 |
| Primera ausencia verificable | 0 |
| Segunda ausencia verificable | 0 |
| Intento desconocido | 109 |
| Con respuesta privada almacenada en el intervalo del caso | 2 |
| Respuesta/fuente Chatby no verificable para decisión actual | 109 |
| Solicita nueva entrega / recogida / devolución | 0 / 0 / 0 |
| Logística FEASIBLE / UNKNOWN / STALE_DATA / NOT_FEASIBLE | 0 / 0 / 9 / 100 |
| Historial canónico disponible | 109 |
| Mapping NAM no verificable | 100 |
| Revisión humana / automatizaría / no automatizaría | 109 / 0 / 109 |

Las dos métricas de respuesta se solapan: texto almacenado no equivale a lectura actual verificable. El replay no refresca GLS ni convierte una ausencia de datos en NO_RESPONSE confirmado. Los 100 terminales bloquean propuestas incoherentes sin cerrar casos o cancelar timers. Los nueve activos carecen de intento verificable y evidencia logística completa. El tracking de GLS no prueba retención, aceptación de agencia ni capacidad de franjas; esos campos no se inventan.

**Límite de cobertura:** esta muestra comprueba bloqueo seguro, histórico y proyección, pero no permite estimar una tasa de automatización de AUSENTES verdaderos con primer/segundo intento completos. Primera/segunda ausencia, recuperación de entrega y recogida viables tienen tests sintéticos; no se presentan como casos reales ejecutados. Falta evidencia gobernada suficiente para plantear LIVE. Métricas y verificaciones agregadas, sin conversaciones ni teléfonos, en `recipient-absent-shadow-verification.json`.

Ejemplos sintéticos verificados con mensaje del 16/09/2026:

- “viernes a partir de las 16:00” → 18/09/2026, FROM_TIME, 16:00.
- “mañana todo el día” → 17/09/2026, ALL_DAY.
- “el jueves por la tarde” → 17/09/2026, AFTERNOON.
- “devuélvelo” → RETURN_REQUEST; “cambia la dirección” → ADDRESS_CHANGE.
- “viernes a partir de las 3” → ambiguo, revisión (no inventar 03:00 o 15:00).
- Mensaje 16/09/2026 23:30 UTC equivale al 17/09 en Madrid; “mañana” → 18/09.

Viabilidad: paquete entregado/devuelto/no operable → NOT_FEASIBLE, sin cierres/cancelaciones. Capability/retención/pickup desconocidos → UNKNOWN y revisión. Fuentes antiguas → STALE_DATA. Un caso completamente verificado y fecha/calendario válidos puede producir WOULD_REQUEST_NEW_DELIVERY/WOULD_REQUEST_PICKUP_AT_AGENCY/WOULD_RETURN_TO_ORIGIN, nunca una ejecución.

## 20–21. Panel y verificación visual

Tarjeta “SIGUIENTE ACCIÓN · SIMULACIÓN”, intento, qué dijo el cliente en evidencia privada original, fecha/franja/recogida, motivo, viabilidad, confianza, historial/preferencia, timer original, fecha límite y frescura. Detalle plegable para no saturar. Diez filtros clicables: AUSENTE, primera, segunda, esperando cliente, respondió, nueva entrega, recogida, validación, revisión, simulación preparada. No botones de ejecución.

La autenticación, masking y evidencia original autorizada usan las reglas existentes. Para históricos inactivos hay que seleccionar alcance Todas/Históricas y el filtro AUSENTE; no se inventan incidencias activas. Se mantiene la respuesta original en el bloque privado de evidencia existente, no dentro del snapshot público del ledger.

Verificación del rol real de lectura del panel: diez filtros y `incidentOverview` correctos, 109 candidatos, 9 activos; la página de 100 devolvió 100 tarjetas SHADOW, ninguna sin proyección y todos sus flags false. Detalle privado de los dos casos con texto: respuesta original presente, cinco mensajes privados por caso, decisión persistida y `executed=false`; no se exportó su contenido. El conector MCP privado comprobó búsqueda y detalle con decisión SHADOW, masking y cero ejecuciones.

Las instrucciones del repositorio prohíben abrir/controlar navegador. Por ello se verifica el código real del panel mediante tests DOM, API/read model y hashes de recursos publicados. **No hay capturas de navegador; no se presentan imágenes fabricadas como evidencia del panel real.** La comprobación de composición visual en navegador sigue requiriendo una revisión del propietario o nueva instrucción que permita esa vía.

## 22–24. Pruebas, regresión y cero efectos

Suite canónica de `packages`, `services`, `apps`, `infrastructure` y `scripts`: **543/543 PASS**, cero skipped/fail/cancelled. Regresión completa disponible de `autoconfirm`: **78/78 PASS**. Los fixtures genéricos siguen comprobando otras tipologías; AUSENTE cuenta con cobertura específica nueva. Política: 32 pruebas; administración de plantilla: 5; lector GLS: 2; proyección/identidad/filtros: 4; DOM del frontend real: 2. Se prueban fuente exacta, negación/cambio posterior, ambigüedad, botones, Madrid, intento, logística, timer, idempotencia, zero-effects y no activación por entorno/aprobación.

Pruebas reales adicionales:

- API privada sin sesión en `/operations/api/operations/incidents/overview`: HTTP **401**.
- Consultas del rol real del panel: PASS; búsqueda/detalle MCP privado: PASS.
- Repetición consecutiva con entradas estables: ocho candidatos revisados por pasada, ledger **116 → 116**. Una nueva evidencia/estado de frescura puede originar una decisión diferente; no se confunde con duplicación.
- A **2026-09-16T15:56:12.458Z**: 109/109 candidatos proyectados, nueve activos; ledger de **117 decisiones sobre 109 incidencias**, acciones **0**, escrituras productivas **0**, ejecución/disparo externo **false**.
- Comparación de todas las filas del timer con la copia anterior a AUSENTE: 588 filas, SHA-256 ordenado **`b4202ffa173fb9dbd9d28270aa3eb884cde3345c69c71caac1ff97da1bf3e850`** en ambos extremos. No cambian contenidos ni vencimientos.

La evidencia de cero efectos se limita a la nueva lane AUSENTE: no exporta adaptador operativo, flags false y marcadores/counters zero comprobados por tests, CHECK SQL y ledger. El replay es SELECT-only. La única escritura externa administrativa realizada en esta fase es crear/enviar una plantilla para aprobación Meta. Los automatismos reales de rechazo independientes pueden continuar realizando sus acciones autorizadas; no se afirma que sus contadores globales sean cero.

## 25. Futura activación (NO autorizada ahora)

Requiere nueva autorización explícita, aprobación de plantilla, mapping/capacidad/retención/intent evidence verificables, shadow suficientemente cubierto y QA. No basta cambiar una variable: los flags están codificados como false y no existe executor de AUSENTE. Una fase posterior tendría que introducir un executor segregado con allowlist por pedido/incidencia, envío idempotente/verificado, relectura actual antes de cada acción, auditoría, retries seguros y kill switch. No activar por aprobación Meta ni por configuración accidental.

## Publicación y comprobaciones

Código publicado en rama `feat/recipient-absent-shadow-v1`, commit exacto desplegado **`9473d529c45fcbf338b75a696f057f5f1ef31c4d`**. No se fusiona esta base divergente en `main` de Render. Release inmutable `/opt/suleia-releases/9473d529c45fcbf338b75a696f057f5f1ef31c4d`; enlace canónico `/opt/suleia-operations` apunta a ella.

Migration 035 aplicada y comprobada. Publicación solo de API, MCP, ingestion-worker y recursos del review-panel; `.env` intacto, variables anteriores exactas, comandos/usuario/reinicio/redes y montaje privado MCP preservados. PostgreSQL, identidad, proxy, scheduler y motor anterior no se redeployan.

API y MCP healthy en la revisión exacta. El ingestion-worker completó su primer ciclo natural con `ok=true`, `first_cycle_complete=true`, `last_sync_ok=true`, `last_error=null` y cero acciones/escrituras. Durante el arranque su salud es 503 hasta acabar el primer ciclo; no se ocultó esa situación como un ciclo correcto. No se configura una automatización nueva de Codex: continúa el trabajador autónomo canónico existente.

Recursos publicados comparados byte a byte por SHA-256 con la release (versión de recursos `20260916-absent-shadow-v1`):

| Recurso | SHA-256 publicado = release |
| --- | --- |
| app.js | `1cbe6a72a87ff23ef7475626c7cefb3045c37377e791e1930c9cd556a512ca99` |
| styles.css | `b737ff7945a973c3aee07ff19a2fc30e11566b95518ee407207e80ad26622c3a` |
| index.html | `4c6850138b306a918cf9e059f3a7e9faaf6a44bc31b4506c7c6683575270501b` |

Revalidación independiente de Render: `dep-dala9fu1egvs73f2b9hg` permanece live en `2d52bc541db0bc2bb34bc8c3395ddf3eb9ae549c`; `INCIDENT_DISCOUNT_REAL_ENABLED`, `INCIDENT_DISCOUNT_RETURN_REAL_ENABLED` e `INCIDENT_DISCOUNT_RETURN_AUTOMATIC_ENABLED` siguen true. No se ha pausado ni alterado ese flujo, no se envió un descuento ni se solicitó una devolución manual desde esta fase AUSENTE. El 503 logístico de un rechazo previamente documentado no se presenta como corregido por este trabajo.

La primera publicación fallida se revirtió al runtime previo; se corrigieron permisos de fuentes y valores de entorno antes de publicar la release final. Copias recuperables restringidas de esquema/cuatro tablas y configuración privada en `/opt/suleia-backups/recipient-absent-shadow-<revision>`. El intento inicial incompleto de volcado completo no es una copia válida ni se usa como evidencia de recuperación. No se elimina información del propietario.

La implementación SHADOW y su publicación están verificadas técnicamente. Quedan explícitamente fuera de una afirmación de validación completa: capturas/QA visual de navegador, entrega/pulsación real de la plantilla y muestra histórica con intentos/capacidades verificables suficientes. Ninguna de esas carencias habilita LIVE.

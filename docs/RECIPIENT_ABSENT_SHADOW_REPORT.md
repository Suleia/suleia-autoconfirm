# AUSENTE: implementación y validación SHADOW

Fecha: 16 de septiembre de 2026. Alcance autorizado: únicamente AUSENTE. Los descuentos y devoluciones de rechazos existentes en Render no se modifican ni se pausan.

## 1. Auditoría previa

Se reutilizan los componentes canónicos del VPS: ingestión Dropea V2, enlace exacto de conversación Chatby, almacenamiento cifrado de mensajes privados, interpretación, libro inmutable de simulaciones, timer general de 48 horas, historial operacional del cliente, read models y panel privado. No se crea un segundo motor en Render.

La entrada antigua de AUSENTE podía completar una fecha/franja ausente con una estimación del calendario y `afternoon`. Se elimina esa rama y ambas entradas delegan en la política canónica nueva. Otros tipos conservan su lógica. El mapping antiguo NAM se mantiene para no reclasificar otros procesos, pero NAM con tipo bruto genérico no se considera ausencia verificada. No se convierte globalmente el código numérico -30 en AUSENTE. Solo tipo explícito RECIPIENT_ABSENT o equivalentes gobernados AS/AUSENTE entran de forma inequívoca.

Se detectó divergencia entre la copia de código del panel y el trabajador publicado. Se preservan la caché y presupuesto equitativo de conversaciones y el contexto de plantillas del trabajador real para no aumentar consultas ni perjudicar los envíos de rechazo.

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

Chatby ID: **1549385**. Meta ID: **1490544536242876**. Submission: **2026-09-16T14:52:13Z**. Estado inicial PENDING; última consulta de catálogo: **APPROVED**, UTILITY, igualdad de texto/botones verificada. No se ha resubmitted ni creado otra plantilla. Ejemplos sintéticos: Carlos, 1400000. {{1}} nombre; {{2}} referencia legible autorizada. No se han rellenado/envíado variables de clientes reales.

Body SHA-256: `f001e01ed2647314f46cadca4ac886533541f299625672bcb5641e5d0e5e17cb`.

Botones presentación SHA-256: `fccf8ae38cc4752c1ccfb7771f10807b19e50cd24044d8ade222b066a18bd561`.

Integridad: PASS; UTF-8/NFC, dos variables exactas, cuatro QUICK_REPLY exactos, round-trip JSON/catálogo Chatby igual al original. Cero botones CALL/PHONE_NUMBER. Sin llamadas, teléfonos, emojis, descuentos, HTML/Markdown, BOM, NBSP, zero-width, controles, escapes literales o caracteres corruptos. No sobrescritura de plantilla productiva, no duplicación y no bucle de resubmission. No se edita el antiguo flujo nativo Chatby.

La aprobación solo deja la plantilla disponible para simulación. No se conecta a un flujo de envío ni se envía una prueba real.

## 16–19. Replay histórico e interpretación

La muestra procede del read model real, sin modificar pedidos históricos ni conectores. Los resultados y límites de cobertura se registrarán tras ejecutar el replay publicado; no se presentarán registros NAM ambiguos como ausencias inequívocas.

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

La autenticación, masking y evidencia original autorizada usan las reglas existentes. Para históricos inactivos hay que seleccionar alcance Todos/histórico; no se inventan incidencias activas.

Las instrucciones del repositorio prohíben abrir/controlar navegador. Por ello se verifica el código real del panel mediante tests DOM, API/read model y hashes de recursos publicados. **No hay capturas de navegador; no se presentan imágenes fabricadas como evidencia del panel real.** La comprobación de composición visual en navegador sigue requiriendo una revisión del propietario o nueva instrucción que permita esa vía.

## 22–24. Pruebas, regresión y cero efectos

Suite canónica: **539/539 PASS**. Regresión AutoConfirm disponible en esta base: **78/78 PASS**. Los fixtures genéricos siguen comprobando otras tipologías; AUSENTE cuenta con cobertura específica nueva. Tests adicionales y evidencia de servidor se añadirán antes del cierre.

La evidencia de cero efectos se limita a la nueva lane AUSENTE: no exporta adaptador operativo, flags false y marcadores/counters zero comprobados por tests, CHECK SQL y ledger. El replay es SELECT-only. La única escritura externa administrativa realizada en esta fase es crear/enviar una plantilla para aprobación Meta. Los automatismos reales de rechazo independientes pueden continuar realizando sus acciones autorizadas; no se afirma que sus contadores globales sean cero.

## 25. Futura activación (NO autorizada ahora)

Requiere nueva autorización explícita, aprobación de plantilla, mapping/capacidad/retención/intent evidence verificables, shadow suficientemente cubierto y QA. No basta cambiar una variable: los flags están codificados como false y no existe executor de AUSENTE. Una fase posterior tendría que introducir un executor segregado con allowlist por pedido/incidencia, envío idempotente/verificado, relectura actual antes de cada acción, auditoría, retries seguros y kill switch. No activar por aprobación Meta ni por configuración accidental.

## Publicación y comprobaciones

Pendientes de registrar: commit GitHub, migration VPS, hashes de recursos públicos/privados, salud de servicios, proyección/replay reales y comprobación de entorno preservado. Esta sección no afirma despliegue hasta tener evidencia.

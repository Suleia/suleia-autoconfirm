# Fase 0 — Reauditoría de gestión inteligente de incidencias

Fecha de corte: 2026-08-09 10:43 UTC.

Ámbito: inventario, estado real, errores reproducibles, backup/restauración, reutilización y puerta de fase. No se ha programado la gestión inteligente ni se ha cambiado lógica productiva.

## Resultado ejecutivo

La puerta es **NO_GO** para comenzar la Fase 1.

La base de datos, la API de solo lectura, Dropea V2, el panel público, OAuth y el backup son recuperables y reutilizables. Sin embargo, cuatro precondiciones indispensables no están satisfechas:

1. ChatGPT ve un catálogo MCP distinto al desplegado: intenta `list_orders` y `list_incidents`, mientras el servidor publica `search_orders` y `search_incidents`. Las dos consultas reales devuelven `Unknown tool`.
2. El commit exacto del runtime no se puede demostrar: `/opt/suleia-operations` no tiene metadatos Git y las imágenes de aplicación no exponen una revisión OCI verificable.
3. El verificador autenticado de Keycloak/MCP no es seguro ante interrupciones: un timeout dejó Keycloak detenido hasta la recuperación manual. El servicio quedó restaurado y públicamente sano, pero la prueba completa no puede darse por aprobada.
4. Chatby permanece caducado y el worker recibe HTTP 401. No existe evidencia conversacional actual suficiente para construir decisiones inteligentes reales.

Avanzar pese a estos fallos violaría la instrucción de no inventar contratos y de preservar el acceso auditor.

## Salvaguardas

- Rama: `checkpoint/real-operations-readonly-20260807`.
- Commit local auditado: `2c651a1f33f39fbe79b5848c5a2b9966a42e4a9f`.
- Checkpoint remoto previo: `incident-intelligence-phase0-20260809T095029Z`.
- Cambio ajeno preservado y excluido: `contracts/external/dropea/public-api-v2/0.1.0/openapi.json`.
- Modo: `SHADOW_READ_ONLY`.
- Action Executor: desactivado.
- `actions_executed=0`.
- `production_writes=0`.
- Mensajes, descuentos, confirmaciones, cancelaciones y resoluciones externas: 0.
- Coste OpenAI API: 0 €.
- Transportista aplicable: GLS. TIPSA: `NOT_APPLICABLE/DEPRECATED`.

## Backup y restauración

- Backup fresco: `/backups/suleia-20260809T095508Z.dump`.
- Checksum: correcto.
- Archivo legible por `pg_restore`: correcto.
- Restauración aislada: correcta.
- Tablas de aplicación restauradas: 75.
- Base temporal eliminada: verificado; no permanece una base de ensayo.
- No se aplicó ninguna migración ni escritura funcional.

## Inventario real

### Runtime

| Componente | Estado observado |
|---|---|
| PostgreSQL | healthy |
| API | healthy, `SHADOW_READ_ONLY` |
| MCP server | healthy y protegido |
| MCP Edge | healthy |
| Keycloak | restaurado y running |
| Operations Center | HTTP 200 |
| Ingestion worker | unhealthy por Chatby 401 |
| Dropea V2 GET | HTTP 200 / sincronización reciente |
| Chatby GET | HTTP 401 / fuente `STALE` |
| Decision Engine | contenedor activo, lógica funcional `NOT_IMPLEMENTED` |
| Scheduler | contenedor activo, lógica funcional `NOT_IMPLEMENTED` |
| Action Executor | desactivado |

Imágenes observadas: API `sha256:a9ba449e…`, MCP `sha256:9f3cad84…`, ingestion worker `sha256:4f13e568…`. Estos digests identifican artefactos, pero no prueban el commit de aplicación.

### PostgreSQL y datos

| Métrica | Valor |
|---|---:|
| Esquemas de aplicación | 21 |
| Relaciones | 131 |
| Tablas / vistas | 97 / 34 |
| Pedidos | 961 |
| Incidencias | 327 |
| Incidencias activas PENDING | 18 |
| Incidencias accionables | 0 |
| Incidencias UNMAPPED/UNKNOWN | 216 / 216 |
| Enlaces Chatby / eventos Chatby | 18 / 0 |
| Temporizadores activos / vencidos efectivos | 18 / 16 |
| Decisiones simuladas | 37 |
| Observaciones económicas | 760 |

El catálogo técnico completo y el diccionario ya reproducidos permanecen en:

- `docs/audit/2026-08-09-phase0/database-objects.csv`
- `docs/audit/2026-08-09-phase0/database-technical-catalog.csv`
- `docs/audit/2026-08-09-panel-incidents-phase0/canonical-data-dictionary.csv`
- `docs/audit/2026-08-09-panel-incidents-phase0/REAL_DATA_CONTRACT.md`

## Errores reproducidos

### Catálogo MCP no invocable desde ChatGPT

- OAuth discovery: HTTP 200.
- Operations Center: HTTP 200.
- MCP sin token: HTTP 401 esperado.
- `get_data_freshness`: invocado correctamente desde ChatGPT; devolvió datos enmascarados, `read_only=true`, `simulation_only=true`, `actions_executed=0`.
- Búsqueda de pedidos: ChatGPT invocó `list_orders`; servidor respondió `Unknown tool`.
- Búsqueda de incidencias: ChatGPT invocó `list_incidents`; servidor respondió `Unknown tool`.

El problema no es que el backend esté caído: es una incompatibilidad real entre catálogo publicado/almacenado por ChatGPT y catálogo implementado por el VPS. El acceso auditor queda clasificado `PARTIAL/BLOCKED`, no `VERIFIED`.

### Verificador OAuth no tolerante a interrupciones

La prueba `verify-keycloak-mcp-e2e.sh` agotó su tiempo después de detener Keycloak para un bootstrap temporal. Su limpieza eliminó el secreto local temporal, pero no garantizó el arranque del servicio. Keycloak se restauró y se verificó después:

```text
oauth=200
operations=200
mcp_unauth=401
```

No se repitió la prueba insegura. Debe corregirse primero con un `trap` que restaure el servicio incluso ante timeout o señal, y después ejecutarse una vez de extremo a extremo.

### Contexto de Chatby no utilizable

- El token actualmente cargado devuelve HTTP 401.
- La fuente Chatby se reporta `STALE`.
- Los 18 enlaces de conversación no contienen eventos materializados.
- Hay 0 respuestas válidas posteriores a la incidencia.

Una integración de incidencias no puede interpretar silencio, rechazo o cambio de dirección con este estado sin inventar evidencia.

### Contradicciones de modelo ya reproducidas

- 0 pedidos en estado actual SHIPPING frente a 487 DELIVERED/FINISHED y 0 hitos históricos SHIPPED.
- 18 incidencias activas PENDING frente a tarjeta pending=0 y awaiting_customer=327.
- 18/18 contextos conversacionales `STALE` frente a resumen stale=0.
- 18 timers `ACTIVE`, de los cuales 16 ya superaron `due_at`.
- 216 incidencias sin mapping verificado.

## Clasificación de reutilización

- **REUSE**: PostgreSQL, API read-only, MCP Edge, Action Executor apagado, Dropea V2 GET, backups y salvaguardas 0/0.
- **EXTEND**: modelos de pedido/incidencia, frescura, timers, catálogo GLS, panel y metadatos de despliegue.
- **MIGRATE**: contexto conversacional a eventos canónicos e interfaz de Render hacia el VPS sin cutover prematuro.
- **REPLACE**: credencial Chatby inválida, catálogos MCP incoherentes, placeholders de Decision Engine/Scheduler.
- **CREATE**: expediente único, análisis tipados, feedback supervisado, ledger económico y manifiesto verificable de despliegue.

La matriz completa está en `reuse-gap-matrix.csv`; el inventario, en `component-inventory.csv`.

## Puerta NO_GO y corrección mínima

No se autoriza Fase 1 todavía. El orden mínimo para reabrir la puerta es:

1. Fijar una única versión del catálogo MCP, igualar nombres implementados y publicados, forzar actualización/Scan Tools y demostrar desde ChatGPT: buscar pedidos, buscar incidencias y abrir un expediente enmascarado.
2. Añadir al build una revisión OCI/manifest sanitizado y realizar un despliegue controlado desde un commit Git conocido; verificar que el digest activo corresponde a ese commit.
3. Hacer el verificador Keycloak/MCP tolerante a interrupciones; probar tanto salida normal como interrupción y confirmar Keycloak healthy en ambos casos.
4. Emitir/instalar una credencial Chatby válida sin modificar plantillas ni flujos; aceptar solo con GET 200, worker healthy y eventos conversacionales actuales.
5. Repetir backup/restauración, baseline 0/0 y prueba auditor. Solo entonces emitir un nuevo GO/NO_GO.

## Rollback de Fase 0

Esta fase solo añade documentación. El rollback es revertir su commit documental. No existe rollback de base de datos ni de runtime porque no se desplegó código, no se ejecutaron migraciones y no se alteraron datos operativos.

## Evidencias

- `baseline-metrics.json`
- `component-inventory.csv`
- `reuse-gap-matrix.csv`
- `infrastructure/audit/panel-incident-phase0.sql`
- `docs/audit/2026-08-09-panel-incidents-phase0/PHASE0_PANEL_INCIDENT_DIAGNOSIS.md`
- `docs/audit/2026-08-09-phase0/PHASE0_REAUDIT_REPORT.md`

## Resultado final

```text
PHASE_0 = COMPLETE
PHASE_1_GATE = NO_GO
actions_executed = 0
production_writes = 0
external_ai_cost_eur = 0
auditor_access = PARTIAL_BLOCKED_CATALOG_MISMATCH
keycloak = RESTORED_RUNNING
backup_restore = VERIFIED
```

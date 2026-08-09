# Fase 0 — Reauditoría reproducible de Suleia

Fecha de corte: 2026-08-09 07:12 UTC

Checkpoint Git previo: `phase0-reaudit-20260809T064850Z` (`7e9318a5a9a4332f118855ae53444f7b9cf7bf8f`)

Rama: `checkpoint/real-operations-readonly-20260807`

## 1. Objetivo y alcance

Esta fase reproduce el inventario técnico y convierte los 239 hallazgos existentes en un registro estable, deduplicado y trazable. No cambia lógica funcional, datos operativos, credenciales, conectores, plantillas, pedidos ni incidencias.

Alcance ejecutado:

- repositorio, rama, commit y worktree;
- runtime VPS, imágenes, contenedores, dependencias y modos;
- API, MCP, PostgreSQL, Keycloak, Operations Center, workers y procesos auxiliares;
- catálogo MCP desplegado;
- catálogo PostgreSQL técnico sin valores PII;
- backup, checksum y restauración aislada;
- Render y disponibilidad del inventario Supabase mediante GET;
- matriz de los 239 hallazgos y hallazgos de plataforma adicionales.

## 2. Estado inicial con evidencia

### Seguridad efectiva

| Control | Resultado |
|---|---|
| `RUN_MODE` | `SHADOW_READ_ONLY` |
| `SIMULATION_ONLY` | `true` |
| `PRODUCTION_WRITES_ENABLED` | `false` |
| `ACTION_EXECUTOR_ENABLED` | `false` |
| `MCP_WRITE_TOOLS_ENABLED` | `false` |
| Confirmación/cancelación/mensajes/descuentos | `false` |
| `actions_executed` | `0` |
| `production_writes` | `0` |
| Rol MCP: `SELECT` sobre read model | permitido |
| Rol MCP: `INSERT` sobre `core.orders` | denegado |
| Rol API: `SELECT` sobre read model | permitido |
| Rol API: `INSERT` sobre `core.orders` | denegado |

El worktree tenía antes de esta fase una modificación ajena en `contracts/external/dropea/public-api-v2/0.1.0/openapi.json`. Se preservó intacta y queda fuera del commit.

### Runtime y dependencias

```text
Internet -> MCP Edge -> Keycloak
                    -> MCP Server -> PostgreSQL
                    -> Operations Center -> API -> PostgreSQL
Ingestion Worker -> Dropea V2 GET / Chatby GET / Supabase legacy GET -> PostgreSQL
Decision Engine -> marcador de simulación, sin ciclo funcional
Scheduler -> marcador de simulación, sin tareas
Backup maintenance -> PostgreSQL -> volumen privado
Render/Supabase -> permanecen fuera del cutover y no fueron modificados
```

| Componente | Estado demostrado | Evidencia |
|---|---|---|
| API | `HEALTHY`, `VERIFIED` | HTTP interno 200, `SHADOW_READ_ONLY`, 0/0 |
| MCP | `HEALTHY`, `FUNCTIONAL_RECENT` | health 200, 16 tools, llamadas OAuth correctas en logs sanitizados durante las 24 h anteriores |
| PostgreSQL 17.5 | `HEALTHY`, `VERIFIED` | contenedor healthy y consultas de roles readonly |
| Keycloak 26.7 | `HEALTHY`, `VERIFIED` | readiness interno 200/UP y discovery público 200 |
| Operations Center | `FUNCTIONAL`, health sintético pendiente | HTML público 200/no-store; API healthy; falta healthcheck end-to-end del contenedor |
| Ingestion Worker | `UNHEALTHY` | HTTP 503, primer ciclo incompleto, Chatby GET 401 |
| Dropea V2 GET | transporte y lectura recientes | último éxito 2026-08-09 06:48:32 UTC; paginación completa |
| Chatby GET | `UNHEALTHY` | `chatby_subscribers GET failed with HTTP 401` |
| Decision Engine | `RUNNING`, `NOT_IMPLEMENTED` funcionalmente | respuesta estática; no hay ciclo ni dependencia comprobada |
| Scheduler | `RUNNING`, `NOT_IMPLEMENTED` funcionalmente | respuesta estática; cron/timers inexistentes |
| Backup | `VERIFIED_MANUALLY` | checksum y restauración aislada correctos; health automático deficiente |
| Render | `RUNNING`, `LIVE` | servicio no suspendido; deploy `dep-d9rfln8n74is73eo5e10` live |
| Supabase desde Render | `NOT_CONFIGURED` para inventario | faltan `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; GET-only inventory no pudo iniciarse |

### Inventario PostgreSQL

| Métrica | Total |
|---|---:|
| Esquemas de aplicación | 21 |
| Tablas/vistas/materializadas | 131 |
| Modelos de lectura | 28 |
| Funciones | 37 |
| Triggers no internos | 1 |
| Índices | 182 |
| Constraints | 304 |
| Entradas de catálogo técnico exportadas | 2.478 |
| Migraciones y rollbacks locales | 15 + 15 |

Los objetos están enumerados en `database-objects.csv`; esquemas, columnas, tipos, nulabilidad, defaults, constraints, índices, funciones y triggers están en `database-technical-catalog.csv`. El catálogo contiene metadatos, no valores de filas.

### Catálogo MCP realmente desplegado

Se enumeraron 16 tools desde el módulo dentro del contenedor desplegado:

1. `get_order`
2. `get_order_timeline`
3. `get_data_freshness`
4. `get_active_timers`
5. `get_agent_decisions`
6. `preview_order_decision`
7. `compare_simulation_with_current_system`
8. `list_orders_needing_ai_review`
9. `search_orders`
10. `search_incidents`
11. `get_incident`
12. `search_operational_findings`
13. `get_platform_overview`
14. `get_runtime_inventory`
15. `get_database_catalog`
16. `get_component_details`

Todas son lectura o simulación; el servidor declara `read_only=true`, `simulation_only=true` y `actions_executed=0`. No hay tool de escritura.

## 3. Archivos y migraciones modificados

Archivos de auditoría creados:

- `infrastructure/audit/phase0-snapshot.sql`
- `infrastructure/audit/generate-phase0-artifacts.mjs`
- `docs/audit/2026-08-09-phase0/findings-register.csv`
- `docs/audit/2026-08-09-phase0/findings-summary.json`
- `docs/audit/2026-08-09-phase0/database-objects.csv`
- `docs/audit/2026-08-09-phase0/database-technical-catalog.csv`
- `docs/audit/2026-08-09-phase0/additional-platform-findings.csv`
- `docs/audit/2026-08-09-phase0/PHASE0_REAUDIT_REPORT.md`

Migraciones modificadas o ejecutadas: ninguna.

## 4. Cambios implementados

Solo se implementó instrumentación documental reproducible:

- consulta SQL `SELECT` que genera el snapshot sin IDs operativos en claro;
- generador que exige exactamente 239 hallazgos únicos;
- validación de relaciones de duplicidad;
- inventario PostgreSQL técnico sin valores PII;
- registro adicional de defectos descubiertos durante la reauditoría.

No se desplegó código funcional.

## 5. Decisiones y contratos

### Contrato de hallazgos

Cada fila incluye `finding_id`, título, componente, evidencia, severidad, causa raíz, impacto, estado, corrección, prueba, commit/despliegue, propietario, fecha objetivo, riesgo residual y referencias enmascaradas.

El `finding_id` es determinista. Los duplicados no se eliminan: conservan su fila y apuntan a `duplicate_of`.

Descomposición comprobada:

| Grupo | Filas | Estado documental después de deduplicar |
|---|---:|---|
| Códigos GLS raíz sin mapear | 5 | `OPEN` |
| Incidencias GLS vinculadas a esos códigos | 214 | `DUPLICATE`, enlazadas al raíz |
| Incidencias GLS sin código de origen | 2 | `OPEN` |
| Revisiones de protecciones | 17 | `OPEN` |
| Agregado de calidad | 1 | `OPEN` |
| Total | 239 | 239 filas conservadas |

Resultado: 239 IDs únicos, 214 relaciones de duplicidad válidas, 0 duplicados huérfanos, 25 abiertos. Las 216 incidencias `UNKNOWN` siguen operativamente sin clasificar; esta fase no altera su categoría.

### Contrato de frescura

La lectura actual de Dropea era reciente, pero el defecto histórico queda confirmado estructuralmente: `shadow-sync.mjs` persiste `lag_seconds=0` y `FRESH` al completar una lectura. No existe aún una función canónica con umbral y envejecimiento dinámico. Por ello el sistema puede volver a mostrar `FRESH` cuando la edad real supere 600 segundos. Se registra como `PF0-001` y es la primera corrección de Fase 1.

## 6. Comandos y pruebas ejecutados

| Prueba | Resultado |
|---|---|
| Git status/branch/commit/tag | PASS; cambio ajeno preservado |
| Docker runtime inventory | 11 contenedores enumerados |
| Flags de seguridad | PASS; escrituras y executor desactivados |
| API health | PASS, 0/0 |
| MCP health y catálogo | PASS, 16 tools, readonly |
| Keycloak readiness/discovery | PASS, 200/UP |
| Panel público | PASS, 200 y `no-store` |
| MCP sin token | PASS, 401 esperado |
| Privilegios PostgreSQL | PASS, SELECT permitido e INSERT denegado |
| Catálogo PostgreSQL | PASS, 131 objetos y 2.478 entradas técnicas |
| Matriz de hallazgos | PASS, 239/239 IDs únicos |
| Relaciones duplicate_of | PASS, 214 válidas y 0 huérfanas |
| Escaneo de PII básico | PASS, sin email ni IDs canónicos |
| Regresión completa del repositorio | PASS, 374/374 pruebas |
| Backup checksum/archive | PASS |
| Restore drill aislado | PASS, 75 tablas; base temporal eliminada |
| Render GET-only | PASS, deploy live |
| Supabase inventory GET-only | NO_GO local: credenciales no configuradas en Render |
| Ingestion health | FAIL esperado: 503 Chatby 401 |

## 7. Métricas antes y después

No hubo modificación del runtime; los cambios son de clasificación documental.

| Métrica | Antes | Después |
|---|---:|---:|
| Hallazgos conservados | 239 | 239 |
| IDs estables/únicos | no demostrado | 239 |
| Duplicados enlazados | no demostrado | 214 |
| Duplicados huérfanos | no demostrado | 0 |
| Hallazgos documentales abiertos | 239 | 25 |
| Incidencias GLS UNKNOWN | 216 | 216 |
| Acciones ejecutadas | 0 | 0 |
| Escrituras de producción | 0 | 0 |
| Coste de API/IA externo | 0 € | 0 € |

Se descubrieron además 12 defectos de plataforma en `additional-platform-findings.csv`; no se mezclan ni sustituyen las 239 filas originales.

## 8. Estado del acceso auditor

- Endpoint MCP público: disponible y protegido; 401 Bearer sin token.
- OAuth discovery: HTTP 200.
- MCP interno: healthy, 16 tools.
- Logs sanitizados: llamadas OAuth correctas dentro de las 24 horas anteriores a `get_platform_overview`, `search_orders`, `search_incidents`, `get_database_catalog` y otras tools; `pii_logged=false`, `actions_executed=0`.
- Limitación: algunas consultas sin límite explícito producen `RESPONSE_TOO_LARGE`; las consultas paginadas funcionan. Se registra `PF0-007`.

Clasificación: `FUNCTIONAL_RECENT`, no `VERIFIED_NOW` mediante una nueva sesión interactiva. No se abrió navegador ni se alteró OAuth.

## 9. Acciones y escrituras

Resultado final de fase:

```text
actions_executed = 0
production_writes = 0
customer_messages = 0
order_mutations = 0
incident_resolutions = 0
discounts = 0
```

## 10. Backup y rollback

Backup: `suleia-20260809T065253Z.dump`.

- retención configurada: 14 días;
- checksum SHA-256: PASS;
- estructura `pg_restore --list`: PASS;
- restauración: base aislada `suleia_restore_drill`;
- tablas de aplicación restauradas: 75;
- limpieza: la base temporal fue eliminada automáticamente;
- producción: no modificada.

Rollback de esta fase: revertir el commit documental de Fase 0. No existe rollback de base o despliegue porque no se aplicó ninguna migración ni código runtime.

## 11. Riesgos y pendientes

Bloqueos principales:

1. frescura falsa posible por `FRESH/lag=0` persistido sin umbral;
2. ingestion worker 503 por Chatby 401;
3. Decision Engine y Scheduler son `NOT_IMPLEMENTED` funcionalmente;
4. catálogo MCP y búsquedas pueden exceder el límite de respuesta;
5. health automático de backup no incorpora la restauración verificada;
6. procedencia Git del VPS aparece `UNKNOWN`;
7. catálogo PostgreSQL MCP oculta metadatos técnicos;
8. inventario Supabase no está configurado en Render;
9. 216/327 incidencias GLS permanecen `UNKNOWN` (66,1 %).

No hay una ruta de escritura activa ni un `CRITICAL` capaz de ejecutar cambios en producción bajo la configuración actual. Todo cambio irreversible permanece bloqueado.

## 12. Commit creado

El commit de esta fase es el commit que incorpora este informe y sus artefactos; su SHA se registra en el Agent Hub. El checkpoint anterior permanece en `phase0-reaudit-20260809T064850Z`.

## 13. Decisión para la fase siguiente

**GO para Fase 1, exclusivamente frescura y healthchecks en modo `SHADOW_READ_ONLY`.**

Condiciones:

- corregir primero el modelo de frescura y demostrar los límites 9/10/11 minutos;
- representar el worker Chatby como `UNHEALTHY` sin ocultar el éxito parcial Dropea;
- no rotar credenciales ni alterar Chatby/Keycloak sin autorización expresa;
- no iniciar Fase 2 hasta volver a verificar 0/0, acceso auditor y backup;
- detenerse con `NO_GO` si cualquier prueba abre una capacidad de escritura.

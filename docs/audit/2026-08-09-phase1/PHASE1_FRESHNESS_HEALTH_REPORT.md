# Fase 1 — Frescura canónica y salud funcional de Suleia

Fecha de corte: 2026-08-09 08:53 UTC

Checkpoint Git previo: `phase1-freshness-20260809T073027Z` (`2993c41`)

Rama: `checkpoint/real-operations-readonly-20260807`

## 1. Objetivo y alcance

La fase corrige la frescura falsa de las fuentes y sustituye estados de salud basados únicamente en procesos por evidencia funcional. El alcance se limita a lecturas, cálculo, inventario, migración compatible y verificación. No modifica la lógica del agente, pedidos, incidencias, mensajes, plantillas, descuentos ni credenciales.

Controles mantenidos durante toda la fase:

- `SHADOW_READ_ONLY` y `SIMULATION_ONLY=true`;
- Action Executor y herramientas MCP de escritura desactivados;
- `actions_executed=0`;
- `production_writes=0`;
- coste externo adicional y OpenAI API: 0 €.

## 2. Estado inicial con evidencia

| Área | Estado inicial demostrado |
|---|---|
| Frescura Dropea | podía persistir `FRESH` con `lag_seconds=0` sin recalcular la edad en el momento de consulta; el caso auditado de 80.650 s podía aparecer fresco |
| Chatby | último dato antiguo y lectura GET rechazada con HTTP 401 |
| Ingestion Worker | HTTP 503 y ciclo completo inexistente |
| Decision Engine | proceso marcador con respuesta estática; funcionalidad no implementada |
| Timer Engine | módulo de simulación, sin servicio autónomo desplegado |
| Scheduler | proceso marcador sin tareas ni ciclos funcionales |
| Panel | HTML público disponible, sin lectura autenticada sintética en el ciclo |
| Keycloak | readiness `UP` |
| Backup | checksum y restauración manual válidos, pero sin estado funcional publicado |

El backup previo fue creado en `/backups/suleia-20260809T073047Z.dump` y se definieron rollback SQL y copias privadas del código desplegado antes de modificar el runtime.

## 3. Archivos y migraciones modificados

Archivos funcionales y pruebas:

- `packages/platform-core/src/operational-truth/freshness.mjs`
- `packages/platform-core/test/freshness.test.mjs`
- `packages/suleia-operations-mcp/src/data/postgres-read-repository.mjs`
- `packages/suleia-operations-mcp/src/domain/service.mjs`
- `packages/suleia-operations-mcp/src/operations/repository.mjs`
- `packages/suleia-operations-mcp/src/platform/catalog.mjs`
- `packages/suleia-operations-mcp/test/platform-readonly.test.mjs`
- `packages/suleia-operations-mcp/test/postgres-readonly.test.mjs`
- `apps/api/canonical-freshness-contract.test.mjs`
- `services/process-runner.mjs`
- `services/process-runner-contract.test.mjs`
- `infrastructure/scripts/collect-platform-runtime-inventory.mjs`
- `infrastructure/vps/apply-source-freshness-migration.sh`
- `infrastructure/vps/run-source-freshness-rollback-drill.sh`
- `infrastructure/vps/verify-source-freshness-deploy.sh`

Migraciones:

- `migrations/016_canonical_source_freshness.sql`
- `migrations/rollback/016_canonical_source_freshness.down.sql`

El cambio ajeno existente en `contracts/external/dropea/public-api-v2/0.1.0/openapi.json` se conservó intacto y permanece fuera de todos los commits de esta fase.

## 4. Cambios implementados

1. Se creó una función canónica única de frescura con umbrales configurables por fuente.
2. Se añadieron cinco dimensiones persistentes al modelo de lectura y el cálculo dinámico en el momento de consulta.
3. El repositorio MCP selecciona el checkpoint más reciente por mercado, tienda y recurso; nunca acepta `FRESH` cuando `age_seconds` supera el umbral.
4. El Operations Center consume la misma semántica canónica.
5. Los procesos marcador devuelven `501 NOT_IMPLEMENTED`, no salud falsa.
6. El inventario publica evidencia funcional, razón y `checked_at` para once componentes.
7. El backup se considera saludable únicamente después de checksum, lectura del archivo, restauración aislada y limpieza.
8. El verificador de despliegue contrasta también el catálogo que publica el MCP, no solo los archivos locales.

## 5. Decisiones y contratos

### Contrato canónico de frescura

Campos publicados:

- `source_observed_at`
- `source_event_at`
- `ingested_at`
- `last_successful_sync_at`
- `age_seconds`
- `ingestion_lag_seconds`
- `clock_skew_seconds`
- `freshness_threshold_seconds`
- `freshness_status`

Estados: `FRESH`, `STALE`, `UNAVAILABLE`, `UNKNOWN`, `CLOCK_SKEW`.

Umbrales iniciales: Chatby 300 s, Dropea 600 s, GLS 900 s y Shopify 900 s fuera de Control de gasto. La frontera es inclusiva: edad menor o igual al umbral es `FRESH`; cualquier valor superior es `STALE`. Timestamps futuros u orden temporal imposible producen `CLOCK_SKEW`. Una sincronización parcial o un fallo posterior al último éxito produce `UNAVAILABLE`.

`age_seconds` mide la antigüedad del último ciclo satisfactorio. `ingestion_lag_seconds` mide la distancia entre el evento de origen y la ingesta, y no se usa como sustituto de la salud de sincronización. El desfase normal de reloj se informa como `0`; solo se informa un valor positivo cuando existe un orden temporal imposible.

### Contrato de salud

Estados funcionales publicados: `HEALTHY`, `DEGRADED`, `UNHEALTHY`, `UNKNOWN` y `NOT_IMPLEMENTED`. Cada registro incluye razón, evidencia y `checked_at`. Un contenedor vivo no basta para declarar salud.

## 6. Comandos y pruebas ejecutados

| Prueba | Resultado |
|---|---|
| Regresión completa `node --test` | PASS, 382/382 |
| Edades de 9, 10 y 11 minutos | PASS |
| Caso auditado de 80.650 s | PASS, `STALE` |
| Timestamp futuro y orden temporal imposible | PASS, `CLOCK_SKEW` |
| Timestamp nulo o inválido | PASS |
| Sincronización parcial/fallo posterior | PASS, `UNAVAILABLE` |
| UTC, DST y `Europe/Madrid` | PASS |
| Contenedor vivo con worker bloqueado | PASS, `UNHEALTHY` |
| Decision Engine/Scheduler sin ciclo | PASS, `NOT_IMPLEMENTED` |
| MCP disponible con datos caducados | PASS, agregado `STALE` |
| Migración 016 | PASS, cinco columnas canónicas |
| Drill up/down aislado | PASS, columnas 5 → 0 y base temporal eliminada |
| API `/health` | PASS, `SHADOW_READ_ONLY`, 0/0 |
| MCP `/health` y catálogo publicado | PASS |
| Keycloak readiness | PASS, `UP` |
| Backup checksum/archive/restore | PASS |
| Edge auditor | PASS, panel 200, discovery 200 y MCP sin token 401 |
| Verificación final desplegada | PASS, `SOURCE_FRESHNESS_DEPLOY_VERIFICATION` |

El drill detectó antes de producción dos incompatibilidades reales de PostgreSQL: no se pueden insertar columnas en medio de una vista mediante `CREATE OR REPLACE`, ni eliminar columnas de esa forma. Se corrigió la migración para añadir campos al final y el rollback para recrear la vista. Solo después se aplicó en el modelo de lectura del VPS.

## 7. Métricas antes y después

| Métrica | Antes | Después verificado |
|---|---:|---:|
| Caso Dropea de 80.650 s | podía ser `FRESH` | `STALE` |
| Campos canónicos persistentes | 0 | 5 |
| Componentes con evidencia funcional publicada | parcial/no uniforme | 11 |
| Chatby | estado antiguo no agregado correctamente | `STALE`, edad observada 90.107 s |
| Dropea orders, ciclo reciente | semántica no fiable | `FRESH`, edad 278 s, umbral 600 s |
| Dropea issues, ciclo reciente | semántica no fiable | `FRESH`, edad 278 s, umbral 600 s |
| Estado agregado de fuentes | podía ocultar datos antiguos | `STALE` por Chatby |
| Desfase de reloj normal | podía reflejar ruido | `0` |
| Acciones ejecutadas | 0 | 0 |
| Escrituras de producción | 0 | 0 |

Que Dropea aparezca ahora `FRESH` es correcto para el checkpoint reciente de 278 s; no contradice el test auditado de 80.650 s, que devuelve obligatoriamente `STALE`.

## 8. Estado del acceso auditor

- Operations Center público: HTTP 200.
- Discovery OAuth: HTTP 200.
- MCP sin credenciales: HTTP 401 esperado.
- MCP interno y catálogo de salud: respuesta funcional correcta.
- No se hizo una nueva lectura autenticada sintética del panel en este ciclo; por ello el panel se publica honestamente como `DEGRADED`, no `HEALTHY`.
- No se abrió ni controló navegador y no se modificó OAuth, TLS, Caddy ni Keycloak.

## 9. Acciones ejecutadas y escrituras

Resultado final y verificado en API, procesos y script de despliegue:

```text
actions_executed=0
production_writes=0
messages_sent=0
discounts_applied=0
orders_mutated=0
incidents_resolved=0
external_ai_cost=0 EUR
```

## 10. Backup y rollback

- Backup: `/backups/suleia-20260809T073047Z.dump`.
- Integridad: checksum y archivo PostgreSQL válidos.
- Restauración: ejecutada en base aislada; apertura, migración up/down y limpieza correctas.
- Resultado del drill: `SOURCE_FRESHNESS_ROLLBACK_DRILL|PASS|up_columns=5|down_columns=0|actions=0|production_writes=0`.
- Rollback de datos: `migrations/rollback/016_canonical_source_freshness.down.sql`.
- Copias privadas de código: artefactos previos a los commits `76bb10c`, `265d8fd` y `37d32d7` en el VPS.
- El rollback no requiere ni autoriza ninguna escritura externa.

## 11. Riesgos y pendientes

| Hallazgo | Estado tras Fase 1 | Riesgo residual / siguiente paso |
|---|---|---|
| PF0-001 frescura falsa | `VERIFIED` | resuelto y probado en runtime |
| PF0-002 worker/Chatby 401 | `OPEN_UNHEALTHY` | la credencial Chatby es rechazada; reparar el handshake en checkpoint independiente, sin tocar flujos ni plantillas |
| PF0-003 Decision Engine marcador | `VERIFIED_NOT_IMPLEMENTED` | no existe ciclo funcional; no declararlo saludable |
| PF0-004 Scheduler marcador | `VERIFIED_NOT_IMPLEMENTED` | no existen tareas funcionales; no declararlo saludable |
| PF0-005 salud de backup | `VERIFIED` | falta todavía programar pruebas periódicas en una fase posterior |
| PF0-006 procedencia de despliegue | `OPEN` | publicar manifiesto verificable por commit/hashes |
| PF0-007 respuestas MCP grandes | `OPEN` | ajustar paginación y cursores sin perder trazabilidad |
| PF0-008 catálogo PostgreSQL MCP | `OPEN_PHASE2` | separar metadatos técnicos de valores PII |
| PF0-009 programación de backups | `OPEN` | diseñar programación segura después del contrato de recuperación |
| PF0-010 panel end-to-end | `DEGRADED` | añadir lectura sintética autenticada sin PII |
| PF0-012 inventario Supabase | `OPEN_NOT_CONFIGURED` | documentar/configurar solo lectura sin retirar Supabase |

La fase no intenta ocultar el 401 de Chatby reiniciando el worker: la credencial desplegada está rechazada y un reinicio no la corrige.

## 12. Commits creados

- `76bb10c` — `fix(operations): calculate canonical source freshness`
- `265d8fd` — `fix(operations): verify latest source checkpoints`
- `37d32d7` — `fix(platform): publish functional health evidence`
- `6d3bc22` — `fix(platform): verify published health catalog`
- `7a623c7` — `fix(operations): report clock skew precisely`

Todos fueron publicados en la rama de checkpoint y los cambios funcionales correspondientes fueron verificados en el VPS.

## 13. Decisión para la fase siguiente

**GO CONDICIONADO para Fase 2, exclusivamente de solo lectura.**

La frescura falsa crítica está corregida, el caso de 80.650 s queda `STALE`, el backup y rollback están demostrados y la salud ya no presenta componentes ficticios como saludables. Se puede iniciar la auditoría del contrato PostgreSQL sin PII.

La condición es mantener bloqueada cualquier propuesta irreversible mientras el agregado de fuentes no sea `FRESH`, conservar el worker `UNHEALTHY` hasta reparar Chatby y no ampliar el alcance a escrituras, lógica del agente o acciones externas.

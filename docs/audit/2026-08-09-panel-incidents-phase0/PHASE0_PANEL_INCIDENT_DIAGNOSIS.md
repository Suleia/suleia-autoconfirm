# Fase 0 — Diagnóstico del panel y del agente de incidencias

Fecha de medición: 2026-08-09 09:17:20 UTC.

Ámbito: Operations Center, modelo de pedidos, incidencias, Chatby, temporizadores, decisiones simuladas y economía.

Modo: `SHADOW_READ_ONLY`.

## Resultado ejecutivo

Las contradicciones descritas en el encargo se han reproducido con datos reales y enmascarados. No son anomalías visuales aisladas: proceden de definiciones incompatibles, ausencia de hitos históricos y distintos alcances de consulta entre tarjetas, colas y detalles.

La Fase 0 termina en **GO condicionado para Fase 1**: existe evidencia suficiente para corregir el modelo de lectura y la presentación, pero no para ejecutar acciones externas ni para inventar mappings. La autorización no se amplía: `actions_executed=0` y `production_writes=0`.

## Salvaguardas y reversibilidad

- Commit base: `ad1cb5b278c4b7fb3d76e650306f977e2856b643`.
- Tag remoto de checkpoint: `panel-incidents-phase0-20260809T090558Z`.
- Copia PostgreSQL: `/backups/suleia-20260809T090820Z.dump`.
- La copia se restauró en una base aislada mediante el simulacro estándar; el proceso finalizó con código 0 y eliminó la base temporal.
- No se aplicaron migraciones, no se cambiaron plantillas, flujos ni reglas de confirmación/cancelación.
- El fichero local modificado por el propietario `contracts/external/dropea/public-api-v2/0.1.0/openapi.json` quedó preservado y fuera del alcance.

## Baseline verificable

| Área | Resultado real |
|---|---:|
| Esquemas / objetos | 21 / 131 |
| Tablas / vistas | 97 / 34 |
| Pedidos | 961 |
| Incidencias | 327 |
| Incidencias activas PENDING | 18 |
| Conversaciones enlazadas | 18 |
| Eventos Chatby | 0 |
| Temporizadores | 18 |
| Decisiones simuladas | 37 |
| Observaciones económicas | 760 |
| Acciones ejecutadas / escrituras productivas | 0 / 0 |

La API operacional declaró además `run_mode=SHADOW_READ_ONLY`, `actions_executed=0` y `production_writes=0`.

## Contradicciones reproducidas

### 1. Embudo imposible de pedidos

- Estado actual `SHIPPING`: **0**.
- Estado actual `DELIVERED`/`FINISHED`: **487**.
- `delivered_at_utc` presente: **488**.
- Pedidos con un hito histórico `SHIPPING`/`SHIPPED`: **0**.
- `order_state_history`: **961 filas para 961 pedidos**, una observación por pedido.

La tarjeta “Enviados” usa el estado actual, mientras “Entregados” también usa el estado actual. No existe una transición histórica persistida que demuestre que un pedido entregado fue enviado. Por ello, `0 enviados / 487 entregados` es técnicamente posible para la consulta actual, pero semánticamente inválido como embudo histórico.

### 2. Alcances incompatibles en incidencias

- Registros totales: **327**.
- Cola `PENDING AND is_active=true`: **18**.
- `actionable=true`: **0**.
- Tarjeta `pending`: **0**, porque la vista cuenta `actionable`, no la cola activa pendiente.
- Tarjeta `awaiting_customer`: **327**, porque cuenta todos los registros históricos con respuesta `NO_RESPONSE/UNKNOWN`.
- Tarjeta `blocked`: **216**, también sobre los 327 registros.

Las tarjetas no describen la cola visible: unas cuentan la historia completa y otra cuenta accionabilidad. Ninguna etiqueta declara ese alcance.

### 3. Frescura contradictoria

- Incidencias con `freshness=STALE`: **0**.
- Contextos con `conversation_freshness=STALE`: **18/18**.
- La tarjeta `stale` consulta solo la frescura de Dropea y devuelve **0**.

El panel puede presentar una incidencia como fresca aunque la evidencia conversacional necesaria para decidir esté caducada.

### 4. `FOUND` no significa respuesta válida

- Enlaces de conversación `FOUND`: **18**.
- Respuestas válidas posteriores a la incidencia: **0**.
- Eventos Chatby materializados: **0**.

La restricción de `FOUND` acredita un identificador hash/evidencia de enlace; no acredita una respuesta entrante posterior a la incidencia. El frontend utiliza `FOUND` como señal de cliente cuando no hay respuesta válida, generando ambigüedad.

### 5. Tipos y códigos no gobernados

- Incidencias `UNMAPPED`: **216**.
- Tipo normalizado `UNKNOWN`: **216**.
- Mappings GLS verificados: `NAM → RECIPIENT_ABSENT` (100) y `DI → ADDRESS_INCORRECT` (11).
- Códigos GLS sin mapping: `AS` (80), `SF` (75), `-30` (39), `OTH` (19) y un literal de devolución (1).

El código `-30` aparece con varios `raw_type` (`general`, `REFUSED_BY_RECIPIENT`, `RECIPIENT_ABSENT`, `ADDRESS_INCORRECT`, `PENDING_DATA`). Es polimórfico en los datos observados y **no se puede mapear globalmente** sin evidencia contractual adicional.

El valor `1.0000` visible procede de `interpretation_confidence`; no hay registros `UNMAPPED` con una confianza de mapping igual a 1. La interfaz yuxtapone dos conceptos distintos y hace parecer que existe un mapping desconocido con certeza total.

### 6. Decisiones repetidas sin explicación de cambio

- Decisiones simuladas: **37** para **18** incidencias activas.
- Decisiones `BLOCKED`: **37**.
- Revisión humana: **37**.
- Duplicados exactos según la clave única actual: **0**.

Son recalculaciones distintas según la clave técnica, no duplicados exactos. El modelo no conserva un `input_snapshot_hash` explícito ni una diferencia legible de entradas/política, por lo que la cronología no puede explicar por qué se volvió a decidir.

### 7. Temporizadores vencidos que siguen activos

- Temporizadores: **18**.
- `ACTIVE`: **18**.
- `ACTIVE` con `due_at <= now()`: **16**.
- `EXPIRED`: **0**.

La vista lateral prioriza el estado almacenado `ACTIVE`; no calcula el estado efectivo con respecto a la hora actual. La interfaz muestra literalmente ese estado persistido.

### 8. Economía sin contrato suficiente

- Los 961 pedidos tienen `total_amount`, que es importe comercial del pedido.
- Hay 760 filas en `economics.observations` con métricas genéricas y estados `OBSERVED/CALCULATED/ESTIMATED/UNKNOWN`.
- No existen tablas canónicas de movimientos económicos por pedido, costes, conciliación o snapshots financieros con las responsabilidades solicitadas.

“Cobertura de importes” mide presencia de `total_amount`; no mide cobertura de costes, márgenes, devoluciones, conciliación ni gasto operativo.

### 9. Serie diaria incompleta

La consulta diaria observada contiene datos entre 2026-05-10 y 2026-07-29, pero solo **55 fechas distintas**. No genera los días sin movimientos, por lo que una gráfica continua puede ocultar ceros reales.

## Causas raíz

1. Un único registro de estado actual se usa como si fuera historial de transiciones.
2. Las vistas resumen y cola no comparten un contrato de alcance.
3. Frescura de Dropea y frescura de Chatby se modelan por separado, pero el resumen ignora la segunda.
4. “Conversación encontrada” se trata como equivalente a “respuesta válida”.
5. Mapping de transportista e interpretación conversacional comparten presentación, no semántica.
6. Temporizadores tienen estado persistido, pero carecen de estado efectivo calculado o cierre programado.
7. La cronología de decisiones carece de una huella/diff de las entradas.
8. El módulo económico no tiene todavía un libro canónico por pedido.
9. El umbral de frescura de Dropea verificado en el sistema es 600 s, mientras el nuevo encargo menciona 900 s; no se modificará hasta resolver la contradicción de política.
10. Chatby está operativamente degradado: la fuente está caducada y el worker recibe 401. Cualquier decisión dependiente de conversación debe quedar bloqueada de forma específica.

## Qué no está implementado o no está demostrado

- Historial real de envíos y transiciones completas.
- Shipment como entidad 1:N independiente.
- Eventos entrantes Chatby materializados para las 18 incidencias.
- Políticas y versiones persistidas en `configuration.policies`/`policy_versions` (ambas vacías).
- Feedback operativo persistido en las tablas de decisión/revisión previstas (vacías).
- Libro económico y conciliación canónicos por pedido.
- Un mapping verificable para los códigos GLS desconocidos.
- TIPSA: fuera de alcance; el contrato vigente es solo GLS.

## Decisión de puerta

**GO condicionado para Fase 1 de corrección estructural y solo lectura.**

Condiciones obligatorias:

1. Las tarjetas y listas deben declarar y compartir el mismo alcance.
2. El embudo debe usar hitos demostrables; si no existe `shipped_at`, mostrar “no disponible”, nunca inferirlo.
3. `FOUND`, respuesta válida y frescura conversacional deben ser campos distintos.
4. Un temporizador vencido debe exponer estado efectivo vencido sin activar acciones externas.
5. No se incorporará ningún mapping sin evidencia verificada.
6. La lógica productiva de confirmación y cancelación queda intacta.
7. Chatby 401 debe producir un bloqueo específico, no una decisión ficticia.
8. Cada cambio posterior deberá mantener `actions_executed=0` y `production_writes=0` hasta una autorización nueva y expresa.

## Evidencia reproducible

- Consulta agregada: `infrastructure/audit/panel-incident-phase0.sql`.
- Contrato real: `REAL_DATA_CONTRACT.md`.
- Diccionario: `canonical-data-dictionary.csv`.
- Matriz causal: `causal-findings-matrix.csv`.
- Baseline: `baseline-metrics.json`.
- Catálogo técnico completo previo, aún válido: `docs/audit/2026-08-09-phase0/database-technical-catalog.csv`.
- Inventario de objetos previo, aún válido: `docs/audit/2026-08-09-phase0/database-objects.csv`.

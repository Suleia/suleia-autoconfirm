# Ads Intelligence V3 — implementación y validación

Estado: candidato en las PR existentes #115 (main/Telegram/Render) y #116
(VPS, base `feat/order-intelligence`). No fusionado ni desplegado. No hay
presupuestos modificados, mensajes reales ni migraciones operativas aplicadas.

## Cambios y componentes reutilizados

Se reutilizan `services/meta-ads`, el transporte GET con paginación/reintentos,
PostgreSQL operativo, la API y OAuth existentes, `apps/review-panel`, el bot
Suleia Command Center y su envío fragmentado. No hay otra base, bot o worker.

| Componente | Implementación V3 |
| --- | --- |
| `services/meta-ads/report.mjs` | Informe único: agregados ponderados, comparaciones, series, embudo, diagnósticos, anuncios y oportunidades |
| `runtime.mjs` | Caché compartida 120 s por intervalo, consultas concurrentes coalescidas, ocho entradas y dos informes en curso como máximo |
| `meta-ads-client.mjs` | GET de creatividades reales; dos peticiones concurrentes como máximo; uso de cuenta observable |
| `metrics.mjs` | Identidad campaña/conjunto/anuncio y calendario personalizado validado |
| `ledger.mjs` | Recomendaciones guardadas/revisadas y registro duradero de alertas |
| `monitor.mjs` | Revisión consolidada y máximo un digest por cuenta/día; envío incierto no se reintenta |
| `bridge-auth.mjs`, `ads-gateway.mjs` | Consultas naturales y firma temporal del cuerpo usando el secreto del bot existente |
| VPS `apps/api/server.mjs` | Lectura y revisión interna autenticadas; reutiliza el pool/login operativo |
| VPS `migrations/055_ads_intelligence_v3.sql` | Dos tablas nuevas, permisos Ads al login API existente; sin cambios en tablas operativas/financieras |
| VPS `apps/review-panel/ads-intelligence-v3.{js,css}` | Diseño responsive, filtros, embudo, columnas, detalle, anuncios y propuestas |
| VPS `scripts/ads/visual-check.mjs` | Pruebas visuales locales reproducibles con el componente real |

La apariencia se limita a la vista Ads. Se conservan las seis secciones reales
del producto. Se reproduce la distribución, paleta clara/lavanda, tarjetas,
embudo, tabla, soluciones a la derecha y bloques inferiores de la referencia.
No se crean secciones ficticias ni se copian sus cifras ilustrativas.

## Contrato y métricas

Meta: EUR, Europe/Madrid, `7d_click + 1d_view`, fecha de conversión, mismo
contrato en los tres niveles y ambos periodos. No se mezclan las ventanas de
cuenta antiguas, el histórico Supabase obsoleto o distintos niveles jerárquicos.
El histórico antiguo finaliza en agosto; la solución nueva consulta el lector
canónico y conserva cobertura/fecha de observación independientes.

Ocho KPIs: gasto, ROAS agregado, compras, CPA, beneficio verificado, campañas
rentables, campañas con señales y oportunidades. ROAS = suma de valor / suma de
gasto; CPA = suma de gasto / suma de compras. Nunca se promedian ROAS ni se suman
alias de compras. Campos ausentes, valores ambiguos y mezcla de scopes producen
N/D; inventario sin fila no equivale a cero. Alcance y frecuencia no se suman.

Los KPIs conservan fuente, cobertura, observación, referencia/delta cuando es
válida y serie disponible. Sin base, margen o atribución, el valor/delta/serie
dependiente permanece desconocido. Los tres contadores complementarios aparecen
debajo de las cinco tarjetas principales. Hoy o intervalos que terminan hoy no
se comparan con días completos.

Filtros: hoy, ayer, 3/7/30 días completos, intervalo de hasta 31 días, nivel,
campaña, conjunto o anuncio. Las mismas filas alimentan embudo, tabla y KPIs de
la selección. Tasas de embudo: eventos atribuidos agregados, aproximadas, sin
pretender usuarios únicos; pueden superar 100 %. Cada etapa abre volumen,
coste y variación válidos. El mayor deterioro requiere al menos 30 eventos de
denominador en ambos periodos.

La tabla permite seleccionar las 16 columnas solicitadas. El detalle muestra
datos individuales, serie diaria, embudo, diagnósticos, descendientes,
creatividades, presupuesto y cambios registrados en este ejecutor. La ausencia
de historial no acredita que nadie externo haya modificado Meta.

## Diagnósticos y recomendaciones

Se aplican cambios relativos frente a la misma entidad y referencia equivalente:
CTR -25 %, CPC/CPM +30 %, ROAS -25 %, deterioro de tasas -25 %, y fatiga solo si
concurren frecuencia creciente, CTR decreciente y pérdida de eficiencia.
Se localizan hipótesis de anuncio, landing/ficha, checkout y medición. Cada
recomendación incluye evidencia numérica, alternativas, confianza, riesgo y una
acción; no afirma causalidad ni promete ventas o porcentajes de mejora.

Mínimos diagnósticos documentados: 15 EUR, 1.000 impresiones, cinco compras para
destacar estabilidad, 30 eventos para etapas. Estos criterios describen señales;
NO autorizan gasto ni sustituyen los mínimos y límites del ejecutor.
Un anuncio top necesita volumen en ambos periodos, valor superior al gasto y
ROAS que no haya caído más del 15 %. Una sola compra nunca basta.

Las recomendaciones se guardan como DRAFT y pasan a APPROVED_FOR_REVIEW o
DISMISSED mediante OAuth existente. Aprobar registra revisión interna; no
modifica anuncios, web o presupuestos. Las operaciones monetarias conservan su
propuesta separada con caducidad, identidad, idempotencia y confirmación Telegram.

## Endpoints

| Método/ruta | Uso |
| --- | --- |
| GET `/api/operations/ads-intelligence` | Informe completo; `period`, `since`, `until`, `level`, `campaignId`, `adsetId`, `adId`, `selector` |
| POST `/api/operations/ads-intelligence/proposals` | Guardar recomendación vigente por `actionId` y consulta; OAuth |
| PATCH misma ruta | Revisar `id` / `state`; OAuth, cero escrituras Meta |
| POST `/api/internal/ads-intelligence/command` | Bot existente, firma temporal/cuerpo y actor privado autorizado; lecturas/propuestas/simulación |

La firma reutiliza `TELEGRAM_BOT_TOKEN` mediante clave derivada específica,
HMAC-SHA256, ventana de 30 s y comparación constante. No se crea una credencial
adicional. El token puente V2 ya provisionado, si existiera, sigue siendo
compatible; no es obligatorio generarlo. El OAuth de lectura nunca permite
suplantar al actor del bot en el puente.

Telegram y panel llaman `runtime.overview`: mismo intervalo, nivel y atribución
devuelven el mismo informe/cache y fecha. Se reconocen las ocho preguntas V3;
sin periodo explícito se informa de los siete días completos elegidos. Búsqueda
por nombre de campaña no constituye atribución comercial de productos/pedidos.

## Ejecutor y monitor

El ejecutor V2 permanece en SIMULATION/SHADOW. `LIVE_COMPILED=false`; flags LIVE o
escrituras fallan antes de HTTP. El ejemplo +10 EUR con ROAS >5 se interpreta,
consulta y simula con todas las salvaguardas existentes. Los límites observados
100 EUR y 10 % hacen imposible ese incremento: se preservan y bloquea la propuesta.
No se flexibilizan para hacer pasar el ejemplo.

La API puede refrescar cada 30 minutos con `ADS_INTELLIGENCE_MONITOR_ENABLED`;
está desactivado por defecto. La función de revisión/alertas queda preparada y
probada con envío inyectado, registro duradero y consolidación diaria. El timer
de esta entrega solo actualiza/revisa datos: el transporte de alertas matinales
al bot requiere conexión y activación en un despliegue posteriormente autorizado.
No hay alerta real enviada, timer instalado ni cambio autónomo de presupuesto.

## Datos que siguen bloqueando conclusiones

- No hay enlace validado campaña/anuncio–pedido–costes. Shopify, confirmados,
  enviados, entregados, devueltos, cobros, costes y beneficio por campaña son N/D
  y NO_ATRIBUIDOS. No se inferirá el vínculo por nombres o fechas.
- El filtro producto permanece deshabilitado con su motivo hasta disponer de
  una relación fiable; no se crea una asignación comercial heurística.
- «Rentable» no se emite sin margen/punto de equilibrio. Se muestran señales
  potenciales, vigilancia, deterioro o datos insuficientes. No se propone pausa
  definitiva a partir de un ROAS aislado sin economía y medición suficientes.
- Pixel/CAPI `event_id` y deduplicación de eventos originales siguen sin validar.
  Se selecciona un alias, pero eso no acredita deduplicación en el origen.
- Caducidad/rotación del token y umbrales financieros requieren revisión previa
  a cualquier futura prueba LIVE. No se han creado claves ni cuentas.

## Pruebas ejecutadas y evidencia

VPS/API/panel/Ads: **194 pasan**, un test PostgreSQL opcional omitido localmente.
PostgreSQL 17.5 aislado por socket, sin red/puertos: **1 pasa** (migraciones 054
y 055, permisos, persistencia, propuesta/revisión idempotente, alertas, bloqueo,
concurrencia y SHADOW). Suite Linux de bot/Ads: **91 pasan**, un test PostgreSQL opcional omitido. Los grupos
se solapan: no sumar los recuentos como pruebas distintas.

Lectura Meta real del 21-10-2026 09:44:29 UTC para 14–20 octubre: **955,17 EUR,
114 compras, ROAS 3,7616968707, CPA 8,3786842105**. Gasto conciliado al céntimo en
campaña/conjunto/anuncio. 19 GET; cero POST Meta, escrituras DB operativas o
mensajes. 31 campañas, 137 anuncios en inventario de esa consulta (dinámico).
Tres anuncios destacados y cinco miniaturas auténticas usadas en las capturas.

QA visual: 1440×1050 desktop y 390×844 móvil, capturas completas y detalle.
Embudo, jerarquía, columnas, guardar/aprobar propuesta, cambio de nivel,
medición/NO_ATRIBUIDOS, nombres HTML hostiles, datos ausentes y error de fuente
comprobados. Cero errores JavaScript; sin overflow horizontal en móvil.
El harness sirve el componente/CSS reales en loopback, con arranque local de
prueba sin login; OAuth se prueba aparte en API. Navegador bloquea red externa y
recibe miniaturas desde memoria local, obtenidas previamente por HTTP GET.
No abre sesión ni páginas de producción. Excepción local autorizada por el dueño.

Capturas e informes completos permanecen privados, fuera de Git. No se incluyen
conversaciones, datos de clientes, credenciales o URLs firmadas de medios en PR.

Para repetir: cargar variables existentes de forma segura, ejecutar
`node services/meta-ads/cli/capture-report.mjs PRIVATE_OUTPUT_PATH 7d` y después,
en la rama VPS con Playwright disponible, ejecutar
`node scripts/ads/visual-check.mjs`. Variables QA: `ADS_QA_SNAPSHOT`,
`ADS_QA_OUTPUT`, `ADS_QA_BROWSER_PATH`, `ADS_LOCAL_BROWSER_QA_AUTHORIZED=true`.
Esa variable refleja una autorización local explícita, no permiso para producción.

La API, PostgreSQL, ingestión y Telegram siguieron operativos en la revisión final. El controlador de incidencias ausente alternó saludable/no saludable (ya fallaba antes de V3); se observó de nuevo no saludable a las 10:02 UTC. No se modificó y queda fuera de este alcance publicitario.

## Despliegue posterior y rollback

1. Revisar ambas PR y aprobar por separado el despliegue componente a componente.
2. Respaldar PostgreSQL y aplicar 054/055 mediante el mecanismo de migraciones
   existente. Verificar permisos Ads del login API; conservar roles read-only.
3. Inyectar las referencias a secretos existentes mediante el almacén confiable.
   Reutilizar pool y `OPERATIONS_DATABASE_URL`; URL Ads separada es opcional.
   Compose incluye flags apagados y aliases Meta, sin valores de secretos.
4. Publicar API/panel y después bot compatibles. Encender lectura y SHADOW;
   `META_WRITES_ENABLED=false`, `ADS_INTELLIGENCE_WRITES_ENABLED=false`.
   Verificar lector, atribución, frescura, comparativa y exactitud panel/Telegram.
5. Si se autoriza, backfill acotado con `cli/sync-intelligence.mjs` (reutiliza URL
   operativa, bloqueo global, sin sobrescribir finanzas antiguas). Comprobar
   `read_models.ads_spend_daily`, cobertura, contrato y fechas de origen.
6. Activar refresco solo después de medir carga. La conexión del envío matinal y
   su activación precisan revisión específica; no activar LIVE en este release.

Rollback: apagar lectura/monitor/puente Telegram, restaurar artefactos anteriores
de API/panel/bot y sus flags. Mantener las tablas Ads nuevas y auditoría; no borrar
datos ni revertir tablas operativas/financieras. Si una futura operación LIVE
existiera, no restaurar presupuestos ciegamente: releer importe/estado, preparar
una propuesta inversa acotada y pedir confirmación antes de ejecutarla.

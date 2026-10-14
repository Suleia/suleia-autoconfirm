# Centro de datos e información

Agente: `ORDER_INTELLIGENCE_AGENT`. Categoría: `DATA_INTELLIGENCE`.
Modo: `READ_ONLY`. Sin mensajes, cambios de pedido, decisiones operativas,
llamadas a modelos externos ni modificaciones de campañas.

## Arquitectura y autoridad

La copia canónica `integration.dropea_orders` y sus incidencias alimentan una
vista protegida `read_models.order_intelligence_source`. El materializador
deriva hechos sin datos personales, agrega celdas y calcula patrones locales.
API, MCP y panel comparten el mismo motor de métricas y filtros. El cliente
financiero existente aporta exclusivamente su informe de cohorte de compra;
el nuevo trabajo desactiva expresamente su función de refresco de origen.

Los pedidos reales marcados como pruebas por el teléfono de origen se conservan
identificados, igual que en el informe financiero, para no eliminar sus costes
y resultados. La unicidad se garantiza por ID canónico, no por teléfono.
No se reconstruye otra contabilidad. `finance_months` conserva los totales y
la cobertura del informe existente; `finance_days` conserva su desglose por
fecha de compra. El verificador compara pedidos, ingresos y beneficio diario
contra cada mes. Si los pedidos canónicos y financieros no coinciden todavía,
el beneficio exacto queda pendiente de conciliación. Nunca se divide Meta o
los gastos generales arbitrariamente por productos, provincias o pedidos.
Los segmentos muestran contribución conocida; beneficio neto no atribuido =
`null`. Un coste ausente también es `null`, no cero.

## Persistencia y permisos

Migración aditiva: `053_order_intelligence.sql`.

| Objeto en analytics | Contenido |
| --- | --- |
| order_facts | Un hecho por ID canónico, hash de fuente, fecha de compra, geografía minimizada, cesta, costes conocidos, marcas temporales, resultado, madurez y calidad |
| order_cells | Celdas por día/hora/dimensiones, numeradores y denominadores sumables |
| finance_days / finance_months | Copia permitida de los informes financieros existentes |
| detected_patterns | Hallazgos deterministas, muestra, referencia, diferencia, intervalo y vigencia |
| insights | Explicaciones con evidencia y filtros de exploración |
| runtime_state | Último éxito, fuente, duración, filas cambiadas, watermark, backfill y errores |
| daily_summaries | Resumen preparado; `send_automatically=false` |
| agent_registry | Contrato del agente sin permisos operativos |

Se exponen los quince modelos analíticos pedidos sobre la proyección agregada:
`orders_by_hour`, `orders_by_weekday`, `orders_by_province`, `orders_by_city`,
`orders_by_product`, `orders_by_offer`, `order_outcomes`, `return_patterns`,
`confirmation_patterns`, `delivery_patterns`, `incident_patterns`,
`profitability_segments`, `order_funnel`, `daily_order_intelligence` y
`customer_response_patterns`. Las tasas se calculan después de filtrar,
sumando numeradores/denominadores, nunca promediando porcentajes.

`suleia_analytics_materializer` solo escribe en `analytics`. La lectura de
fuentes usa la conexión existente dentro de una transacción `READ ONLY`.
El MCP conserva su rol de lectura y no puede consultar `order_facts` ni la
vista protegida de entrada. API/MCP consultan exclusivamente celdas e informes
analíticos, sin escanear conversaciones o eventos por petición.

La dirección cifrada solo se descifra transitoriamente para obtener provincia,
localidad y prefijo postal de dos dígitos. No se guardan nombres, teléfonos,
correo, dirección completa, mensajes ni códigos postales completos en analytics.
Las credenciales permanecen en la configuración privada del VPS.

## Tiempo, muestras y calidad

UTC interno; compra local en Europe/Madrid, incluidos cambios DST. Entregas y
devoluciones usan sus timestamps canónicos, no cadenas de estado. Una devolución
posterior conserva ambos timestamps, prevalece como resultado final y señala
el conflicto. Las cancelaciones sin timestamp conservan el estado canónico,
sin inventar una fecha.

Madurez por edad de la cohorte, incluso si un pedido ya terminó: <7 días
`IMMATURE`; 7–20 `MATURING`; ≥21 `MATURE`. Así se evita seleccionar solo los
terminales rápidos al comparar tasas. Los patrones de resultado usan maduros.
Muestra <20: `INSUFFICIENT_SAMPLE`; 20–49: `LOW_CONFIDENCE`; ≥50: `NORMAL`.
Son niveles descriptivos de muestra, no probabilidades de causalidad. Se
presentan intervalos Wilson del 95% para proporciones, sin afirmar significación
estadística de pruebas múltiples exploratorias.

Los campos de primera respuesta cubren solo mensajes observados y vinculados
a la incidencia/pedido, posteriores al primer contacto conocido de esa ventana.
No se transforma el último mensaje en una supuesta primera respuesta histórica.
Descuento ofrecido, aceptado y cambio de cobro verificado son hechos distintos.

Las cestas mixtas pertenecen a `MIXED_BASKET`: un pedido nunca se cuenta dos
veces por tener varios productos. SKU/familia no disponibles no se inventan;
la familia usa la agrupación del producto canónico hasta disponer de catálogo
comercial específico. Ofertas se agrupan por unidades de la cesta, no por una
promoción cuyo identificador no consta en la fuente.

La salud distingue retraso de fuente, antigüedad de cálculo y corte financiero.
Un cálculo reciente no convierte una fuente antigua en fresca. Los fallos
conservan la última proyección válida y marcan `DEGRADED` o `STALE`.

## Actualización y patrones

Backfill inicial completo. Después, polling cada cinco minutos del watermark
de la copia canónica con cinco minutos de solape y reconciliación completa
diaria. Las nuevas ingestiones quedan incorporadas en el siguiente ciclo;
no se añaden triggers que puedan bloquear la ingesta operativa. Se reescriben
solo hechos cuyo hash cambia y las celdas de sus días afectados. La madurez y
los costes publicados posteriormente también actualizan hechos históricos.
Un bloqueo advisory evita ejecuciones simultáneas.

Reglas de diferencias de tasas y contribución por hora, día, provincia,
localidad, producto, oferta, unidades, ticket, demora de confirmación/respuesta
e interacciones. Referencia = resto de la cohorte madura filtrada. Umbrales
descriptivos: 5 pp devoluciones/incidencias/ausencias/rechazos, 7 pp entrega y
confirmación, 3 EUR contribución por pedido. Los datos con muestra insuficiente
no generan recomendaciones de segmento.

Anomalías de ventas: 7 y 30 días completos frente al periodo anterior, mes
hasta ayer frente a los mismos días del anterior y hoy frente a los cuatro
mismos días de la semana, con iguales horas completas. Devolución/beneficio
entre periodos solo se comparan cuando ambas cohortes han madurado.
Predicciones y modificaciones automáticas de políticas permanecen desactivadas.

## Panel y MCP

Ruta: `/operations/#analytics`. Filtros persistidos en el fragmento URL:
fecha inicial/final, producto, oferta, provincia, resultado y madurez. Todos
los gráficos consultan el mismo informe. El mapa selecciona provincia; ranking
ordena columnas; heatmap muestra 7×24 celdas; hallazgos abren su evidencia.
Cartografía local de IGN/CNIG vía es-atlas 0.6.0, CC BY 4.0, atribución visible.

Doce herramientas con scope existente `orders:read`, esquemas estrictos,
límites, masking, auditoría y cero acciones:

1. `get_order_intelligence_overview`
2. `get_geographic_performance`
3. `get_hourly_performance`
4. `get_weekday_performance`
5. `get_order_funnel`
6. `get_return_analysis`
7. `get_confirmation_analysis`
8. `get_delivery_analysis`
9. `get_incident_analysis`
10. `get_profitability_analysis`
11. `get_detected_patterns`
12. `get_analytics_insights`

Argumentos comunes: `date_from`, `date_to`, `product`, `offer`, `province`,
`outcome`, `maturity`, `dimension`, `metric`, `pattern_type`, `confidence`,
`limit`, `offset`. MCP reduce su presentación al presupuesto de 50 KiB;
el panel recibe el informe completo. Las respuestas incluyen muestra,
denominadores, periodo, calidad y frescura. Las ciudades se solicitan con
`get_geographic_performance` y `dimension: "locality"`.

Ejemplos: provincias con peor devolución (`get_return_analysis`, dimensión
province, madurez MATURE); horas con más compras (`get_hourly_performance`);
rentabilidad de producto (`get_profitability_analysis`, dimensión product);
demora de respuesta y entrega (`get_delivery_analysis`, dimensión response_delay).

## Validación, despliegue y rollback

Pruebas puras cubren fechas, DST, madurez, duplicados, privacidad, costes,
descuentos, filtros, muestras, patrones y latencia. Pruebas MCP usan el SDK
real; pruebas DOM validan controles, filtros, mapa y heatmap sin navegador.
El despliegue vuelve a ejecutar la suite con Node 22 del contenedor.

`deploy-order-intelligence.sh <commit>` construye la imagen, conserva entornos
y montajes reales de API/MCP, aplica la migración, carga el histórico y arranca
el materializador. Verifica que los servicios operativos no se recrean. El
verificador usa el rol MCP real, ejecuta las doce herramientas, mide p50/p95,
comprueba permisos y concilia cada mes financiero. Los resultados privados
quedan en `/opt/suleia-backups/order-intelligence-<commit>/`.

Rollback de exposición: `ORDER_INTELLIGENCE_ENABLED=false` en API y MCP y
reinicio exclusivamente de esos servicios; el panel oculta la navegación.
Detener `analytics-materializer` suspende actualizaciones. No borrar tablas.
Rollback de binarios: usar `rollback.json` del backup con el compose de esa
release para recrear exclusivamente API/MCP/panel con sus imágenes, entornos
y montajes anteriores. Restaurar el enlace `/opt/suleia-operations` al valor
guardado en `previous-release`. Se conservan todos los datos analíticos.

## Mejoras futuras sin acciones automáticas

Completar catálogo de SKU/familias/promociones; aumentar cobertura histórica
de primer contacto y respuesta; atribuir costes publicitarios cuando exista
un vínculo verificable; calibrar patrones con más muestras y controlar FDR;
añadir evaluación retrospectiva antes de plantear cualquier modelo predictivo.

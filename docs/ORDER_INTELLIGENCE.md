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

El margen por pedido con resultado (`contribution_per_settled_order`) divide
solo por pedidos con contribución conocida y muestra su cobertura. No equivale
al beneficio neto de todos los pedidos ni convierte los pendientes en ceros.
La media estricta sobre todos los pedidos permanece nula si falta algún resultado.
Las tipologías de incidencia desconocidas también se cuentan en calidad.

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
| overview_snapshots | Informes precalculados para 1, 7, 30 y 90 días; frescura reevaluada al leer |
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

## Acta de aceptación — 14 de octubre de 2026

Código desplegado: `7d701365723507969b32ff0601b01f4fdc7dc615`.
PR de publicación: https://github.com/Suleia/suleia-autoconfirm/pull/95,
basada en `feat/incident-resolution-panel`, que es la línea de la plataforma
VPS. Esta entrega no se ha fusionado ni desplegado en el monolito de Render.

| Entregable | Resultado comprobado |
| --- | --- |
| 1. Arquitectura | Fuente canónica + autoridad financiera existente → hechos → agregados → reglas → servicio compartido → API/MCP/panel |
| 2. Tablas | 11 tablas analytics; inventario y permisos descritos arriba |
| 3. Read models | Los 15 modelos agrupados descritos arriba, derivados de celdas precalculadas |
| 4. Histórico | 1.985 pedidos entre 10/05/2026 y 14/10/2026, en el corte auditado |
| 5. Cobertura | 1.985 IDs canónicos = hechos = suma de agregados; ningún ID ausente ni huérfano; provincia conocida en todos |
| 6. Calidad | 0 duplicados candidatos; 23 marcas de prueba del origen conservadas para respetar el universo financiero; 0 campos personales prohibidos en hechos |
| 7. Métricas | 7 indicadores, numeradores/denominadores, cohortes y cobertura económica; ningún coste ausente se transforma en cero |
| 8. Patrones | 186 patrones vigentes en el corte de las 17:36; excluidas tautologías de selección por confirmación/contacto |
| 9. Insights | 7 tarjetas con periodo, muestra, comparación y evidencia; sin afirmaciones causales |
| 10. MCP | 12 herramientas nuevas y 16 anteriores; contratos, límites y permisos verificados |
| 11. Ejemplos MCP | Las diez preguntas de aceptación constan en la tabla siguiente |
| 12. Panel | https://mcp.suleia.com/operations/#analytics, autenticado y comprobado en Chrome |
| 13. Capturas | Dos capturas reales entregadas en el chat: cabecera/mapa/ranking y embudo/patrones/rentabilidad; captura de página completa agotó el tiempo del navegador |
| 14. Rendimiento | SDK MCP con rol productivo y base real: overview p95 78 ms; geografía 60 ms; patrones 103 ms; primera consulta overview 333 ms. Son medidas de transporte interno, no latencia de Internet |
| 15. Pruebas | 712/712 en Node 22 del contenedor; 35 específicas locales; pruebas manuales de interfaz y conciliación independiente |
| 16. Commits | Implementación c3d5b8b; conciliación 34b8412; caché f4c6e69; cobertura ef0cc42; correcciones visuales y de selección 7d70136 |
| 17. Despliegue | API, MCP y materializador healthy con la revisión exacta; panel servido desde esa release; diez contenedores operativos conservan sus IDs |
| 18. Rollback | Backup privado y procedimiento arriba; reversión automática ante fallo de despliegue; tablas derivadas conservadas |
| 19. Limitaciones | Desfase financiero, taxonomía histórica incompleta, atribución de Meta/gastos generales y cobertura parcial de primera respuesta, detallados debajo |
| 20. Mejoras futuras | Completar fuente y catálogo, atribución verificable, más muestra y validación retrospectiva antes de cualquier predicción |

Pruebas visuales: 90 días → Madrid = 144 pedidos; Madrid + Colla Gum = 69;
90 días + 2 unidades = 881; añadiendo cohortes maduras = 708; añadiendo
entregados = 394 en indicador y todos los pasos del embudo. El clic del mapa
selecciona Madrid, los filtros persisten en URL y Restablecer los limpia.
La evidencia de margen de Madrid muestra 102/144 pedidos con resultado,
70,8% de cobertura y 14,07 EUR antes de Meta/gastos generales. Se corrigió
el ancho heredado de tabla que ocultaba columnas. El ranking económico exige
la muestra mínima de pedidos con contribución conocida.

La conciliación independiente comprobó 1.019 entregados y 403 devueltos,
iguales en fuente y hechos. Mayo–septiembre coinciden por mes entre canónico,
hechos e informe financiero. En octubre había 227 pedidos canónicos frente
a 226 financieros: un pedido nuevo pendiente de su informe económico. El
panel muestra «Conciliación financiera pendiente» y deja el beneficio exacto
sin dato para ese rango. No se fuerza un refresco de la fuente financiera.
Los totales diarios y mensuales del propio informe financiero cuadran en
pedidos, ingresos y beneficio en los seis meses cargados.

En todo el histórico auditado hay 563 pedidos sin contribución conocida,
504 con alguna incidencia sin tipología clasificada y 115 con primera respuesta
observada en la ventana de incidencias. Esto no prueba ausencia de respuestas
en los demás pedidos. Los resultados antiguos sin taxonomía no se reclasifican
por conjeturas. En los últimos 90 días: 374 contribuciones pendientes,
351 pedidos con alguna tipología desconocida y un pedido sin costes cargados.

La disponibilidad de la aplicación y la calidad de las fuentes son estados
distintos: servicios healthy pueden mostrar datos pendientes de conciliación.
La materialización está activa cada cinco minutos y tiene reconciliación diaria.
La comprobación MCP ejecuta el SDK real con la base y el rol productivos;
no certifica que cada cliente externo haya refrescado ya su catálogo de tools.

### Diez preguntas con datos reales

Corte de consultas: 14/10/2026, 17:40 Europe/Madrid. Periodo común
17/07/2026–14/10/2026, salvo las comparaciones temporales indicadas.
«Suficiente» significa umbral descriptivo de muestra, no causalidad ni
significación estadística. Los resultados de entrega/devolución de esta tabla
usan cohortes maduras y al menos 20 enviados por segmento comparado.

| Pregunta | Métrica, muestra y comparación observadas | Confianza |
| --- | --- | --- |
| ¿Dónde vendemos más? | Barcelona 166 pedidos, Madrid 144, Alicante 59; comparación por volumen provincial de compra | Suficiente en los tres |
| ¿Qué provincias tienen mejor entrega? | Madrid 63/85 enviados = 74,12%; Sevilla 24/33 = 72,73%; Málaga 23/32 = 71,88% | Madrid suficiente; otras dos baja |
| ¿Dónde se devuelve más? | Girona 10/23 = 43,48%; Asturias 8/20 = 40%; Barcelona 34/89 = 38,20% | Girona/Asturias baja; Barcelona suficiente |
| ¿A qué horas compran más? | 16:00–16:59: 98 pedidos; 19:00–19:59: 89; 18:00–18:59: 87, frente al resto de horas locales | Suficiente |
| ¿Las compras nocturnas se devuelven más? | 00:00–05:59: 34/79 enviados = 43,04%; resto del día: 191/694 = 27,52%; 109 frente a 909 pedidos maduros | Suficiente; asociación, no efecto causal |
| ¿Qué producto tiene mejor entrega? | Crema NIDA: 264/359 = 73,54%; Colla Gum: 281/413 = 68,04%; 482 y 535 pedidos maduros | Suficiente |
| ¿Qué patrones hay en la confirmación? | Confirmación 1–3 h: entrega 260/346 = 75,14%; 0–15 min: 98/153 = 64,05%; comparar no autoriza cambiar la regla operativa | Suficiente; descriptivo |
| ¿Qué anomalías existen? | 14/09–13/10: 431 pedidos vs. 584 en 15/08–13/09, −26,20%; 01–13/10: 220 vs. 307 en 01–13/09, −28,34% | Suficiente |
| ¿Qué segmentos son más rentables? | Contribución por pedido con resultado: NIDA 16,32 EUR (357/482 conocidos); Colla Gum 10,64 EUR (413/535). Neto por segmento no atribuido | Suficiente en contribución; cobertura 74,07%/77,20% |
| ¿Qué ha cambiado esta semana? | 07–13/10: 104 pedidos vs. 128 en 30/09–06/10, −18,75%; facturación realizada 1.249,60 EUR y neto observado −333,12 EUR. Cohorte todavía pendiente de madurar | Suficiente para volumen; tasas finales no comparables aún |

Evidencia local entregada: `output/production-verification-final.json`,
`output/business-acceptance-final.json`, `output/data-reconciliation.txt`,
`output/services-verification.json`, `output/centro-datos-produccion.jpg` y
`output/centro-datos-patrones.jpg`. Los resultados del despliegue y rollback
están en `/opt/suleia-backups/order-intelligence-7d701365723507969b32ff0601b01f4fdc7dc615/`.

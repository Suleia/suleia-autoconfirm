# Auditoría financiera Suleia — 2026-09-11

## Alcance y fuentes

- Pedidos, estados, importes y unidades: Dropea Public API V2, tienda `16088`.
- Publicidad: Meta Marketing API, cuenta configurada en producción.
- Tarifas logísticas y costes unitarios: política contable vigente desde 2026-05-01.
- Julio: cierre validado contra `Finanzas_07-2026 (1).xlsx`; el recuento general sigue procediendo de Dropea.
- Shopify queda excluido de todos los cálculos financieros.

## Fallos encontrados y corregidos

1. El filtro mensual enviaba a Dropea una fecha final sin hora. La API la interpretaba como las 00:00 y excluía todo el último día del mes.
2. Los ingresos por producto multiplicaban `unit_price * quantity`. En Dropea V2, `total_amount` del pedido es el importe autoritativo y `unit_price` puede representar un pack; la multiplicación inflaba el desglose.
3. Un pedido entregado sin `line_items` podía aparentar cobertura completa de coste de producto. Ahora bloquea el beneficio exacto hasta disponer del coste.
4. Meta Ads leía solo la primera página de resultados. Ahora recorre toda la paginación con límite y validación del host.
5. El panel mezclaba pedidos entregados de la cohorte con entregas ocurridas en el periodo y no mostraba unidades. Ahora son métricas separadas.

## Fórmulas aplicadas

- Facturación real = suma de `total_amount` de los pedidos entregados de la cohorte mensual.
- Coste de producto = unidades entregadas por coste unitario del SKU.
- Envío de ida = pedidos enviados × 4,06 €.
- COD = pedidos entregados × 1,00 €.
- Fulfillment de ida = pedidos enviados × 1,20 €.
- Devoluciones = pedidos devueltos o rechazados × 5,26 €.
- Gastos fijos = días naturales del periodo × 8,97 €.
- Gastos totales = producto + envío + COD + fulfillment + devoluciones + Meta + fijos.
- Beneficio neto = facturación real − gastos totales.
- ROI = beneficio neto / gastos totales.

El detalle diario conserva el criterio del libro de julio: agrupa cada resultado por la fecha de creación del pedido. El panel muestra aparte las entregas que ocurrieron físicamente durante el mes, aunque el pedido se hubiera creado antes.

## Reconciliación real de agosto de 2026

La consulta corregida incluye desde `2026-08-01 00:00` hasta `2026-08-31 23:59:59.999`, hora de Madrid.

| Métrica | Resultado |
|---|---:|
| Pedidos Dropea creados | 279 |
| Pedidos enviados | 207 |
| Pedidos entregados de la cohorte | 150 |
| Unidades entregadas de la cohorte | 279 |
| Entregas ocurridas durante agosto | 121 |
| Unidades entregadas durante agosto | 229 |
| Devueltos / rechazados | 54 |
| Unidades afectadas por devolución | 99 |
| Cancelados | 72 |
| Incidencias de entrega | 3 |
| Facturación real | 4.748,50 € |
| Coste de producto | 333,82 € |
| Logística total | 1.522,86 € |
| Gasto Meta Ads | 1.902,14 € |
| Gastos fijos | 278,07 € |
| Gastos totales | 4.036,89 € |
| Beneficio neto | 711,61 € |
| ROI | 17,63 % |

El valor de Meta Ads coincide con el total observado en Ads Manager: **1.902,14 €**.

El error de límite mensual ocultaba 22 pedidos del 31 de agosto: 13 entregados, 6 rechazados y 3 cancelados. Al incluirlos, el día suma 21 unidades entregadas y queda con 123,82 € de beneficio neto.

## Comparativa mayo-septiembre

| Mes | Estado | Pedidos | Enviados | Entregados | Uds. entregadas | Devueltos | Meta | Facturación real | Gastos totales | Beneficio neto |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-05 | Reconstruido | 61 | 35 | 25 | 43 | 10 | 301,04 € | 844,75 € | 999,91 € | -155,16 € |
| 2026-06 | Reconstruido | 287 | 199 | 148 | 280 | 51 | 1.453,10 € | 4.958,52 € | 3.558,30 € | 1.400,22 € |
| 2026-07 | Cierre validado | 613 | 452 | 314 | 574 | 137 | 3.733,04 € | 9.616,50 € | 8.078,59 € | 1.537,91 € |
| 2026-08 | Reconstruido | 279 | 207 | 150 | 279 | 54 | 1.902,14 € | 4.748,50 € | 4.036,89 € | 711,61 € |
| 2026-09 | Provisional al 11/09 | 237 | 191 | 113 | 215 | 21 | 1.607,83 € | 3.718,87 € | 3.211,54 € | 507,33 € |

Los meses reconstruidos reflejan el estado actual de Dropea y Meta. Septiembre seguirá cambiando hasta el cierre. Julio conserva los importes del cierre validado aunque la API actual pueda reflejar ajustes posteriores.

## Controles automáticos añadidos

- La suma de estados debe coincidir con el total de pedidos Dropea.
- La suma de ingresos por producto debe coincidir con la facturación real.
- La suma de partidas de coste debe coincidir con gastos totales.
- Facturación menos gastos debe coincidir con beneficio neto.
- El periodo debe usar límites horarios completos de Madrid.
- Si Meta, Dropea o un coste unitario faltan, el beneficio deja de mostrarse como exacto.

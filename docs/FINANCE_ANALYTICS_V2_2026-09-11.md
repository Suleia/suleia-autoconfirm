# Suleia Analytics / Rentabilidad v2

Fecha de auditoría: 2026-09-11. Zona horaria: `Europe/Madrid`.

## Causas raíz corregidas

1. El modelo anterior imputaba ingresos, producto y logística al día de creación del pedido. El nuevo P&L reconoce cada partida por su evento: preparación/envío, entrega o devolución.
2. Las devoluciones se deducían del estado actual. Ahora `returned_at(_utc)` es prioritario y, en Dropea Public API V2, `rejected_at` con evidencia de expedición es la señal equivalente. Un rechazo sin expedición queda separado.
3. Dropea devuelve `order_costs = null` y `wholesale_price = 0` en los pedidos reales inspeccionados. El cero ya no se interpreta como coste gratuito: se usa una tarifa SKU versionada y trazable; sin tarifa, el resultado queda incompleto con `MISSING_ECONOMIC_DATA`.
4. El coste de devolución era una constante oculta. Ahora primero se busca el cargo real en `order_costs`; si Dropea no lo publica, se aplica la tarifa versionada conciliada con el cierre de julio y se expone su fuente/versión.
5. Los gastos fijos estaban incrustados en la fórmula. Se trasladaron a un ledger de gastos recurrentes/puntuales con fechas, céntimos enteros y prorrateo diario exacto.
6. El frontend repetía cálculos y mezclaba cohorte con eventos. Ahora consume una única respuesta canónica: P&L por evento, funnel por cohorte, comparación, histórico, calidad y freshness.

## Definiciones canónicas

- Facturación: suma del importe final de pedidos cuyo `delivered_at` cae en el periodo.
- Producto: coste real positivo de Dropea; si falta, tarifa SKU versionada. Un cero no verificado bloquea el beneficio exacto.
- Logística: envío y fulfillment en `processing_at`/`shipped_at`; COD en `delivered_at`; devolución en `returned_at` o `rejected_at` con expedición.
- Margen de contribución: facturación menos producto y todos los costes logísticos variables.
- Beneficio neto: facturación menos producto, logística, devoluciones, Meta, gastos recurrentes, puntuales y otros.
- ROI: beneficio neto dividido entre costes totales.
- ROAS: facturación realizada dividida entre gasto Meta.
- Margen neto: beneficio neto dividido entre facturación realizada.
- Funnel: pedidos creados en el mes; confirmados por `confirmed_at`; enviados por evidencia logística; entregados por `delivered_at`; devueltos por timestamp de retorno/rechazo expedido.

Todos los importes se convierten a céntimos enteros antes de agregarse. La API solo convierte a euros para su presentación.

## Reconciliación real

Datos consultados en Dropea V2 y Meta el 2026-09-11. Julio conserva el cierre financiero validado.

| Mes | Facturación | Costes | Beneficio | Meta | Estado |
|---|---:|---:|---:|---:|---|
| 2026-05 | 714,79 € | 921,11 € | -206,32 € | 301,04 € | Reconstruido por eventos |
| 2026-06 | 3.768,89 € | 3.279,20 € | 489,69 € | 1.453,10 € | Reconstruido por eventos |
| 2026-07 | 9.616,50 € | 8.078,59 € | 1.537,91 € | 3.733,04 € | Cierre validado |
| 2026-08 | 3.813,79 € | 3.938,80 € | -125,01 € | 1.902,14 € | Reconstruido por eventos |
| 2026-09 MTD (día 11) | 4.848,52 € | 3.490,55 € | 1.357,97 € | 1.619,10 € | Realizado MTD |

Para cada fila se verifica al céntimo `facturación - costes = beneficio`, `SUM(daily) = monthly` y la suma diaria de Meta.

## Fuentes y límites observados

- Pedidos, timestamps y estados: Dropea Public API V2.
- Publicidad: Meta Marketing API, granularidad diaria.
- Costes y devoluciones: `order_costs` de Dropea cuando exista; en la muestra de 100 entregas reales no apareció en ninguna. El fallback queda identificado con versión, fecha efectiva y fuente contable.
- Precio mayorista: 100/100 líneas inspeccionadas tenían `wholesale_price = 0`; se evita el fallback silencioso a cero.
- Gastos: ledger analítico versionado. El gasto recurrente actual de septiembre suma exactamente 176,39 € al cierre del mes y se prorratea en céntimos para el P&L diario.
- Atribución Meta por SKU: Dropea y Meta no exponen una clave común fiable. Se muestra como “Publicidad no atribuida a SKU”; no se inventa una distribución.
- Dropea V2 no expone `shipped_at` en el contrato observado; `processing_at` es el evento oficial más cercano para devengar preparación/envío. La interfaz y la trazabilidad indican esta procedencia.

## Superficie modificada

- Read model financiero canónico y cacheado.
- Ledger versionado de tarifas y gastos.
- Endpoint existente `GET /api/finance?month=YYYY-MM` ampliado con mes anterior equivalente, histórico, MTD/proyección, data quality y freshness.
- Dashboard con navegación mensual, comparación, KPIs, funnel, P&L diario, tendencia mensual, costes, producto, tabla ordenable/seleccionable y CSV.

No se modificó ninguna ruta operativa, plantilla, agente, timer, descuento, devolución ni acción sobre pedidos/clientes.

# Panel de resultados · rediseño de septiembre de 2026

## Auditoría y fuentes

Base: `6391dee8d421294a681648a3faf96fa586d31a31`. El panel consume el endpoint existente `GET /api/operations/finance?month=YYYY-MM`. `OperationsRepository.financialSummary` combina seis lecturas paralelas del modelo local con los informes canónicos de `FinanceReportClient`. Se conserva la caché de 120 segundos, la agrupación de solicitudes concurrentes y el último informe disponible durante errores de actualización.

Las doce métricas solicitadas ya existen: beneficio, facturación, costes, ROI, ROAS, margen, confirmación, entrega, rechazo, entregados, devueltos y tránsito. Rechazo es rechazados/pedidos creados; devolución es otra métrica. El desglose excluyente agrupa tránsito e incidencias en `inAir`, por lo que la leyenda lo declara expresamente. La tarjeta de tránsito conserva `inTransit`.

La atribución permanece por fecha de compra, con resultados actuales de esa cohorte y zona Europe/Madrid. Beneficio, reconocimiento de costes, IVA, devengo, denominadores, redondeos, tasas y filtros no cambian. La comparación MTD contra un mes completo continúa deshabilitada por el backend. No se ha demostrado ni corregido un error financiero.

## Implementación

`results-dashboard.js` contiene KpiCard, Sparkline, MetricTooltip, SourceStatus, DataQualityBadge, ChartCard, StatusBadge y DailyResultsTable. El CSS nuevo está limitado a resultados y clases propias. Doce tarjetas, seis gráficos, navegación mensual, comparativa de 6/9/12 meses, tabla con columnas seleccionables y CSV. El histórico permite abrir un mes mediante ratón o teclado. Los tooltips diarios funcionan también con foco.

Los gráficos usan SVG y CSS sin bibliotecas nuevas. Las únicas operaciones numéricas de presentación son formato, escala, posiciones y comprobación de la partición del donut. Las tasas diarias de confirmación y entrega se exponen mediante el cálculo existente de `sourceCounts`, con valores nulos si faltan sus entradas. No se añaden tablas, migraciones, endpoints ni consultas por pedido.

Los periodos incompletos, fuentes atrasadas y datos no verificables tienen etiquetas explícitas. Los valores ausentes no pasan a cero. El fallback de liquidaciones por fecha de evento no puede presentarse como resultado por cohorte, incluido el histórico. El waterfall no inventa componentes ausentes.

Se conservan las funciones anteriores como fallback si no carga el módulo nuevo, los detalles de auditoría y la gestión existente de gastos. Las demás vistas y automatizaciones permanecen intactas.

## Validación

- 991 pruebas locales correctas, incluyendo siete pruebas nuevas de integración DOM y una de tasas diarias del backend.
- Conciliación con entrada agregada fija de mayo, junio, julio, agosto y septiembre: 60 comparaciones de KPI, diferencia cero. Igualdad profunda del informe completo, exceptuando los dos campos diarios aditivos.
- Reproducción: `node scripts/verify-results-redesign.mjs <snapshot-agregado.json> <salida.json> [revision-base]`. El snapshot y las tablas con importes se entregan localmente; no se publican en GitHub.
- Se mantiene la prueba de rendimiento con un histórico de tamaño productivo; no se añaden llamadas al cargar los gráficos ni dependencias de gráficos.
- CSS con rejilla de seis tarjetas y tres gráficos en escritorio, tres tarjetas y dos gráficos en pantallas intermedias, y adaptación a una columna de gráficos en móvil. La tabla tiene scroll local.
- No se han obtenido capturas ni comprobado píxeles, overflow real o contraste mediante navegador: AGENTS.md prohíbe abrir o automatizar navegadores. Las verificaciones DOM/CSS no sustituyen esa revisión visual; queda declarada esta limitación.

## Publicación

`deploy-results-dashboard-v2.sh` construye y prueba la imagen en Node 22 antes de reemplazar únicamente API y panel. Conserva las variables de entorno y los otros nueve contenedores, verifica los archivos servidos y la salud, comprueba cero acciones externas en el outbox de incidencias y tiene rollback. No modifica Render, el lector, motores, proveedores ni esquema.

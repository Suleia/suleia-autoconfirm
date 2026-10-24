# Suleia Ads Intelligence V9 — Decisiones diarias (candidato de desarrollo)

## Objetivo
Añadir, **debajo de las métricas de Visión general y en los informes ejecutivos V8**, una lectura compacta y comprensible de campañas, conjuntos y anuncios: proteger, mantener, mejorar conversión/creatividad, investigar, revisar reducción, revisar pausa y candidato a escalado. **Solo propuestas.** Nunca activa/desactiva anuncios ni modifica presupuestos Meta.

## Base revisada
Basado en la rama `codex/ads-intelligence-v8` (PR #141, commit `09af1f6f5b345a2ec7910df301748ea01bc55138`). V8 tiene lectores canónicos, `createReviewService`, auditoría V7, API OAuth, pestaña Informes y revisiones, motor determinista y scheduler Telegram de las 22:30 Europe/Madrid. El despliegue previo documentado en PR #141 no equivale a que este V9 esté en producción.

## Cambios
- `services/meta-ads/executive/daily-decisions.mjs`: evaluación determinista, tres niveles, umbrales internos de muestra, evidencia semanal/mensual, embudo, clasificación explicable, máxima dos prioridades por campaña.
- `services/meta-ads/executive/service.mjs`: lee siete días completos de conjuntos desde el lector compartido, junto con campañas, anuncios y mes, sin cliente Meta adicional. Fallos parciales se indican, no se convierten en ceros.
- `services/meta-ads/executive/report.mjs`: adjunta `dailyDecisions` a la misma representación persistida de V8; conserva **cuatro mensajes Telegram** y su programación existente, sin nuevos envíos ni modificaciones monetarias. El informe V8 añade el resumen estructurado para el panel; no altera el cuerpo de Telegram.
- `apps/review-panel/ads-executive-v8.js`: tarjetas compactas, prioridades y tabla ampliable por nivel, con enlace a auditoría de campaña o vista de anuncios.
- `apps/review-panel/ads-review-v6.js`: muestra el último informe diario persistido en Visión general, con fecha y corte reales; si el informe no contiene V9 o es histórico, lo etiqueta claramente.
- `apps/review-panel/ads-daily-decisions-v9.css`: CSS encapsulado en `#ads-view`, responsive y sin modificar el AppShell.
- `apps/review-panel/index.html`: carga hoja de estilos V9.
- `services/meta-ads/executive/daily-decisions.test.mjs`: nueve casos de regresión de clasificaciones, medición incompleta, día parcial y cero escrituras.

## Reglas de lectura
1. El rendimiento del **día actual solo es contexto**: ninguna pausa ni reducción se propone por un mal día aislado.
2. `REVISAR_PAUSA` exige varias ventanas completas desfavorables y evidencia compatible. Nunca es orden de ejecución.
3. `CANDIDATA_ESCALAR` exige compras suficientes, ROAS semanal y mensual > 3,8, estabilidad relativa y propuesta explícita de validar la política V5.1 con las compras del día, límites y economía.
4. `REVISAR_REDUCCION` exige empeoramiento relevante frente a los siete días anteriores y apoyo mensual compatible.
5. Los cambios en la tasa relativa del embudo se evalúan con denominadores mínimos observados y se etiquetan como **hipótesis**, no causa demostrada.
6. Missing / ambiguous Purchase, contrato de atribución incompatible o fuente histórica: abstenerse. **N/D no se sustituye por cero.**
7. No se asignan pedidos, confirmaciones, entregas o márgenes a una campaña sin enlace verificable.
8. Se preservan las reglas LIVE V5.1, el único ejecutor presupuestario, el scheduler y los cuatro mensajes Telegram V8.

## Seguridad, integración y evolución
Los estados son recomendaciones legibles: `DATOS_INSUFICIENTES`, `INVESTIGAR`, `MANTENER_VIGILAR`, `PROTEGER`, `MEJORAR_CREATIVIDAD`, `MEJORAR_CONVERSION`, `CANDIDATA_ESCALAR`, `REVISAR_REDUCCION` y `REVISAR_PAUSA`. Todos incluyen `requiresApproval=true`, `actionExecutable=false`, `externalWrites=0`.

V8 genera y persiste el informe diario; V9 lo enriquece. La sección Visión general lee el historial por el endpoint ya autorizado y se actualiza al consultar la vista. No instala tareas nuevas ni altera frecuencia de informes. Un análisis anterior conserva el corte y puede ser parcial; no se presenta como consulta viva.

## QA realizado en ChatGPT
- Se inspeccionó el código real en GitHub (PR #141) y se comprobó el estado abierto/draft de la PR.
- Comprobación de sintaxis de 6 archivos JS mediante compilación léxica en runtime aislado.
- Se ejecutaron **9/9** comprobaciones funcionales de la lógica `buildDailyDecisions` con fixtures, sin API ni escrituras reales.

## QA y despliegue aún pendientes
No se ha ejecutado la suite completa `node --test` ni QA visual con navegador en un checkout local del monorepo; por tanto, esta rama **no está lista para despliegue automático**. Codex debe:
- Ejecutar suites completas de Meta Ads, Telegram, API, panel, Budget Autopilot V5.1 y pruebas PostgreSQL.
- Validar el tiempo añadido de la lectura por conjuntos: cuotas Meta, deadlines de informe y degradación conservadora con fallos de fuente.
- Verificar histórica/actual, todas las filas, navegación, miniaturas, móvil, login OAuth, enlaces de informes y ausencia de XSS.
- Probar la compatibilidad estructural de informes V8 guardados sin V9.
- Hacer screenshot desktop/móvil con datos fixture, diferenciarlos de datos reales.
- Comparar hashes de políticas financieras, flags LIVE y temporizadores antes/después.
- Hacer backup y diseñar rollback sin borrar recibos Telegram, migración 059 ni ledger V5.1.
- Pedir aprobación expresa del despliegue; nunca modificar presupuesto o pausar entidades como parte de pruebas.

## Nota sobre futuras mejoras
La capa de decisiones se puede extender a tasas reales de confirmación y entregas **solo después** de reconciliar identificadores Meta → Shopify → Dropea por cohorte y coste. La simulación de objetivo 40 confirmados/55 pedidos no autoriza subida de inversión.

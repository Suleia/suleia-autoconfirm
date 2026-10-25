# Suleia Operations Center V11 — candidato

Estado: implementado para revisión, **sin desplegar**. La autorización actual permite pruebas locales DEMO y lectura del panel productivo. El encargo V11 exige aprobación específica antes de otro despliegue. Evidencia visual, pruebas y mediciones: [QA](OPERATIONS_CENTER_V11_QA.md). Procedimiento: [release y reversión](OPERATIONS_CENTER_V11_RELEASE.md).

## Auditoría del estado real

Verificación por SSH el 25/10/2026 a las 09:09 UTC y consulta visual autenticada de las seis secciones, sin acciones:

| Superficie | Evidencia |
| --- | --- |
| API | `suleia-ads-growth:7224c11`, revisión `7224c11fad4a5557732da7c935ff3bef5d2c0f35`, saludable |
| Imagen | `sha256:a02a3618de627d5dd9631e8e5a8f8e8bc505e57d09f1a82c9636d266a7f165aa` |
| Panel | `/opt/suleia-panel-releases/ads-growth-svg-b048ad5` |
| Código base | 108/108 archivos contrastados contra la base V10, sin diferencias |
| Controles financieros | 19 hashes protegidos coinciden con producción |
| Bot | Activo; configuración sin cambios; un destinatario diario |
| Informes | Dos informes diarios READY y ocho partes SENT en la ventana auditada; último envío 24/10 a las 20:33 UTC |
| Render | `d175378d288d33823ced70f8db3b3a806854377e`, saludable |
| Base de datos | Operativa, sin recuperación; sin migraciones V11 |

El panel financiero productivo mostró datos poblados, seis meses, 36 SVG y 33 controles correctos / cero fallidos. Pedidos, Incidencias, Automatización y Centro de datos también devolvieron contenido. Ads reprodujo la espera inicial y después mostró un corte histórico, con decisiones dependientes de frescura bloqueadas. Esta auditoría **no acredita que el lector productivo ya esté reparado**: V11 todavía no está instalado.

Budget Autopilot estaba configurado en LIVE, pero sus cuatro slots del día auditados terminaron BLOCKED, con cero escrituras externas verificadas. Había 36 operaciones BLOCKED y ninguna UNKNOWN/EXECUTING. El canario seguía `CANARY_PENDING`. Entre los motivos registrados estaban aprendizaje, cambios recientes, muestra/histórico insuficientes y ROAS ausente. COMPLETE solo significa que terminó el slot. No equivale a modificar un presupuesto. No se forzó un canario, no se reprodujeron operaciones ni se cambiaron estos controles.

## Causas y correcciones

| Problema comprobado en código o UI | Corrección V11 | Límite |
| --- | --- | --- |
| Una consulta normal leía campañas, conjuntos y anuncios, tres Insights por nivel y extras antes de responder | Lectura inicial del nivel solicitado; selección, histórico y extras progresivos | El informe heredado sin nivel conserva el contrato completo |
| Fechas equivalentes y filtros por entidad repetían GET | Caché compartida de GET y coalescencia; clave Insights por fechas, nivel, daily y extended | Un solo cliente existente por cuenta/versión; no caché en la revalidación financiera crítica |
| Errores de cuota se reintentaban antes de compartir la pausa | Cola común, clasificación de código 17/429, Retry-After, pausa global y jitter | Un rechazo externo puede seguir impidiendo datos actuales |
| Consultas analíticas competían con lecturas críticas | Dos lecturas concurrentes como máximo; solo una analítica; prioridad para el lector crítico | No evita una cuota ya agotada por Meta u otro consumidor |
| Reinicio o fallo eliminaba el último corte visible | Conservación en memoria y restauración SELECT de `economics.ads_insights` | Restaurado siempre histórico; no inventa entrega, presupuesto ni frescura |
| PREPARING sustituía todo el contenido y se repetía sin distinción | Espera de cliente acotada; conserva evidencia y explica el fallo; no sondea automáticamente un FAILED de cuota | El trabajo en curso queda reservado hasta que termina, evitando duplicados |
| Histórico lento o extra fallido borraba el resumen | Resumen publicado primero, bloques opcionales independientes, reintento del histórico | No se fabrican recomendaciones con contexto incompleto |
| Drawer vacío ante cualquier fallo o periodo incorrecto | Semilla de la fila exacta y su periodo; cancelación de respuestas antiguas; conserva KPIs y scroll | Hijos/desgloses se leen explícitamente; ausencia se explica |
| Avisos con decenas de identificadores invadían la página | Calidad compacta, causas agrupadas, detalle técnico desplegable | No se ocultan los bloqueos de datos o ejecución |
| Refresco de 45 s cerraba columnas/evidencia durante la lectura | Difiere refresco en segundo plano con detalles abiertos o filtros en edición | Actualizar manual sigue disponible |
| Búsqueda de campañas no se aplicaba al escribir | Filtro con debounce y conservación del foco/cursor | No consulta Meta para cada texto escrito |

## Contratos de datos

- Totales de un solo nivel. ROAS, CPA y tasas se calculan desde sumas compatibles; no se promedian ratios.
- Ausente no equivale a cero. Si el total es incompleto, se conserva como incompleto y puede mostrarse un subtotal explícito de una población común verificada, con su cobertura.
- Alcance único y frecuencia no se suman entre entidades/días. Su ausencia agregada explica la causa.
- Fecha de observación original del GET, sin renovar frescura por un hit de caché. El presupuesto mostrado es inventario observado, con su propia fecha; no acredita revalidación del ejecutor.
- Series reales con huecos y fechas; no se rellenan ceros ni una base incompatible. Los subtotales diarios parciales se etiquetan.
- Miniaturas unidas por ID exacto de anuncio; URLs HTTPS allowlisted. Un fallo de miniatura no elimina el resto del análisis.
- Compras atribuidas de Meta, pedidos creados, eventos de confirmación y cohortes maduras son poblaciones distintas. Se conservan las reglas financieras y de negocio existentes.
- Los objetivos son objetivos; no cifras realizadas ni promesas. Sin enlace verificado Meta–Shopify–Dropea no se presenta beneficio por campaña ni CPA sostenible.

## Implementación y límites operativos

`request-scheduler.mjs` centraliza la cola del lector existente: máximo dos lecturas, una analítica, 64 en espera y timeout de cola de 30 s. Los métodos de informe tienen deadline de 45 s entre páginas; el lector crítico original no recibe ese deadline analítico. Las lecturas UI usan prioridad 10; la infraestructura admite prioridad 20, sin afirmar que todos los consumidores históricos ya la utilicen.

Se registran contadores, latencias p50/p95/p99 sobre un máximo de 256 observaciones, estado de cola/circuito y porcentajes de cabeceras de cuota. Se eliminan IDs de negocio y texto bruto del proveedor. La ruta OAuth existente `/api/operations/ads-intelligence/status` expone este diagnóstico, sin disparar otra consulta Meta. No se añadió un endpoint público ni otro token.

La caché GET retiene como máximo 96 entradas / 60.000 filas: Insights 60 s, metadatos 5 min. La caché de informes retiene como máximo ocho cortes / 40.000 filas y dos trabajos. La restauración usa SELECT del modelo ya existente; no añade tablas ni privilegios. Un timeout no libera prematuramente una consulta todavía activa.

El informe ejecutivo mantiene su espera opcional acotada de siete segundos para completar el contexto, mientras la UI publica antes los bloques disponibles. No cambian los cuatro fragmentos, destinatario, horario 22:30 Europe/Madrid, consumidor, token, idempotencia ni política del informe diario. El coste OpenAI sigue en 0 USD.

## Interfaz compartida

Una AppShell en las seis secciones: lateral azul marino, selección turquesa, tipografía, espaciado, bordes, tarjetas y controles coherentes. Ads tiene cabecera compacta, nueve pestañas, 18 métricas, iconos distintos, sparklines con datos, evolución, embudo con costes/tasas, decisiones, tabla/tarjetas, búsqueda, filtros, columnas y paginación. El panel lateral conserva identidad y periodo con pestañas de resumen, creatividades, audiencia y ubicaciones.

Las capturas son de la implementación local real con datos sintéticos claramente marcados, no otro mockup. El contenido varía frente a la imagen conceptual porque conserva las métricas y límites acreditados. No se añade una interpretación causal o rentabilidad ficticia para imitar un número del diseño.

## Integraciones y bloqueos externos pendientes

1. La cuota real de Meta depende también de otros consumidores. La auditoría de V10 había capturado HTTP 400 / código 17 / subcódigo 2446079. Esta revisión no realizó un nuevo barrido de cabeceras contra Meta. V11 clasifica y degrada esos fallos; hace falta verificar su comportamiento productivo tras autorización.
2. Insights agregado no acredita `event_id`, deduplicación Pixel/CAPI, EMQ ni trazabilidad de cada compra. No se afirma que la web o el checkout estén rotos por una diferencia entre poblaciones.
3. La ausencia de una escritura presupuestaria verificada y el canario pendiente siguen documentados; V11 conserva sus barreras y no los resuelve forzando gasto.
4. El registro MCP actual no ofrece herramientas Ads específicas de lectura. Propuesta mínima pendiente: envoltorios de los GET ya existentes para estado de lecturas, review/growth por fechas/nivel y auditoría de presupuestos. Deben reutilizar sesión/RBAC, límites, caché, saneamiento y cliente existentes. Sin nuevos tokens, escritor Meta, acceso público ni mecanismo paralelo. No se amplían permisos en este candidato.
5. La pestaña Audiencia solo puede describir los desgloses que la fuente devuelva; no acredita segmentación psicológica ni atribución causal. Si faltan, se indica expresamente.

## Superficies preservadas

Sin cambios de esquema, SQL de negocio financiero, COGS, reembolsos, pedidos, direcciones, descuentos, plantillas, flujos Chatby, Shopify, acciones Dropea, RBAC/OAuth, política V5.1, límites de gasto, ejecutor de escrituras, canario, ledgers o consumidores Telegram/Render. El cambio del lector compartido está cubierto por pruebas del camino crítico fresco y de bloqueo de cuota.

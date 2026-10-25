# V11 — despliegue autorizado y verificación

El dueño aprobó expresamente «Sí, desplegar V11 y verificar» en `call_7e923c9e840e495a84338378c337e0ab`. Se aplicó la PR #148, código runtime `3333429b7f3718d05136e89acbea56fe89b740ba`, el **25/10/2026 a las 10:27:44 UTC** (11:27 Madrid). [Recibo](OPERATIONS_CENTER_V11_DEPLOYMENT.json).

## Artefactos efectivos

- API `suleia-operations-v11:3333429`, image ID `sha256:c7b5dcab1e1f948e054c8dfa1eeb7f549d379381f71dd53122d9c9803757b59b`, saludable.
- Panel `/opt/suleia-panel-releases/operations-v11-3333429`.
- 20 archivos runtime comprobados, nueve estáticos servidos por HTTPS con hash correcto y `Cache-Control:no-store`; versión interna correcta.
- Auditoría completa posterior: **111/111 archivos esperados**, sin diferencias; 19 fuentes presupuestarias protegidas sin cambios.
- Rutas privadas growth, historial de revisión, finanzas e incidencias responden 401 sin OAuth; health público responde 200. La sesión personal existente accedió de nuevo sin cambiar credenciales o roles.

Se guardaron configuración y estáticos anteriores privadamente, con intención/aplicación/HTTP receipts en `/root/suleia-operations-v11-deploy-20261025/3333429/`. Se mantiene la imagen LIVE anterior y su montaje para [reversión](OPERATIONS_CENTER_V11_RELEASE.md). No hubo migración, reinicio de bot/Render ni limpieza/reproducción de claims o ledgers.

## Comprobaciones posteriores

| Superficie | Resultado observado |
| --- | --- |
| Pedidos | Tabla poblada; sin acciones sobre pedidos |
| Incidencias | Diez filas visibles; sin mensajes, descuentos o soluciones ejecutados por esta prueba |
| Automatización | Seis flujos visibles; sin ejecutarlos |
| Resultados | 33 controles correctos, cero fallidos, 36 SVG y seis meses disponibles |
| Centro de datos | Nueve SVG y datos canónicos visibles |
| Ads | 18 KPIs, gráficas con dimensiones reales y tabla; lectura actual «Meta · lectura verificada» tras el corte histórico inicial |
| Análisis | Campaña, conjunto y anuncio mantienen la entidad/periodo exactos y KPIs; comparador histórico termina de cargar, no queda un drawer vacío |
| Consola | Cero errores JavaScript observados en la comprobación |

El lector productivo devolvió nuevos datos: una observación de salud a las 10:32 UTC mostró 14 GET, cola cero, circuito CLOSED, ningún último fallo y un éxito a las `10:32:01.813Z`. Latencias de esa ventana: p50 982 ms, p95/p99 2.546 ms. Son una muestra del proceso, no un SLA ni una comparación controlada con V10. La vista principal pasó del corte restaurado histórico a lectura verificada; el análisis de campaña mostró el periodo seleccionado y comparaciones de hoy/ayer/3/7/14/30 días cuando había evidencia.

Los conjuntos/anuncios con cobertura o contexto insuficientes siguen bloqueando recomendaciones; su análisis presenta el motivo y las métricas reales. Una miniatura no disponible se señaló expresamente sin eliminar el análisis. El panel financiero conserva las fechas/avisos de fuentes: no se presenta una instantánea atrasada como actual por el mero hecho de recargarla.

Cierre financiero: se restauró la vista original del usuario. Continuaba con 33 controles correctos y cero fallidos; Dropea sincronizado a las 11:38 Madrid y Meta/informe a las 11:30, sin el aviso de datos atrasados anterior. Mantiene su etiqueta provisional MTD del mes en curso, acorde con sus reglas existentes.

## Continuidad y límites

La configuración LIVE, límites/política V5.1 y 19 archivos protegidos siguen iguales. Bot activo, mismo PID/configuración, token/administradores y un destinatario; mismo horario 22:30 Madrid y ocho partes SENT acumuladas antes de este despliegue. Render `d175378d288d33823ced70f8db3b3a806854377e` saludable. Los demás IDs de contenedor y las tarifas financieras quedaron intactos. Cero acciones Meta o de clientes **por el proceso de release**; no se provocó ningún envío de prueba.

La última revisión presupuestaria anterior al despliegue, 11:00 Madrid, seguía FAILED con código genérico `AUTOPILOT_REVIEW_FAILED`. A las 10:39 UTC había cero escrituras VERIFIED, cero operaciones UNKNOWN/EXECUTING y `CANARY_PENDING`. No se reintentó ese slot. Las nuevas lecturas funcionan; **todavía no se acredita una modificación automática de presupuesto tras V11**. Debe observarse un siguiente slot natural y, si cumple todas las guardas, su primera escritura con GET posterior. El informe diario se verifica en su envío natural, no duplicándolo.

No se aplicó la propuesta estratégica de otro agente sobre nuevos máximos/horarios/reducción nocturna: es una política separada de este release. No se habilitó OpenAI (0 USD), otro escritor/lector, accesos públicos ni permisos SQL nuevos. Las limitaciones de atribución, Pixel/CAPI/EMQ y beneficio por campaña siguen documentadas en la auditoría.

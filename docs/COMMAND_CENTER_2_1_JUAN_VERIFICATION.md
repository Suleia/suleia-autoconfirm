# Command Center 2.1 — verificación desde Windows Juan

Verificado el 22/10/2026, 00:33 Europe/Madrid. Petición del propietario: implementar el prompt Command Center 2.1 en el bot existente.

## Implementación y despliegue

El Agent Hub confirmó la implementación y activación previa de PR128/API `eb510a8ca04ed5925e47417c718fb677bca7e060` y PR129/Telegram `4e79eac2b6b5ff3ff6789c1a7ce8574555da27fb`. Se verificaron directamente el servicio y la API desde el acceso SSH propio de Juan.

La prueba real detectó que el foco canónico diagnosis hacía demasiado detalladas las consultas generales. PR131, código `ec2ab0a48e9b212f898b50c86f9c9759ee74ea53`, corrige el formato por defecto. Archivos:

- infrastructure/telegram-center/compact-reports.mjs: resumen de cuatro campañas por página sin CTR/CPC/CPA por defecto.
- infrastructure/telegram-center/ads-gateway.mjs: petición explícita de diagnóstico/detalle conserva la vista detallada.
- infrastructure/telegram-center/ads-gateway.test.mjs: regresión de consulta general, navegación y detalle explícito.

El árbol publicado `e042cb362e0e08c3ce566978f7786e50ade3d034` coincide con el probado localmente. Release activo: `/opt/suleia-telegram-releases/release.command-center21-ec2ab0a`. Salud fresca READ_ONLY a las 22:33:35 UTC, único poller PID3487984 coincidente con process.lock. Configuración, unidad systemd y credenciales preservadas. Sin cambios de API, panel, pedidos, campañas ni automatizaciones.

## Pruebas y evidencia

- 20 pruebas focalizadas locales y 92 pruebas completas de Telegram bajo Node22/Linux: todas pasan; las 20 están incluidas en las 92.
- Lectura real a través del gateway firmado: preguntas de pedidos, confirmaciones realizadas hoy, última hora y campañas.
- Ambos administradores: controlador activo con API real y transporte Telegram sustituido localmente. Respuestas HTML y navegación verificadas; Actualizar edita el mensaje original sin duplicarlo. Cero mensajes de prueba enviados. Esta es evidencia de protocolo, no una captura ni una medición de entrega a Telegram.
- Caso histórico 22 recibidos/17 confirmados/4 pendientes/1 cancelado: fixture pasa, tasa77,3%. Nunca se insertan estos valores en producción.
- Regresiones existentes de botones, permisos, concurrencia, ROAS ausente, muestras pequeñas, escape HTML, foco V3, recomendaciones y paginación pasan.
- La consistencia Meta panel/Telegram fue verificada en el despliegue anterior según Agent Hub issuecomment-6327126161; este cambio solo altera formato y no vuelve a certificar independientemente todo el panel.

## Fuentes y ejemplos reales sin datos personales

La instantánea Dropea observada a las 00:28 Madrid del22/10 devolvió1 pedido creado hoy:0 confirmados,1 pendiente,0 cancelados. Otra lectura a las00:23 devolvió0 confirmaciones realizadas hoy y4 pedidos en la última hora, incluyendo el día anterior. Son instantáneas históricas de esta comprobación, no contadores actuales permanentes.

Mensaje real:
> PEDIDOS DE HOY — Recibidos:1; Confirmados:0; Pendientes:1; Cancelados:0; Confirmación:0%. Copia desactualizada. Actualizado:22/10/26,00:28. Fuente:Dropea V2.

Meta devolvió gasto3,79EUR, compras globales y ROAS global N/D; una campaña con una sola compra tenía ROAS90,88 y se marcó muestra insuficiente. Campañas con ROAS no verificable permanecieron N/D. El informe tenía2 páginas, cuatro campañas en la primera, con Actualizar/Ver diagnóstico/Ver anuncios/Ver más. La instantánea se advirtió antigua cuando no se completó el refresco.

## Rendimiento y límites

Primera consulta de pedidos:1525ms; confirmaciones:101ms; última hora:75ms. Primera consulta fría Meta falló tras4048ms; consulta posterior:305ms. El controlador devuelve un error comprensible ante indisponibilidad. No se corrigió ni se ocultó ese límite del proveedor.

Canarios completos consulta más clic Actualizar: pedidos401/213ms; Meta8504/5808ms. Estos tiempos incluyen dos lecturas y transporte Telegram local simulado; no son latencia de entrega ni prueban un SLA. La consulta Meta lenta devuelve la instantánea anterior con advertencia cuando existe.

Dropea depende del importador existente. El lector actual no ofrece refresco de origen bajo demanda; no se creó un segundo importador ni se aceleró otro flujo operativo. Se comprueba frescura y se advierte si supera60s. No hay catálogo producto/campaña verificado, por lo que no se infieren productos por nombre. Meta mantiene escrituras desactivadas. No hay prueba visual de entrega ni se garantiza que cada lectura sea reciente.

## Rollback

Se retuvo el release previo y copia privada del estado en `/root/suleia-juan-compact-131/state-before`. Para revertir código: detener suleia-telegram, apuntar el enlace al release previo `release.command-center21-4e79eac`, arrancar el mismo servicio y comprobar salud fresca y bloqueo coincidente. No restaurar ciegamente el offset antiguo ni duplicar polling.

El despliegue cambió únicamente dos módulos y mantuvo el resto byte por byte. Una línea CR final añadida por la tubería Windows produjo un error de shell después de completar las verificaciones; una comprobación SSH independiente posterior devolvió servicio activo, release esperado y healthcheck exit0. No se repitió el despliegue.

## Handoff

FROM: Codex Windows Juan
STATUS: verified
SCOPE: PR131; formato compacto del bot existente.
EVIDENCE: 92 pruebas Linux, lecturas firmadas reales, ambos administradores con transporte local y salud posterior.
NEXT: usar las consultas normales en Telegram; mantener visibles las limitaciones de frescura.

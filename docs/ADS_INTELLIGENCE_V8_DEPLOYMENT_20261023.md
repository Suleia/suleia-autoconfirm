# Ads Intelligence V8 — despliegue del 23 de octubre de 2026

Estado documentado a las 11:33 UTC (13:33 Europe/Madrid). **V8 desplegado; envío diario pendiente de la comprobación autenticada del panel.** No se declara completada la activación ni entregado el primer informe.

El propietario autorizó el despliegue, la migración aditiva 059, las comprobaciones sin escrituras publicitarias y la activación posterior exclusivamente para su cuenta Telegram verificada. La autorización de activación sigue vigente, condicionada a superar las verificaciones.

| Comprobación solicitada | Resultado y evidencia |
| --- | --- |
| 1. Despliegue | API, panel y único servicio Telegram V8 desplegados. Corte terminado a las 11:13:40 UTC, fuera de los slots presupuestarios. PR [141](https://github.com/Suleia/suleia-autoconfirm/pull/141). PR139 y PR140 seguían abiertas; se integró su código necesario sin presumir que estuvieran fusionadas. |
| 2. Revisión exacta | `20378bd5dd1fddb2ab3aa80bfb0ac07a14845528`. Los commits posteriores de documentación no representan otra versión productiva. |
| 3. API, panel y bot | API saludable, imagen `suleia-ads-v8-api:20378bd`, image ID `sha256:12deddf37c256ab0ad9d2fb553124872bb2e441a0fd4a09295d52fb0bbe9a840`. Panel en `/opt/suleia-panel-releases/ads-v8-20378bd`; bot en `/opt/suleia-telegram-releases/ads-v8-20378bd`, mediante el symlink existente. Hashes de los 43 archivos de ejecución previstos comprobados. |
| 4. Migración 059 | Aplicada a las 11:12:52 UTC. Dos tablas, tres índices únicos, permisos mínimos SELECT/INSERT/UPDATE sin DELETE para Ads. Checksum `d08aeacb21957cea26389a55f044fc6eb5bc1f80728b15336fccb7cc5d0810d3`. Huella del resto del esquema antes/después idéntica: `5d55b53916188abe180c9bfa13b6b234`. Protección frente a reaplicación por presencia y recibo. |
| 5. Pruebas | 531/531 pruebas del artefacto combinado, 56 archivos, cero omitidas; Node22.22/PostgreSQL17 aislados, sin red ni secretos productivos. HTTPS, 14 assets exactos, seis accesos sin autorización o con token inválido rechazados, discovery OAuth/PKCE-S256 y formulario de acceso verificados. Falta completar login personal y recorrido real de interfaz. |
| 6. Scheduler | Preparado dentro del único servicio Telegram. `ADS_EXECUTIVE_DAILY_ENABLED=false` en API y bot. No se creó otro consumidor, servicio ni temporizador. |
| 7. Próxima ejecución | Objetivo calculado **23/10/2026 22:30 Europe/Madrid**, equivalente ese día a 20:30 UTC. Es la próxima ejecución prevista **si se activa antes de la ventana**. Con el flag apagado no se enviará. La implementación contempla cambios de horario y ventana 22:30–23:00. |
| 8. Destinatarios | **Uno** configurado en API y bot: propietario identificado por la prueba de vinculación privada existente. Coinciden ID de usuario y chat privado. No se publica el número. Juan y otros usuarios no reciben el nuevo informe. |
| 9. Permisos | Ambos administradores conservan la allowlist y el rol efectivo admin existentes. Acceso Ads comprobado para ambos mediante el puente firmado; ruta ejecutiva comprueba Ads y finanzas. La llamada del segundo administrador a la entrega ejecutiva devuelve 403 `ACTOR_UNAUTHORIZED`. Token, roles e identidades sin cambios. |
| 10. Informe diario | **Desactivado**, pendiente de la verificación autenticada. Informe MANUAL real persistido, READY/PARTIAL, cuatro partes; cero entregas y sin reclamar el carril diario. Cero mensajes reales de prueba. |
| 11. Autopilot | Continúa habilitado en **LIVE** con el ejecutor existente. No se enviaron comandos presupuestarios ni se invocó el writer en las pruebas. Las actividades naturales del automatismo existente no se presentan como cambios de este despliegue. |
| 12. Reglas y límites | Huella de política antes/después idéntica y 19 archivos presupuestarios protegidos idénticos. Se conservan ROAS3,8, pasos ±10EUR, máximo70EUR/campaña, tres compras mínimas, objetivos nocturnos20/25EUR, horarios, guardas y autorizaciones V5.1. Todos los flags efectivos ajenos a las siete claves de versión/V8 permitidas se compararon sin diferencias. |
| 13. Operaciones | PostgreSQL, ingestion worker, MCP, materializador financiero, edge, proxy y monitorización saludables; autenticación y worker de incidencias en ejecución. Todos los contenedores ajenos al API/panel conservan su identidad. Render sigue saludable en `09065304f976faa7a1c02803b4fb74b560efc170`, confirmación real activa con espera1h y último ciclo sin error global. Recuperación Shopify→Dropea activa: último informe completo11:05 UTC,234 pedidos revisados,214 existentes,18 bloqueados,2 rechazos del proveedor; próxima12:05 UTC. No se lanzó otra revisión ni se modificaron pedidos. Véase la excepción de salud preexistente abajo. |
| 14. Limitaciones | Falta OAuth/UI autenticados de producción; no se afirma que el QA local los sustituya. Observador de ausencias con `CHATBY_MESSAGES_HTTP_404` intermitente previo a V8, contenedor intacto; su resolución figura DISABLED. Meta puede limitar consultas y la atribución sigue provisional. Detalles adicionales abajo. |
| 15. Rollback | Backups privados y restauración SQL aislada verificados; imagen API y releases anteriores retenidos. Restaurar API/panel y symlink del bot con el informe desactivado, conservando 059, reservas, recibos, offset y ledger presupuestario. No revertir presupuestos ni ejecutar rollback SQL destructivo. |
| 16. Evidencias | Recibos privados de preflight, backup verificado, pruebas, migración, despliegue, lectura real, HTTP, permisos y postcondiciones en el VPS; resumen sin secretos en este documento, PR141 y Agent Hub. No se publicaron configuraciones, backups, conversaciones ni IDs Telegram. |

## Informe real y lectura de datos

La comprobación de producción terminó a las **11:19:11 UTC**. Consultó exclusivamente `status` y `review` mediante el puente firmado existente y guardó una auditoría manual mediante el servicio ejecutivo desplegado. El generador recibió los resultados canónicos reales y lecturas SQL/configuración; no recibió transporte Telegram, captura presupuestaria ni writer.

| Lectura | Entidades | Observación UTC | Estado |
| --- | --- | --- | --- |
| Hoy / campañas | 32 | 11:17:27 | FRESH; día parcial, comparación diaria no equivalente |
| 7 días / campañas | 32 | 11:17:45 | FRESH; comparación válida |
| 7 días / anuncios | 141 | 11:17:45 | FRESH; comparación válida |
| 30 días / campañas | 32 | 11:18:08 | FRESH; comparación válida |

Contrato: `meta-v2:7d_click+1d_view:conversion:website-first:v1`. La auditoría individual mantuvo el ID exacto de campaña y sus cuatro anuncios; historial presupuestario disponible. Once respuestas iniciales `202 ADS_REPORT_PREPARING` continuaron los mismos trabajos; la comprobación terminó sin lanzar lecturas paralelas por cada reintento. Los contadores de propuestas, operaciones, eventos y slots permanecieron iguales durante esta prueba.

Informe manual: `df7677b28dd0026a548ac86d8edd83595d86f15e04eeddb150542efb7a5a79cc`, READY, datos PARTIAL, visible en el historial SQL. Sus cuatro mensajes tienen 1.518, 420, 1.376 y 2.876 caracteres. **Cero filas de entrega y cero reclamaciones diarias.** PARTIAL conserva las limitaciones de datos del día en curso y fuentes opcionales; no representa un corte exacto de conversiones a las22:30.

[Abrir la instantánea autenticada en el panel](https://mcp.suleia.com/operations/#ads?tab=reports&reportId=df7677b28dd0026a548ac86d8edd83595d86f15e04eeddb150542efb7a5a79cc&section=overview). El enlace no contiene credenciales. Su conservación tras login está probada con fixtures locales; el recorrido real de producción sigue pendiente.

## Alcance real de las verificaciones

Los artefactos se construyeron como una actualización acotada sobre la API `c259413`, el panel y el bot realmente desplegados. Se conservaron los archivos ajenos a V8. En particular, producción tenía un texto de incidencias más reciente que el candidato; no se sobrescribió. La suite combinada necesitó aceptar ese texto ya existente en una única aserción de presentación del harness de verificación. El test del repositorio y el código de incidencias no se modificaron como resultado de esta reconciliación. No se presenta esa adaptación del harness como una corrección de negocio.

La ruta ejecutiva desactivada del propietario devuelve503 `ADS_COMMAND_FAILED`: el sanitizador actual no publica el código interno `EXECUTIVE_DISABLED`. Esta respuesta genérica se registra como limitación diagnóstica, no como prueba de una entrega. El otro administrador recibe el403 explícito de autorización. La configuración y la prueba privada de vinculación acreditan un único receptor y el flag desactivado en ambos componentes.

El PDF comercial antiguo mantiene su configuración existente, con horario predeterminado23:55; su contenido de pedidos es distinto de los cuatro mensajes Meta V8. No se activó ni se usó para sustituir el nuevo informe. No había otro envío ejecutivo Meta V8 equivalente activo.

No se afirma disponibilidad integral de todos los proveedores por la salud global del API. El observador de ausencias ya alternaba healthy/unhealthy antes del despliegue. A las11:33 UTC su endpoint devolvió503 con `CHATBY_MESSAGES_HTTP_404`, último ciclo completado11:31:07 UTC y resolución DISABLED; no fue reiniciado ni cambiado. La corrección de ese flujo queda fuera de esta autorización V8. El contraste Shopify→Dropea terminó, pero conserva bloqueos/rechazos previos; un exit code aceptado por systemd no se confunde con recuperación de esos pedidos.

## Condición pendiente para activar

`AGENTS.md` prohíbe «Never open, launch or control a web browser for this project». La excepción anterior cubría solo capturas y pruebas **locales**. Se solicitó al propietario una excepción limitada al login y las vistas de producción, o que realice la comprobación manual. No hay cuenta de servicio OAuth configurada, y no se crearon clientes, credenciales ni permisos para eludir el login personal.

Hasta completar y registrar esa comprobación, se conserva `ADS_EXECUTIVE_DAILY_ENABLED=false`. Después debe comprobarse de nuevo la ventana presupuestaria segura, las operaciones inciertas/en ejecución y las huellas de política/identidad; entonces podrá aplicarse la activación ya autorizada y comprobarse el estado del scheduler. **No queda pendiente una nueva autorización de gasto.**

El primer envío solo se considerará entregado cuando existan cuatro recibos reales `message_id` por destinatario y parte. Una reserva SENDING/UNKNOWN sin recibo requiere reconciliación y no se fuerza de nuevo.

## Copias y recuperación

Copias privadas verificadas: esquema con grants, datos de18 tablas Ads/auditoría, configuración de API/bot/servicio y estado persistente Telegram. La restauración de esquema y datos se completó en PostgreSQL17 aislado, sin red ni credenciales de producción, y sus conteos coincidieron. Se conservaron los artefactos antiguos y se verificó su existencia; no se ejecutó un corte real de rollback.

La ruta operativa de rollback restaura API `suleia-bot-autopilot-reliability:c259413`, panel `budget-autopilot-live-e4d3b9d` y bot `reliability-c259413`, desactiva el envío ejecutivo y retiene los estados persistidos actuales. Solo debe ejecutarse tras comprobar concurrencia y ventana segura. No se eliminan tablas059, recibos ni historial V5.1.

Los comprobantes completos permanecen en el almacenamiento privado del VPS. Se descartó su exportación general tras el rechazo automático de seguridad; este documento resume únicamente estados, versiones, conteos y huellas técnicas.

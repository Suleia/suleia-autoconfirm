# Ads Intelligence V8 — despliegue del 23 de octubre de 2026

Estado comprobado de nuevo a las15:35 UTC (17:35 Europe/Madrid), después de la corrección de refresco descrita abajo. **V8 desplegado, verificado y envío diario activado desde las13:22:03 UTC (15:22 Madrid), únicamente para el propietario.** Primera ejecución prevista hoy a las22:30 Madrid. Todavía no existen recibos de ese primer envío y no se declara entregado.

El propietario autorizó el despliegue, la migración aditiva 059, las comprobaciones sin escrituras publicitarias y la activación posterior exclusivamente para su cuenta Telegram verificada. La autorización de activación sigue vigente, condicionada a superar las verificaciones.

| Comprobación solicitada | Resultado y evidencia |
| --- | --- |
| 1. Despliegue | API, panel y único servicio Telegram V8 desplegados. Primer corte11:13:40 UTC; reparación acotada verificada13:06:55 UTC y activación13:22:03 UTC, fuera de los slots presupuestarios. PR [141](https://github.com/Suleia/suleia-autoconfirm/pull/141). PR139/140 seguían abiertas; no se presume que estuvieran fusionadas. |
| 2. Revisión exacta | API: `867b3e016635c09ca9be69eae62be7c9e3701953`. Panel: `e231c0692bfadba67be11f387fd3ecbdd1bc9bb5`, actualización exclusivamente del archivo público app.js. Bot: `20378bd5dd1fddb2ab3aa80bfb0ac07a14845528`. Los commits posteriores de documentación no representan otra versión productiva. |
| 3. API, panel y bot | API saludable, imagen `suleia-ads-v8-api:867b3e0`, image ID `sha256:bf1c13a6b4eb5728ce99b9b00f74fca3d4435ad97298b45453925811e53f0d22`. Panel `/opt/suleia-panel-releases/ads-v8-e231c06`; bot `/opt/suleia-telegram-releases/ads-v8-20378bd`, symlink y consumidor existentes. Hashes de los43archivos previstos comprobados a las15:35 UTC. |
| 4. Migración 059 | Aplicada a las 11:12:52 UTC. Dos tablas, tres índices únicos, permisos mínimos SELECT/INSERT/UPDATE sin DELETE para Ads. Checksum `d08aeacb21957cea26389a55f044fc6eb5bc1f80728b15336fccb7cc5d0810d3`. Huella del resto del esquema antes/después idéntica: `5d55b53916188abe180c9bfa13b6b234`. Protección frente a reaplicación por presencia y recibo. |
| 5. Pruebas | **535/535**,56archivos,cero omitidas, Node22.22/PostgreSQL17 aislados sin red ni secretos productivos. HTTPS,14assets exactos,seis accesos no autorizados rechazados y PKCE-S256. Login personal/SSO, retorno al informe exacto, generación manual autenticada, campaña individual/cinco anuncios, comparación de dos anuncios, comparador, doce creatividades, recomendaciones, seis secciones y desktop1440×1080/móvil390×844 comprobados en producción. |
| 6. Scheduler | **Activado** dentro del único servicio Telegram; `ADS_EXECUTIVE_DAILY_ENABLED=true` en API y bot. Latido real NOT_DUE correcto a las13:23:41 UTC. Sin otro consumidor, servicio ni temporizador. |
| 7. Próxima ejecución | **23/10/2026 22:30 Europe/Madrid**, equivalente ese día a20:30 UTC. Confirmada tanto en el panel como por el scheduler real. Contempla cambios de horario y ventana22:30–23:00. |
| 8. Destinatarios | **Uno** configurado en API y bot: propietario identificado por la prueba de vinculación privada existente. Coinciden ID de usuario y chat privado. No se publica el número. Juan y otros usuarios no reciben el nuevo informe. |
| 9. Permisos | Ambos administradores conservan la allowlist y el rol efectivo admin existentes. Acceso Ads comprobado para ambos mediante el puente firmado; ruta ejecutiva comprueba Ads y finanzas. La llamada del segundo administrador a la entrega ejecutiva devuelve 403 `ACTOR_UNAUTHORIZED`. Token, roles e identidades sin cambios. |
| 10. Informe diario | **Activado**, único receptor verificado. Informe MANUAL real READY/PARTIAL con las cuatro fuentes FRESH y cuatro partes. A las13:24 UTC: cero informes DAILY todavía, cero entregas y cero recibos; primer envío pendiente de su hora. Cero mensajes reales de prueba. |
| 11. Autopilot | Continúa habilitado en **LIVE** con el ejecutor existente. No se enviaron comandos presupuestarios ni se invocó el writer en las pruebas. Las actividades naturales del automatismo existente no se presentan como cambios de este despliegue. |
| 12. Reglas y límites | Huella de política antes/después idéntica y 19 archivos presupuestarios protegidos idénticos. Se conservan ROAS3,8, pasos ±10EUR, máximo70EUR/campaña, tres compras mínimas, objetivos nocturnos20/25EUR, horarios, guardas y autorizaciones V5.1. Todos los flags efectivos ajenos a las siete claves de versión/V8 permitidas se compararon sin diferencias. |
| 13. Operaciones | PostgreSQL, ingestion worker, MCP, materializador financiero, edge, proxy y monitorización saludables; autenticación y worker de incidencias en ejecución. Todos los contenedores ajenos al API/panel conservan su identidad. Render saludable en `09065304f976faa7a1c02803b4fb74b560efc170`, confirmación real/espera1h, último ciclo13:26:19 UTC sin error global. Recuperación Shopify→Dropea activa: informe completo13:05 UTC,235pedidos,215existentes,20bloqueados; próxima14:05 UTC. No se lanzó otra revisión ni se modificaron pedidos. Véase el aviso preexistente abajo. |
| 14. Limitaciones | Informe PARTIAL explícito por cobertura/atribución; no se inventa corte exacto22:30. Sesión OAuth breve requiere renovación normal; SSO comprobado sin ampliar caducidad ni permisos. El cierre de auditorías por refresco periódico queda corregido en e231c06. Observador de ausencias con `CHATBY_MESSAGES_HTTP_404` intermitente previo a V8, contenedor intacto y resolución DISABLED; el muestreo15:35 fue saludable, sin afirmar que desapareció el fallo intermitente. Meta puede limitar consultas. |
| 15. Rollback | Backups privados y restauración SQL aislada verificados; imagen API y releases anteriores retenidos. Restaurar API/panel y symlink del bot con el informe desactivado, conservando 059, reservas, recibos, offset y ledger presupuestario. No revertir presupuestos ni ejecutar rollback SQL destructivo. |
| 16. Evidencias | Recibos privados de preflight, backup verificado, pruebas, migración, despliegue, lectura real, HTTP, permisos y postcondiciones en el VPS; resumen sin secretos en este documento, PR141 y Agent Hub. No se publicaron configuraciones, backups, conversaciones ni IDs Telegram. |

## Lectura inicial de datos, antes de la validación autenticada

La comprobación de producción terminó a las **11:19:11 UTC**. Consultó exclusivamente `status` y `review` mediante el puente firmado existente y guardó una auditoría manual mediante el servicio ejecutivo desplegado. El generador recibió los resultados canónicos reales y lecturas SQL/configuración; no recibió transporte Telegram, captura presupuestaria ni writer.

| Lectura | Entidades | Observación UTC | Estado |
| --- | --- | --- | --- |
| Hoy / campañas | 32 | 11:17:27 | FRESH; día parcial, comparación diaria no equivalente |
| 7 días / campañas | 32 | 11:17:45 | FRESH; comparación válida |
| 7 días / anuncios | 141 | 11:17:45 | FRESH; comparación válida |
| 30 días / campañas | 32 | 11:18:08 | FRESH; comparación válida |

Contrato: `meta-v2:7d_click+1d_view:conversion:website-first:v1`. La auditoría individual mantuvo el ID exacto de campaña y sus cuatro anuncios; historial presupuestario disponible. Once respuestas iniciales `202 ADS_REPORT_PREPARING` continuaron los mismos trabajos; la comprobación terminó sin lanzar lecturas paralelas por cada reintento. Los contadores de propuestas, operaciones, eventos y slots permanecieron iguales durante esta prueba.

Informe manual: `df7677b28dd0026a548ac86d8edd83595d86f15e04eeddb150542efb7a5a79cc`, READY, datos PARTIAL, visible en el historial SQL. Sus cuatro mensajes tienen 1.518, 420, 1.376 y 2.876 caracteres. **Cero filas de entrega y cero reclamaciones diarias.** PARTIAL conserva las limitaciones de datos del día en curso y fuentes opcionales; no representa un corte exacto de conversiones a las22:30.

[Abrir la instantánea inicial autenticada en el panel](https://mcp.suleia.com/operations/#ads?tab=reports&reportId=df7677b28dd0026a548ac86d8edd83595d86f15e04eeddb150542efb7a5a79cc&section=overview). El enlace no contiene credenciales. Su conservación tras login se verificó también en producción después de la reparación descrita abajo.

## Alcance real de las verificaciones

Los artefactos se construyeron como una actualización acotada sobre la API `c259413`, el panel y el bot realmente desplegados. Se conservaron los archivos ajenos a V8. En particular, producción tenía un texto de incidencias más reciente que el candidato; no se sobrescribió. La suite combinada necesitó aceptar ese texto ya existente en una única aserción de presentación del harness de verificación. El test del repositorio y el código de incidencias no se modificaron como resultado de esta reconciliación. No se presenta esa adaptación del harness como una corrección de negocio.

Antes de activar, la ruta ejecutiva desactivada del propietario devolvió503 `ADS_COMMAND_FAILED`: el sanitizador actual no publica el código interno `EXECUTIVE_DISABLED`. Esta respuesta genérica se registra como limitación diagnóstica, no como prueba de una entrega. El otro administrador recibió403 explícito de autorización. La configuración y la prueba privada de vinculación acreditaron un único receptor con el flag entonces desactivado en ambos componentes; su estado final es activado.

El PDF comercial antiguo mantiene su configuración existente, con horario predeterminado23:55; su contenido de pedidos es distinto de los cuatro mensajes Meta V8. No se activó ni se usó para sustituir el nuevo informe. No había otro envío ejecutivo Meta V8 equivalente activo.

No se afirma disponibilidad integral de todos los proveedores por la salud global del API. El observador de ausencias ya alternaba healthy/unhealthy antes del despliegue. A las11:33 UTC su endpoint devolvió503 con `CHATBY_MESSAGES_HTTP_404`, último ciclo completado11:31:07 UTC y resolución DISABLED; no fue reiniciado ni cambiado. La corrección de ese flujo queda fuera de esta autorización V8. El contraste Shopify→Dropea terminó, pero conserva bloqueos/rechazos previos; un exit code aceptado por systemd no se confunde con recuperación de esos pedidos.

## Verificación autenticada y activación completadas

`AGENTS.md` prohíbe «Never open, launch or control a web browser for this project». El propietario concedió expresamente una excepción limitada a verificar OAuth y vistas V8. Se usó la pestaña de Suleia y su login personal/SSO normal. No se crearon clientes, credenciales ni permisos para eludir el acceso. Una captura bloqueada por el navegador al detectar un origen externo se interrumpió; se comprobó la URL de la pestaña autorizada y la captura posterior de Suleia fue admitida. No se accedió al origen externo.

Se registró la comprobación autenticada a las13:21 UTC, después de verificar el informe exacto, los controles y las dos dimensiones. La activación a las13:22:03 UTC volvió a comprobar ventana segura, ausencia de operaciones inciertas/en ejecución y huellas de política/identidad. Estado final: flagtrue en API/bot, un receptor, NOT_DUE real, siguiente ejecución20:30 UTC/22:30 Madrid. El panel muestra «activada» y un destinatario. No se amplió la autorización de gasto.

El primer envío solo se considerará entregado cuando existan cuatro recibos reales `message_id` por destinatario y parte. Una reserva SENDING/UNKNOWN sin recibo requiere reconciliación y no se fuerza de nuevo.

## Correcciones detectadas al validar producción

La revisión867b3e0 corrige únicamente dos archivos de ejecución y añade cuatro casos de prueba. Primero se reprodujeron sus fallos; después pasaron14/14pruebas focalizadas y535/535del artefacto completo. Los19archivos presupuestarios protegidos, política efectiva y código del bot conservaron sus huellas.

1. `setView('ads')` reemplazaba el hash restaurado por `#ads` antes de leer sus parámetros. Ahora conserva el ID de informe/campaña, pestaña y periodo; al salir de Ads limpia ese hash. La prueba ejecuta el arranque completo, incluida la vuelta OAuth, y el recorrido real abrió la instantánea exacta después de SSO.
2. El generador aceptaba una instantánea STALE con diagnóstico ADS_REPORT_PREPARING mientras continuaba su actualización canónica. Ahora espera el mismo trabajo, con el límite de intentos/deadline existente y pausas acotadas; no crea otro lector ni debilita frescura. Errores definitivos conservan la evidencia histórica y bloquean recomendaciones actuales. El agotamiento del plazo guarda un informe explícitamente insuficiente.

La primera pulsación manual fallida fue401 por caducidad OAuth, sin error SQL ni reserva de informe; no se atribuye al generador. La renovación SSO y el POST autenticado posterior funcionaron. El informe previo insuficiente se conserva como auditoría. El nuevo informe `b87d5c2feac4aa2fafe1561b1b106df736dbc20961a831d14aa8d9cae9eaef00` se creó13:07:53 UTC y terminó13:09:30 UTC: READY/PARTIAL, cuatro partes de1515/1704/1376/2876caracteres, cero entregas y las cuatro fuentes FRESH:

| Fuente | Observación UTC |
| --- | --- |
| Hoy | 13:07:53 |
| Semana y anuncios | 13:08:11 |
| Mes | 13:08:33 |

[Abrir el informe verificado después de la reparación](https://mcp.suleia.com/operations/#ads?tab=reports&reportId=b87d5c2feac4aa2fafe1561b1b106df736dbc20961a831d14aa8d9cae9eaef00&section=overview). Su detalle autenticado confirmó estado, fecha, cuatro partes y «La auditoría manual no envía Telegram».

La reparación cambió API/panel; no reinició ni modificó el bot. Tras el corte se reconcilió un recibo de metadatos que no pudo escribir un archivo temporal protegido. Se verificaron primero imagen, montaje y hashes activos; se guardó el manifiesto en almacenamiento root privado sin repetir el despliegue ni desactivar la protección del sistema. La activación posterior reinició únicamente el servicio Telegram existente para cargar su flag.

Una comprobación de salud del bot coincidió con un estado transitorio. El reexamen confirmó un único proceso/lock, latido reciente correcto y, a las13:25:52 UTC, todas las postcondiciones del bot superadas. El scheduler ejecutivo ya había registrado NOT_DUE correctamente. No se oculta el muestreo fallido ni se presenta como un segundo consumidor.

## Copias y recuperación

Copias privadas verificadas: esquema con grants, datos de18 tablas Ads/auditoría, configuración de API/bot/servicio y estado persistente Telegram. La restauración de esquema y datos se completó en PostgreSQL17 aislado, sin red ni credenciales de producción, y sus conteos coincidieron. Se conservaron los artefactos antiguos y se verificó su existencia; no se ejecutó un corte real de rollback.

La ruta operativa de rollback restaura API `suleia-bot-autopilot-reliability:c259413`, panel `budget-autopilot-live-e4d3b9d` y bot `reliability-c259413`, desactiva el envío ejecutivo y retiene los estados persistidos actuales. Solo debe ejecutarse tras comprobar concurrencia y ventana segura. No se eliminan tablas059, recibos ni historial V5.1.

Los comprobantes completos permanecen en el almacenamiento privado del VPS. Se descartó su exportación general tras el rechazo automático de seguridad; este documento resume únicamente estados, versiones, conteos y huellas técnicas.

## Continuación: auditorías abiertas y tarea Shopify sin Codex

El propietario pidió mantener Shopify como tarea automatizada del servidor y retirar sus ejecuciones del chat. Se eliminó la automatización Codex `supervisar-recuperaci-n-shopify-dropea` mediante la herramienta de la aplicación; su eliminación quedó confirmada. No se creó otra tarea ni otro importador. El temporizador VPS `suleia-shopify-dropea-recovery.timer` conserva estado enabled/active, ejecución al minuto05 de cada hora y bloqueo contra solapamiento. La comprobación15:25 UTC encontró el informe completo15:05:39 UTC:235pedidos,215existentes,18bloqueados y dos rechazos de cobertura ya conocidos. La retirada de Codex no corrige esos bloqueos ni implica recuperaciones nuevas; la ejecución real sigue independiente del PC.

La continuación V8 resolvió el defecto pendiente del refresco periódico. El arranque autenticado programa una actualización cada45segundos; su cargador sustituía el contenedor Ads y eliminaba la auditoría modal abierta. Una nueva prueba ejecuta el arranque y su callback real: con el código anterior, dos ticks sustituyeron la auditoría; la aserción falló. Ahora solo el refresco de fondo de Ads se aplaza mientras existe un diálogo abierto. Al cerrarlo, el siguiente tick normal reanuda la carga. La actualización explícita conserva su comportamiento; se mantienen el corte visible de la instantánea, las rutas de otras secciones y el horario existente.

Validación: **45/45pruebas del panel**, sin omitidas; tres pruebas de arranque autenticado también pasaron en el artefacto Linux Node22.22 aislado, sin red ni credenciales. La actualización e231c06 se aplicó a las15:34:18 UTC mediante un nuevo montaje inmutable que conserva todos los archivos anteriores salvo app.js. La validación previa detectó una ruta de paquete incorrecta y permisos insuficientes del directorio de pruebas sintéticas; ambos se corrigieron antes de cambiar el montaje activo. No se debilitó el almacenamiento privado.

La actualización sustituyó únicamente el contenedor estático del panel. API y todos los demás contenedores conservaron sus IDs; Telegram conservó PID y configuración. Los19archivos presupuestarios protegidos mantuvieron sus hashes. HTTPS verificó el hash servido de app.js, los demás módulos V8 y salud. El reexamen15:35 UTC confirmó43fuentes y14assets exactos, seis accesos no autorizados bloqueados, API y bot saludables, un consumidor y flag ejecutivo activado. La validación personal OAuth/desktop/móvil anterior sigue documentada arriba; esta corrección se comprobó con la regresión de arranque, el artefacto Linux y los recursos realmente servidos, sin repetir acceso interactivo ni enviar mensajes.

Recibo privado: `/root/suleia-panel-refresh-e231c06/verified.json`. Conserva copias del override y manifiestos previos; el panel `/opt/suleia-panel-releases/ads-v8-867b3e0` permanece disponible para restaurar exclusivamente su montaje. API, bot, permisos, destinatario y reglas V5.1 no se modificaron. La primera entrega ejecutiva de las22:30 continúa pendiente de sus cuatro recibos reales.

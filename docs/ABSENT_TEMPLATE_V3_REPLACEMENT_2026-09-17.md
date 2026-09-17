# Sustitución AUSENTE GLS — 17/09/2026

## Alcance y autorización

El propietario autoriza implementar la nueva plantilla, remitirla a Meta para
aprobación y deshabilitar la versión reciente anterior. No autoriza enviar
mensajes de prueba a clientes ni activar AUSENTE LIVE: este subsistema conserva
SHADOW, cero acciones operativas y los plazos de la política vigente.
Descuentos/devoluciones por rechazo, confirmación/cancelación y finanzas no cambian.

## Texto, nombre y payload definitivo

Nombre: `dropea_ausente_v3`; idioma `es_ES`; categoría propuesta `UTILITY`.
Se reserva v2 para la ruta histórica de conflicto de la implementación anterior;
no se sobrescribe ni reutiliza una versión con contenido diferente.
`{{1}}` es el nombre del cliente y `{{2}}` la referencia de SU pedido.
Los ejemplos son sintéticos, no datos de clientes.

```text
👋 Hola, {{1}}

📦 *Queremos que recibas tu pedido cuanto antes*

GLS nos ha avisado de que hoy no ha podido entregarte tu pedido *{{2}}*, ya que no había nadie disponible en ese momento.

No te preocupes 💚 *tu pedido sigue en camino* y podemos organizar un nuevo intento de entrega.

✨ *¿Cuándo te viene mejor recibirlo?*
```

El payload JSON exacto está en `recipient-absent-template-v3-payload.json`.
Es el objeto entregado sin transformación a `POST /whatsapp-template/create`.
Los IDs de respuesta se asignan en los componentes QUICK_REPLY del futuro envío;
Meta no acepta añadir un `payload` arbitrario al botón de creación del catálogo.
La preparación SHADOW exporta la relación explícita índice/ID/texto. No se ejecuta
el futuro envío ni se instala un flujo Chatby ejecutable durante esta sustitución.

## Restricciones verificadas y alternativa

La [API oficial Chatby](https://app.chatby.io/api-docs) documenta creación/listado/
sincronización/eliminación, pero no una operación de pausa/desactivación.
El contrato `WhatsappTemplate` exige name, language, category y components,
y remite al [contrato de componentes Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components).
El catálogo real confirmó la plantilla antigua y sus cuatro QUICK_REPLY.
No se confunde capacidad de crear cuatro botones con mostrarlos todos directamente.
La documentación oficial del proveedor [Clickatell](https://help.clickatell.com/whatsapp/channel-capabilities/whatsapp-message-templates/use-interactive-buttons-in-message-templates)
explica el límite visual: más de tres botones muestra dos y «See all options».
Las etiquetas de plantilla admiten como máximo 25 caracteres; las respuestas
interactivas de sesión preparadas aquí no superan 20. Se usa el criterio
conservador UTF-16 y NFC, que también cubre los emojis astrales.

La validación real de creación respondió HTTP400 tres veces, sin crear registro,
con `Invalid parameter Los botones no pueden tener variables, saltos de línea,
emojis ni caracteres con formato`. Por eso los botones de plantilla definitivos
no llevan emojis. La causa se comunicó antes de modificar/remitir el payload.
El cuerpo conserva exactamente 👋, 📦, 💚 y ✨. Los emojis ☀️/🌙 se mantienen en
las etiquetas semánticas internas y 📅/🏠 en subflujos de sesión solo preparados;
no se afirma que los ocho puedan incluirse en botones de una plantilla aprobada.
Los subflujos de sesión requieren validación del sender antes de LIVE, no se envían
para probar una compatibilidad no verificada.

Los cuatro botones originales no pueden garantizarse visibles sin menú en este
formato. Alternativa mínima: tres botones visibles, con mañana mañana y mañana
tarde en un clic. «Otro día o datos» prepara dos botones de sesión, y las opciones
secundarias requieren dos clics. No se crea el menú automático de WhatsApp.
«🏠 Cambiar datos de entrega» supera 25 caracteres y se acorta conservando 🏠.
No se eliminan emojis del cuerpo ni se oculta la incompatibilidad real del botón.

| Lugar | Texto definitivo | ID estable |
|---|---|---|
| Plantilla, índice 0 | Mañana por la mañana | ABSENT_TOMORROW_MORNING |
| Plantilla, índice 1 | Mañana por la tarde | ABSENT_TOMORROW_AFTERNOON |
| Plantilla, índice 2 | Otro día o datos | ABSENT_MORE_OPTIONS |
| Respuesta preparada | 📅 Elegir otro día | ABSENT_OTHER_DAY |
| Respuesta preparada | 🏠 Cambiar datos | ABSENT_CHANGE_DELIVERY_DATA |

Se conservan los aliases históricos ABSENT_TOMORROW_AM, ABSENT_TOMORROW_PM,
ABSENT_OTHER_SLOT y ABSENT_PICKUP_AGENCY; no cambian los eventos almacenados.
Las notificaciones históricas y las nativas se siguen reconociendo como anclas
de evidencia, no como reglas de envío.

## Evidencia, correlación y solución concreta

Solo eventos INBOUND de pedido/incidencia exactos, posteriores a la notificación,
no futuros y con lectura Chatby vigente pueden sustentar la evidencia operativa.
La simulación con ancla de creación sin notificación continúa explícitamente
etiquetada como SHADOW y no demuestra un aviso o respuesta notificada.
«CONFIRMAR MI PEDIDO» queda excluido incluso sin slug de plantilla.

La selección prepara order_id, issue_id, conversation_hash, customer_hash,
selection_event_hash, selected_at y notification_at. Una respuesta posterior
de fecha/datos exige el mismo pedido, incidencia, conversación y cliente que la
selección. Identidad ausente/incompatible bloquea; nunca se utiliza el teléfono
como sustituto de correlación. El dato de dirección reutiliza el parser existente,
no inventa campos y no se guarda texto personal en snapshots públicos.
Elegir una fecha sin horario conserva DATE_ONLY, no inventa disponibilidad ALL_DAY.

El panel muestra «Cliente actuó», texto REAL de la respuesta y su timestamp solo
para evidencia vigente ligada a snapshot/notificación. La solución concreta:

- Mañana mañana/tarde: proponer la fecha/franja calculada desde el timestamp local
  Madrid del mensaje, sin garantizar aceptación logística.
- Otro día: «Esperando selección de fecha del cliente».
- Cambiar datos: «Esperando nuevos datos de entrega».
- Otro día o datos: «Esperando elección: otro día o cambiar datos de entrega».

Las limitaciones reales de calendario/corte GLS, custodia, capacidad y fuentes
se mantienen como bloqueos. Una respuesta de recuperación no se convierte en
silencio ni en devolución. El único timer 48 h y los históricos no se cancelan,
extienden o reescriben. La aprobación no concede permisos de ejecución.

Idempotencia: el mismo ID/contenido se deduplica y genera igual snapshot/decisión.
Colisiones de un ID con distinto contenido o dos franjas incompatibles simultáneas
bloquean. La última respuesta posterior válida sustituye la anterior conservando
historia técnica; un mensaje posterior ambiguo/cancelación sigue bloqueando o
supersediendo conforme a la política existente.

## Retirada de la anterior

`dropea_ausente_v1` (Chatby 1549385, Meta 1490544536242876) y el alias reservado v2
están retirados de la selección futura de Suleia. La única versión seleccionada
es v3. Los flags de envío continúan false para todas.
La plantilla antigua NO se elimina de Chatby/Meta: el proveedor no documenta
desactivación reversible y borrar no equivale a deshabilitar. No se afirma una
pausa global en el proveedor; todavía podría estar disponible para envío manual
externo a Suleia. No se borra su aprobación ni su historial.
La plantilla nativa `dropea_incidencia_ausente_v2` y otros flujos no se modifican.

## Archivos modificados

- packages/platform-core/src/incident/{absent-template,recipient-absent-policy,absent-decision,notification-evidence}.mjs
- packages/platform-core/test/{absent-template-v3,recipient-absent-policy}.test.mjs
- packages/suleia-operations-mcp/src/operations/incident-insight.mjs
- services/integrations/chatby/{absent-template-admin,readonly-sync}.mjs y pruebas administrativas
- services/{incident-simulation-sync,shadow-readonly-worker}.mjs y prueba de sync
- infrastructure/vps/absent-integrity-deploy.test.mjs y helper de sustitución limitada
- docs/recipient-absent-template-v3-{payload,approval}.json y este informe

## Pruebas, publicación y estado externo

Suite completa local: 707/707 PASS. Incluye regresión financiera, confirmación,
cancelación, otras incidencias, Dropea, GLS, Chatby y panel. 10 escenarios mínimos,
casos adicionales de identidad/colisión/cambio de opción y una lectura integrada
de notificación v3/callback/duplicado pasan. Payload JSON idéntico al objeto de
creación; UTF-8/NFC/negrita/límites verificados. Validación real externa creó una
única plantilla y comprobó su body/botones de vuelta en el catálogo.

Estado observado 2026-09-17T18:31:45.775Z: PENDING, categoría UTILITY; Chatby
1552419, Meta 1123671516755556. Enviada a aprobación, NO aprobada aún.
Hub claim: 5719137138. Pendiente de registrar despliegue/verificación final.
Las 10 simulaciones mínimas y los casos adicionales están en
`packages/platform-core/test/absent-template-v3.test.mjs`; ninguna envía mensajes.
La retirada histórica no afirma que el proveedor haya borrado/pausado el registro.
Se conserva el registro operativo V1 y su checksum/timer inmutable. La sustitución
de presentación se vincula por separado al snapshot con nombre v3, body_hash y
mapping_hash: no se altera retrospectivamente el documento/checksum histórico V1
que describía v1 ni se crea una nueva ventana de respuesta por cambiar de texto.

## Pendiente antes de LIVE

Aprobación real de contenido exacto; autorización separada de AUSENTE LIVE;
sender/subflujos gobernados, payloads de callback vinculados al caso, validación
de custodia/capacidad/calendario GLS, exclusión de otros propietarios de envío,
idempotencia persistente y verificación posterior de cada acción. No se activan
sender ni flujos externos como efecto secundario de una aprobación.

Acciones operativas externas durante esta sustitución: actions_executed=0,
production_writes=0, customer_messages_sent=0, Dropea/GLS writes=0.
La única escritura externa autorizada es la administración de la nueva plantilla
para su aprobación; se registra aparte, nunca como escritura de pedidos/clientes.

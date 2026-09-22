# Resolución de AUSENTE según la respuesta

La función canónica `buildRecipientAbsentResolution` genera la nota en backend,
su representación estructurada, bloqueos y clave de idempotencia. El teléfono
solo se extrae del GET del pedido exacto, comprobando también la tienda. Se
normaliza sin inventar país: un número local español necesita país ES explícito
en la dirección de ese pedido. La auditoría conserva un HMAC del teléfono.

`selectRecipientAbsentIntent` exige aviso observado, historia completa, mensaje
posterior, identidad de pedido/incidencia/contacto/conversación y última respuesta.
Una respuesta ambigua posterior bloquea la anterior. Una corrección de franja
puede heredar la fecha de la preferencia inequívoca anterior de esa conversación.
Las fechas se resuelven desde el mensaje en Europe/Madrid; la ejecución rechaza
fechas pasadas y datos de más de 15 segundos.

El contrato oficial incluido en el repositorio admite `PROVIDE_SOLUTION` mediante
`POST /dropshipper/issues/{id}/resolve`, con `status=RESOLVED`,
`resolution_status=SOLUTION_PROVIDED`, `resolution_note` de hasta 500 caracteres
y sin `resolution_data`. No se usa RETRY ni se inventan campos de franja. Solo se
admite GLS ES si el GET de la incidencia ofrece esa opción. Presentar la nota no
garantiza que el transportista haya reservado o vaya a cumplir la franja.

La nota es request-only: Dropea no devuelve su texto. Se verifica la aceptación
de la transición con la respuesta del POST y un GET independiente de la misma
incidencia/pedido, incluido `resolution_changed_at`. El hash de la nota exacta
enviada queda en el registro local. Un timeout, respuesta ambigua o verificación
fallida conserva la reserva y requiere conciliación; no se repite el POST.

## Proceso y activación

`services/recipient-absent-resolution-worker.mjs` es un proceso independiente.
No se ejecuta desde el worker de solo lectura. Necesita:

- `AUSENTE_AUTOMATION_LIVE=true` y `AUSENTE_LOGISTICS_WRITES_ENABLED=true`.
- `AUSENTE_DROPEA_WRITE_TOKEN`, con `dp:issues:resolve`, en el gestor de secretos.
- `ABSENT_RESOLUTION_DATABASE_URL`, `MIGRATION_HASH_KEY`, `CHATBY_TOKEN` y la
  configuración existente de una única tienda ES y sus credenciales de lectura.
- Migración 042 aplicada y controles persistidos de activación verificados.

La migración crea el control en DISABLED. El worker no puede habilitarlo: solo
puede reservar la plaza de canary. Se mantienen las condiciones del documento
anterior del propietario: mapeo inequívoco de v3, un solo emisor, callback y timer
verificados, solo incidencias nuevas desde `activation_at` y un primer canary.
Para pasar de CANARY a LIVE debe existir evidencia de canary verificado. Las
flags por sí solas no autorizan escrituras ni recuperación de histórico.

La clave funcional es issue + response + resolution hash; existe además una
restricción única por incidencia, porque Dropea solo admite una transición desde
PENDING. El bloqueo en PostgreSQL serializa procesos y la reserva de canary es
transaccional. Se persiste la reserva antes del POST y se consulta el kill switch
otra vez justo antes. El audit no incluye la nota ni el teléfono completo.

## Panel y rollback

El panel muestra fecha, franja, fuente, teléfono enmascarado y motivo legible de
revisión. Solo un registro APPLIED muestra «Solución aportada». No se toma la
simulación como prueba de ejecución.

Para detener escrituras: cambiar el control persistente a DISABLED y detener el
proceso dedicado. Restaurar las imágenes anteriores si procede. Conservar las
tablas de reservas/auditoría y sus datos; no borrar evidencias al hacer rollback.
La entrega de plantillas nativas, devoluciones, descuentos y confirmaciones no
forman parte de este nuevo escritor.

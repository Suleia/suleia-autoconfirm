# Meta Budget Autopilot V5.1 — activación LIVE autorizada

El propietario autorizó el 22 de octubre de 2026 el despliegue, el primer cambio
real controlado y la ejecución automática posterior. Este documento sustituye
los requisitos pendientes de la entrega SHADOW de la PR #133. El estado real se
registra en el Agent Hub y en el recibo de despliegue; este archivo no constituye
prueba de una modificación financiera.

## Verificación del despliegue

Activado el 22 de octubre a las 12:58 de Madrid. API saludable en
`suleia-budget-autopilot-live-api:e4d3b9d`, código
`e4d3b9d230b218cc79f8e71b49593128ec9d9c74`; PR #134 apilada sobre #133.
El commit 6d50526 corrige únicamente el alcance de una aserción de integración.
Node 22/Linux: 375 pruebas, 374 pasan, cero fallos y una integración opcional
omitida; PostgreSQL 17 aislado: 1/1 pasa después de esa corrección. Los contenedores
de prueba no recibieron credenciales, datos productivos, red ni puertos públicos.

Los 46 archivos de base se contrastaron antes del overlay. Nueve campañas
aceptaron la validación de 15 EUR con lectura posterior del presupuesto sin cambios.
LIVE tiene scheduler y ejecutor compartido habilitados, legacy Meta writes apagado,
política exacta y nueve recibos vigentes. Ambos administradores obtienen estado
firmado 200; usuario desconocido y cruce de chat reciben 403. Reglas nativas: cero.
Panel servido contrastado por hash; bot único con bloqueo igual a MainPID y modo
SHARED_CONFIRMED_BUDGETS. Token, administradores, estado y contenedores ajenos
conservados. Informes automáticos Autopilot apagados.

La revisión natural `2026-10-22:13:00` está COMPLETE, executionState BLOCKED,
externalWrites=0. Las nueve campañas quedaron bloqueadas por sus datos/protecciones
(incluidos aprendizaje activo, cambios recientes y muestra insuficiente).
No hubo asignación financiera: CANARY_PENDING. El primer cambio elegible sigue
limitado a un intento y debe verificarse antes de liberar lotes posteriores.
Esta observación no verifica una escritura financiera ni garantiza cambios en cada
horario. Los bloqueos externos no se han eliminado para fabricar una prueba.

Recibo y rollback privados:
`/root/suleia-budget-live-e4d3b9d/{receipt.json,minimums.json,verification.json,postconditions.json}`;
runner `/tmp/live-deploy.py rollback`, con destino SHADOW 5177e53 y conservación de
auditoría/offset. Debe comprobarse el estado fresco antes de usarlo. No hay otra
intervención o despliegue en curso tras este cierre.

## Política aprobada

- Pasos de +10/−10 EUR; máximo 70 EUR por campaña y mínimo operativo 15 EUR.
- Máximo global de presupuestos diarios configurados: 1.000 EUR.
- Sin techo adicional de gasto observado, expresamente autorizado. El gasto
  sigue exigiendo lectura completa y fresca; desconocido nunca equivale a cero.
- Subidas: ROAS >3,8, tres compras y tres compras nuevas después de cada subida;
  se conserva el límite de +30 EUR de incrementos acumulados por día.
- Reducciones por ROAS <3,8 a las 12:00/19:00: gasto >=15 EUR, >=1.000 impresiones
  y >=120 minutos desde medianoche de Madrid o el último cambio, el posterior.
- Horarios de Madrid de V5.1; techos nocturnos progresivos de 25/20 EUR y ninguna
  subida nocturna. No se recuperan horarios pasados.
- Los cambios propios verificados pueden superar la antigua espera de 72 horas,
  el máximo de un cambio diario y la política de 10 %/24 horas/cinco compras.
  Cambios externos, aprendizaje activo y evidencia incompleta siguen bloqueando.

## Seguridad y evidencia

El mismo ejecutor financiero y bloqueo de cuenta atienden bot y scheduler.
Una reserva persistente precede cada asignación absoluta; no se reintenta ningún
POST incierto. La lectura posterior debe confirmar cuenta, campaña e importe.
El primer lote LIVE permite solo un intento elegible; los demás esperan al lote
siguiente. Solo un resultado VERIFIED con respuesta exitosa habilita los demás
lotes. FAILED/UNKNOWN/EXECUTING/RECONCILED bloquean hasta revisión, aun si hubo un
éxito anterior. La aprobación identifica de forma estable el conjunto de pruebas.

El transporte valida cada objetivo con `execution_options=["validate_only"]`
antes de la única asignación. Para el mínimo operativo se valida 15 EUR por
campaña y se comprueba que su presupuesto no cambió. Esto prueba aceptación del
punto autorizado, no el mínimo matemático de todas las categorías de Meta.
Los recibos duran 24 horas; el servicio renueva los vencidos sin asignar importes.
Contrato primario: [SDK oficial de Meta, Campaign.api_update](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py).

La protección de aprendizaje utiliza el lector canónico y siete días completos,
sin consultas de contactos ni clientes. Solo eventos exactos de presupuesto con
cuenta/importes/tiempos compatibles con la auditoría propia pueden exceptuarse.
Los informes automáticos nuevos de Telegram permanecen apagados.

## Despliegue y rollback

Publicar revisión intencional, ejecutar pruebas Node 22/Linux y PostgreSQL aislado,
construir una imagen superpuesta a la imagen SHADOW 5177e53 y copiar solamente el
asset modificado del panel. Conservar el bot existente y sus dos administradores.
Arrancar el candidato en SHADOW sin scheduler; obtener recibos de mínimo, verificar
reglas nativas, roles y límites. Activar LIVE/scheduler únicamente después.

Conservar un recibo privado de ajustes no secretos e imagen/panel previos.
Rollback restaura la imagen SHADOW 5177e53 y solo las opciones modificadas, detiene
las escrituras compartidas y conserva auditoría, reservas inciertas y offset del
bot. Nunca restaurar una copia antigua del estado ni repetir horarios/presupuestos.
Tras activar: comprobar API saludable, bot único, acceso firmado de ambos actores,
límites exactos, mínimos vinculados y estado CANARY_PENDING/CANARY_VERIFIED visible.
Si no hay campaña elegible, mantener CANARY_PENDING sin forzar un cambio de prueba.

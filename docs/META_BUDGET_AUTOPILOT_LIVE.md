# Meta Budget Autopilot V5.1 — activación LIVE autorizada

El propietario autorizó el 22 de octubre de 2026 el despliegue, el primer cambio
real controlado y la ejecución automática posterior. Este documento sustituye
los requisitos pendientes de la entrega SHADOW de la PR #133. El estado real se
registra en el Agent Hub y en el recibo de despliegue; este archivo no constituye
prueba de una modificación financiera.

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

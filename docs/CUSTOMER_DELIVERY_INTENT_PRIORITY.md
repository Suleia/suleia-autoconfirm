# Intención del cliente y nueva entrega

Corrección autorizada por el propietario el 22/10/2026. El estado del transportista
selecciona el contexto logístico; nunca demuestra por sí solo que el cliente quiera
rechazar, cancelar o devolver. Se conservan `provider_raw_type` y la intención del
cliente por separado.

El mensaje válido más reciente del pedido exacto prevalece sobre mensajes previos
y etiquetas del transportista. «Sigo esperando», «no me ha llegado», «quiero
recibirlo» y preguntas inequívocas sobre la entrega expresan `WANTS_ORDER` y
`WAITING_FOR_ORDER`. Una afirmación explícita de que nadie acudió añade
`DELIVERY_NOT_ATTEMPTED_ACCORDING_TO_CUSTOMER`. No recibir un paquete no demuestra
por sí solo que nadie haya intentado entregarlo.

El intérprete común prepara `REQUESTS_REDELIVERY`; para una incidencia pendiente
con capacidad `PROVIDE_SOLUTION`, prepara `PROVIDE_SOLUTION_NEW_DELIVERY` con una
nota profesional solicitando nueva entrega. Fechas, horarios, dirección, agencia
y condiciones económicas siguen sus rutas existentes y no se eliminan. Si el
contrato exige RETRY, se conserva el slot y la evidencia real requeridos.

Una hora literal válida puede conservarse en la nota de PROVIDE_SOLUTION aunque
no determine una franja estructurada. Por ejemplo, una hora de doce horas sin
AM/PM no se convierte a otra hora por suposición. Se conserva el texto indicado,
se validan fechas futuras y horas/minutos, y se bloquean opciones contradictorias
o fechas vencidas. Esta regla no relaja el contrato estructurado de RETRY.

Una cancelación o contradicción posterior bloquea la nueva entrega. Una queja
neutra no revive una cancelación anterior; una respuesta posterior explícita de
que sigue esperando o quiere recibirlo sí puede renovar la instrucción. Saludos
no borran una respuesta válida. Códigos del transportista no crean intención.

El worker mantiene la asociación fresca a pedido/conversación, la espera existente
de una hora, ventana de texto, lectura final, registro duradero y un solo intento.
La nota exacta debe verificarse en Dropea; una respuesta HTTP no basta. Cuando se
necesita imagen se utiliza exclusivamente la conversación real del caso mediante
el capturador existente, sin fabricar evidencia ni reutilizar otra conversación.

Las soluciones verificadas entran en el seguimiento ya existente junto a los
reintentos. `AWAITING_NEW_DELIVERY` y `commerciallyClosed=false` se mantienen aunque
Dropea marque la incidencia resuelta. Solo la lectura del pedido entregado cuenta
como entrega; devoluciones, cancelaciones y nuevas incidencias conservan su estado
separado. No se añade otro worker ni se altera el ciclo de 30 minutos.

La regla no modifica importes, descuentos, plantillas, campañas ni la confirmación
de pedidos. Los casos de regresión son sintéticos y no contienen conversaciones
ni contactos reales. El Agent Hub conserva las revisiones desplegadas y las
postcondiciones; este documento describe el contrato de comportamiento.

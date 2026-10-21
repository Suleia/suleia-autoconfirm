# Política de descuento de incidencia de 5 EUR

## Estado

- La política está implementada y probada.
- El envío real depende de la autorización del propietario y de las compuertas
  de cada tipo de incidencia. Este documento no acredita el estado del servidor.
- El endpoint privado de prueba solo permite un envío explícitamente
  autorizado y usa el registro persistente anti-duplicados.

## Elegibilidad automática para mercancía rechazada

Un pedido solo será elegible si se cumplen simultáneamente estas condiciones:

1. La incidencia logística vigente indica que la mercancía no fue aceptada.
2. Chatby confirma mediante un `wamid` que se entregó
   `dropea_incidencia_mercancia_v1`.
3. Han transcurrido al menos 24 horas desde ese envío verificado. Una incidencia
   posterior del mismo pedido usa la más reciente de ambas fechas como ancla.
4. No existe ningún mensaje, botón ni otra interacción del cliente posterior.
5. La conversación pertenece al pedido actual.
6. No existe un envío previo de la plantilla de descuento para el mismo
   pedido.
7. Shopify y Dropea identifican de forma compatible el pedido y sus datos.

Si falta una evidencia o existe una contradicción, no se envía nada.

## Dirección incorrecta sin respuesta

La oferta vence 24 horas después de la plantilla de dirección verificada de la
incidencia actual. Si un ciclo no pudo enviarla, sigue pendiente aunque hayan
pasado 48 horas; no se sustituye por una devolución por silencio. Tras una oferta
verificada, la propuesta de devolución debe esperar la más tardía de estas
fechas: 48 horas desde el aviso inicial o 24 horas desde la oferta real.

Una respuesta, cancelación, dirección incompleta o aceptación del descuento
conserva su flujo específico. Las compuertas y bloqueos independientes de
devolución no se habilitan por esta regla. No se reenvían ofertas ya registradas.

## Campos dinámicos

- `BODY_1`: primer nombre del cliente obtenido del pedido actual.
- `BODY_2`: productos del pedido actual.
- `BODY_3`: total de Shopify menos 5 EUR, con formato monetario español.

El descuento máximo es 5 EUR. El motor rechaza cualquier valor superior.

## Respuestas y panel

La sección `Descuentos` del Command Center clasifica:

- `DISCOUNT_ACCEPTED`: botón `Quiero el descuento`.
- `DISCOUNT_REJECTED`: botón `No quiero el pedido`.
- `NO_RESPONSE`: ninguna interacción posterior.
- `OTHER_RESPONSE`: respuesta distinta que requiere revisión.

El envío de la plantilla no aplica todavía el descuento ni modifica el pedido.
Esa acción requiere una política operativa independiente y autorización
explícita.

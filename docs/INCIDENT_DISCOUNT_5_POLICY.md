# Política de descuento de incidencia de 5 EUR

## Estado

- La política está implementada y probada.
- El envío automático permanece desactivado hasta la aprobación expresa del
  propietario.
- El endpoint privado de prueba solo permite un envío explícitamente
  autorizado y usa el registro persistente anti-duplicados.

## Elegibilidad automática futura

Un pedido solo será elegible si se cumplen simultáneamente estas condiciones:

1. La incidencia logística vigente indica que la mercancía no fue aceptada.
2. Chatby confirma mediante un `wamid` que se entregó
   `dropea_incidencia_mercancia_v1`.
3. Han transcurrido al menos cuatro horas desde ese envío verificado.
4. No existe ningún mensaje, botón ni otra interacción del cliente posterior.
5. La conversación pertenece al pedido actual.
6. No existe un envío previo de la plantilla de descuento para el mismo
   pedido.
7. Shopify y Dropea identifican de forma compatible el pedido y sus datos.

Si falta una evidencia o existe una contradicción, no se envía nada.

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

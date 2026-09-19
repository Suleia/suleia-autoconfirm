# Política de descuento de incidencia de 5 EUR

## Estado

- La política está implementada y probada.
- El envío automático gobernado de Render permanece activo con los permisos
  ya autorizados. El nuevo Incident Autopilot solo lo observa en SHADOW y no
  se convierte en un segundo emisor.
- La fuente canónica de tiempos y ownership es
  `autoconfirm/data/incident-policy.json`.

## Elegibilidad automática futura

Un pedido solo será elegible si se cumplen simultáneamente estas condiciones:

1. La incidencia logística vigente indica que la mercancía no fue aceptada.
2. Chatby confirma mediante un `wamid` que se entregó
   `dropea_incidencia_mercancia_v1`.
3. Han transcurrido al menos 24 horas desde ese envío verificado.
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

El envío de la plantilla no aplica por sí solo el descuento. La aplicación y
la devolución siguen en el automatismo de Render ya autorizado, con relectura
de contexto e idempotencia. El Autopilot nuevo registra la decisión en sombra
hasta que se autorice un cambio explícito de ownership.

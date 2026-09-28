# Estado vigente: copia exacta de parches_glp

28/09/2026. El propietario rechaza el rediseño previo y solicita una copia literal de `parches_glp`, manteniendo el producto Crema Seoul 1988 y usando el nombre `seoul_1988`.

## Ejecutado

- Lectura fresca de `templates/product.parches_glp.json` en MAIN 198240600396.
- Copia de todas las secciones, bloques, contenido y ajustes, sin cambios, a `templates/product.neriva_nad.json` y `templates/product.seoul_1988.json` en el tema no publicado 206684094796.
- Ambos destinos cotejados por lectura independiente: su JSON es idéntico al origen. Shopify normaliza comentarios/formato al guardarlo; el contenido estructurado es exactamente igual.
- SHA256 del JSON canónico del origen y ambos destinos: `04b8204aa6fc479fcc2691ccd94c8d307224272fb3f629e405c78470b56be7f1`.
- Checksum Shopify de `parches_glp` antes y después: `68898fbee06694ed6f839442c5b833dd`, sin cambios tanto en MAIN como en el borrador.
- Theme Check de `product.seoul_1988.json`: SUCCESS.
- Producto 16138510991692, Crema Seoul 1988, sigue ACTIVE y queda asociado a `seoul_1988`. No se cambian precios, descuentos, estado, inventario ni publicaciones.

La copia es literal: conserva también el contenido estático de NIDA y sus ajustes de ofertas. No se presenta como copy adaptado a SEOUL ni se alteran automáticamente los descuentos para hacerlos coincidir. Título y medios dinámicos siguen correspondiendo al producto que se previsualiza.

[Vista previa de seoul_1988 con Crema Seoul 1988](https://suleia.com/products/crema-seoul-1988?preview_theme_id=206684094796&view=seoul_1988).

## Completado en el tema publicado

El propietario autorizó expresamente completar este cambio mediante Shopify Admin y amplió la excepción de navegador para este alcance. Se creó `seoul_1988` mediante «Create template», basada en `parches_glp`, en MAIN 198240600396. No se publicó otro tema.

Verificación posterior independiente mediante API:

1. MAIN contiene `templates/product.seoul_1988.json` con checksum `68898fbee06694ed6f839442c5b833dd`, idéntico al origen, incluido su formato.
2. `parches_glp` conserva su checksum original. El antiguo archivo `neriva_nad` de MAIN también permanece intacto.
3. Tras guardar la ficha de producto en Shopify Admin, la API confirma `template_suffix: seoul_1988` y estado ACTIVE. La ficha muestra esa selección guardada y publicación en Tienda online.
4. MAIN sigue siendo 198240600396. Captura local: `shopify-theme-work/seoul-exact-copy/shopify-assigned.png`.

[Página del producto](https://suleia.com/products/crema-seoul-1988).

Archivo local preparado: `shopify-theme-work/seoul-exact-copy/product.seoul_1988.json` desde la raíz compartida del workspace. Respaldo, informes antes/después y validación están en esa misma carpeta, fuera de Git. La copia literal incluye contenido de reseñas del origen; no se incorpora ese contenido personal al repositorio. Solo se versiona este registro sin datos personales.

El diseño previo y sus capturas permanecen en el historial como evidencia histórica, no como implementación vigente. Sus assets/secciones quedan sin referencia desde los dos templates copiados; no afectan a la copia ni a parches_glp.

# CollaGum: duración orientativa en los tres packs

El propietario autoriza expresamente modificar el selector de CollaGum en el tema MAIN **198240600396**, producto **15849234071884**, variante **57911544578380** y plantilla `product.collagum`. Solo se modifican `snippets/quantity-breaks.liquid` y cinco textos comerciales dentro del bloque `quantity_selector` de `templates/product.collagum.json`. No se publica otro tema ni se crea una nueva plantilla de pruebas.

El selector conserva cantidades, radios, enlace de formulario, actualización nativa de precios y descuentos, pack 2 predeterminado e imágenes transparent-v2 aprobadas. Sustituye las tres listas por calendario SVG y **Hasta 2/4/6 meses de uso**, con una nota única que aclara la estimación de un cepillado diario. Pack 2 azul **RECOMENDADO**, pack 3 verde **MEJOR PRECIO POR UNIDAD**, ahorro rosa y fondo blanco/azul claro. No se alega una posición de ventas sin datos.

El hash antiguo citado por el propietario ya había cambiado con NIDA. La fusión parte del snippet vigente **ee2e1037f1fdc6cac71ea565b30d0560**. El constructor prueba que todos los bytes fuera de las condiciones CollaGum, todos los inputs, scripts y bloques de cálculo Liquid siguen idénticos. La plantilla conserva todos los objetos salvo cinco textos: elimina el distintivo de pack 1, cambia tres subtítulos y sustituye MÁS VENDIDO por RECOMENDADO. Los otros bloques, incluida la prueba social, se conservan íntegros.

## Copia de seguridad y publicación

Copia completa local del tema realizada el **28/10/2026 17:27:46 UTC**, 381 archivos; manifiestos idénticos antes/después de extraer, ZIP probado y cada archivo releído por SHA-256. SHA-256 del archivo: `0a68581091a9fb245a0f336f6ccde3babb637329c1b0991fc1a62b8cd4222b09`. Los originales exactos, ZIP completo y datos privados quedan fuera de Git. La solicitud nativa de duplicación devolvió newTheme null y ningún tema nuevo se confirmó: no se presenta como una copia nativa creada.

El conector no permite escribir en MAIN. La publicación autorizada utiliza la API nativa Shopify con credenciales existentes en almacenamiento local, sin imprimirlas. `deploy.py` exige aprobación, copia completa, validación y pruebas; vuelve a comparar el manifiesto completo y los contenidos originales, rechaza cambios concurrentes, escribe solo los dos archivos con journal previo y readback del hash, y verifica producto/variante/precio base y los otros 379 archivos. No se ejecuta desde CI. No se reenvía una escritura incierta ni se reutiliza un journal. `--rollback` comprueba los dos archivos; `--rollback --execute` restaura solo versiones reconocidas y verifica el contenido, conservando cualquier cambio ajeno.

Los scripts se ejecutan desde el directorio local de evidencia preparado `shopify-theme-work/collagum-packs-production-20261028`, que contiene el backup privado y las lecturas. `shop_api.py` reutiliza el helper local `shopify_web_tools.py`, las credenciales existentes y la versión fijada **2026-04**. El modo predeterminado de `deploy.py` es lectura; la escritura exige `--execute`.

## Pruebas previas

- Validador oficial Shopify: ningún error en los dos archivos; advertencia de complejidad del snippet compartido, ya existente. Fue necesario usar la copia byte a byte del validador junto a las dependencias Shopify instaladas porque el paquete del plugin no las incluía.
- Carrito nativo anónimo aislado: 1/2/3 unidades **24,99/29,99/34,99 EUR**, descuentos **5/29,99/54,98 EUR**, una asignación por línea y ninguna promoción de carrito duplicada. Cambios 1→2→3→2→1 correctos, carrito vaciado, cero pedidos y ningún checkout enviado.
- Simulación local de composición sobre HTML real de MAIN, sin scripts ni POST, en **320/375/390/430/1440 px**. No hay desplazamiento horizontal ni etiquetas sobre precios; fotos `contain` con dimensiones originales conservadas. Alturas del selector antes→después: **492,11→440,80; 447,42→439,92; 447,42→439,92; 495,41→487,92; 738,93→668,69 px**. Esta prueba local no se presenta como verificación productiva; tras publicar se comprueba de nuevo la página real.

La confirmación final del despliegue y los recibos productivos se añaden después de la lectura independiente y de las pruebas reales. No se modifica ni se prueba una compra final con pago; se conserva la configuración del checkout y Releasit.

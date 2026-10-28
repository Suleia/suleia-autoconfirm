# CollaGum: corrección de composición según la imagen del propietario

El despliegue anterior estaba activo pero no reproducía la escala y composición de la referencia. El propietario pidió corregirlo y confirmó expresamente **3/6/9 meses orientativos**, sustituyendo los anteriores2/4/6. Se mantiene la nota de un cepillado diario y variación según cantidad usada.

Cambio productivo mínimo: **solo `snippets/quantity-breaks.liquid`**, en MAIN **198240600396**, sobre el hash actual407d927dc648ea2c95974a56fa24d4cb. Plantilla CollaGum, todos sus otros bloques, NIDA, SEOUL, checkout, Releasit e integraciones quedan fuera de escritura. Se prueban por identidad los bytes del snippet fuera de guardas CollaGum, inputs, scripts y cálculos de precios. Se conservan el pack2predeterminado y los precios24,99/29,99/34,99EUR/descuentos5/29,99/54,98EUR.

## Por qué los envases se veían pequeños

Los PNG aprobados640×440 tienen mucho margen transparente. Con una caja de65px, el tarro del pack1 solo ocupaba unos27px de ancho. La nueva presentación usa una ventana CSS que descarta únicamente transparencia, preserva las proporciones y mantiene dentro de ella todos los píxeles opacos del producto, con margen de seguridad. No se edita, genera, sube ni sustituye ninguna imagen.

| Pack | Bbox opaco en el PNG | Ventana CSS (x,y,w,h) |
|---|---|---|
| 1 |186,22–450,316|180,16,276,306|
| 2 |105,22–532,327|99,16,439,317|
| 3 |56,10–566,315|50,4,522,317|

Se reproduce la composición de tres columnas, encabezado azul marino, imágenes dominantes, ahorro rosa encima del precio, cajas azul/verde con calendario/check y duración, y trazos vectoriales con las frases del pack2/3. Se mantiene **RECOMENDADO** con estrella: la condición previa del propietario prohíbe afirmar MÁS VENDIDO sin evidencia, no disponible en esta tarea. Los envases son los auténticos aprobados, no los reinterpretados de la referencia.

## Seguridad y pruebas previas

Backup completo fresco local381archivos del28/10/2026 18:42:30UTC, ZIP+SHA256 comprobados y manifiesto idéntico antes/después de extraer. SHA256:292dfc09b54be57338ce875250960fedd8fd6e7c96002378cc2c3f3863779484. Originales y ZIP privados fuera de Git. No se duplica ni publica un tema completo.

Validador oficial Shopify sin errores; advertencia de complejidad compartida ya existente. Simulación local de composición sobre HTML real de MAIN, sin scripts ni POST, comprueba320/375/390/430/768/1024/1440px: selector dentro de pantalla, fotos cargadas sin deformación y todos sus píxeles opacos visibles, meses legibles y sin solape de distintivos/duración/precios. En los cuatro móviles requeridos no hay desplazamiento horizontal. El HTML estático completo a768px tenía una anchura ajena al selector; se conserva como observación, no se cambia otro bloque para ocultarla.

`deploy.py` es lectura por defecto, exige la aprobación registrada y compara todo el manifiesto con el backup fresco. `--execute` escribe un solo archivo con journal/readback, rechaza concurrencia y verifica que otros380archivos y producto/variante/base29,99EUR no cambian. No reenvía una escritura incierta. `--rollback` comprueba solo versiones reconocidas; exige además `--execute` para restaurar ese único snippet, sin restaurar estados/pedidos/configuraciones. La conexión reutiliza el helper y las credenciales existentes; no se imprime ni guarda un token. Los scripts se ejecutan únicamente desde el directorio local de evidencia preparado, no desde CI.

## Producción verificada

Publicado28/10/2026 19:03UTC en el mismo MAIN198240600396. Hash final del snippet **ae97c5af141082b6372586f610ec3952**. Lectura completa independiente: **381 archivos, un cambio y380intactos**; plantilla y producto conservados. La página pública identifica MAIN y muestra la nueva clasecg-reference-packs, fotos grandes,3/6/9meses, dos llamadas vectoriales yuna nota orientativa.

Chrome productivo fuera de vista previa confirma320/375/390/430/768/1024/1440px: el selector cabe y los meses no desbordan, todos los píxeles opacos están visibles sin deformación, las imágenes cargan y distintivos/precios no colisionan. Los anchos visibles de fotos a375px pasan deunos27/43/52px a103/104/105px. La anchura global ajena al componente a768px se observa también en producción y queda fuera del cambio; no se afirma que toda la página pase en ese ancho. Selección1→2→3→1→2 correcta, pack2al cargar y0errores de consola. Capturas reales en evidencia local.

Carrito anónimo productivo:1/2/3unidades24,99/29,99/34,99EUR, descuentos5/29,99/54,98, cinco cambios de cantidad correctos, una asignación por línea yninguna promoción de carrito duplicada. Cero pedidos, checkout sin enviar, carrito de prueba vacío y personal sin usar. NIDA/SEOULconservan sus selectores normalizados idénticos antes/después. Recibos saneados incluidos; ZIP y originales privados fuera de Git. Reversión de un archivo preparada y comprobada en lectura, sin ejecutar.

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

Se añaden los recibos de producción después de la lectura independiente, comprobación visual real y carrito anónimo sin pedidos. El resultado local no se presenta como una prueba productiva.

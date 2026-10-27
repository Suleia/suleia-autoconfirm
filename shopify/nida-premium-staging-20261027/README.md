# NIDA premium — implementado solo en pruebas

El selector premium está instalado en el tema **209083892044**, `NIDA · Selector premium · PRUEBAS 27 Oct`, con rol **UNPUBLISHED**. No se ha publicado otro tema ni modificado producción. Requiere la aprobación expresa del propietario tras revisar las capturas y resultados antes de cualquier traslado a MAIN.

[Abrir vista previa de NIDA](https://suleia.com/products/crema-nida?preview_theme_id=209083892044).

## Alcance visual

Cabecera NIDA azul marino, cuatro beneficios con SVG, imágenes aprobadas sin edición, tarjetas blancas/celestes y pack 3 dorado, ahorros y precio por unidad. Pack 2 seleccionado por defecto, con distintivo **PACK DESTACADO**: no se atribuye MÁS VENDIDO sin datos de ventas. Diseño en tres columnas en escritorio amplio y tarjetas horizontales apiladas en móvil/tableta.

Se conserva Judge.me y el formulario de compra existente. En el bloque principal de NIDA se desactivan el antiguo título/beneficios duplicados, la garantía de cambios en siete días, el contador de stock simulado, el contador social simulado y los avisos redundantes de garantía/precio/envío. Se sustituyen por la nueva cabecera y una franja con condiciones verificadas: envío gratuito a Península en 24/48 horas laborables, pago contra reembolso y garantía de 30 días enlazada a condiciones. No se añade una afirmación de originalidad sin prueba. Los contenidos inferiores de la ficha permanecen iguales.

## Precios comprobados en Shopify

Producto 15726118502732, variante 57618953470284, handle `crema-nida`, base real **34,99 EUR** sin cambio. Plantilla efectiva `product.parches_glp`, utilizada solo por NIDA según la consulta completa del catálogo.

| Unidades | Total real | Total anterior mostrado | Descuento real | Precio/unidad mostrado |
|---|---|---|---|---|
| 1 | 29,99 EUR | 34,99 EUR | 5,00 EUR | 29,99 EUR |
| 2 | 34,99 EUR | 69,98 EUR | 34,99 EUR | 17,50 EUR |
| 3 | 44,99 EUR | 104,97 EUR | 59,98 EUR | 15,00 EUR |

Se mantienen las reducciones fijas existentes 5 / 34,99 / 59,98, porcentajes, cantidades, preselección, variantes y atributos de formulario. El redondeo del precio unitario es solo presentación; el carrito conserva céntimos exactos.

## Imágenes aprobadas

La última aclaración del propietario autoriza usar directamente las tres imágenes existentes, **sin regenerar ni modificar etiquetas**. Esta instrucción sustituye la solicitud anterior de corregirlas mediante una fotografía auténtica. No se subieron ni editaron archivos de imagen:

- `nida-pack-1-unidad-blanco.png?v=1793135821`
- `nida-pack-2-unidades-blanco.png?v=1793135830`
- `nida-pack-3-unidades-blanco.png?v=1793135838`

Se asignan mediante `shopify://shop_images/…` en el bloque de NIDA, con contención centrada y espacio reservado para evitar recortes y saltos de diseño.

## Archivos reales en Shopify

| Archivo | Cambio | MD5 verificado |
|---|---|---|
| `assets/nida-premium.css` | Nuevo, estilos limitados a clases NIDA | c56859579b699398cbf3cfe561de3a0f |
| `snippets/nida-premium-ui.liquid` | Nuevo, cabecera/beneficios/ahorro/confianza con guardia `crema-nida` | 47631665cff0e5093e55d5a4d59c0e17 |
| `snippets/quantity-breaks.liquid` | Siete inserciones protegidas por `product.handle == 'crema-nida'` | ee2e1037f1fdc6cac71ea565b30d0560 |
| `templates/product.parches_glp.json` | Solo configuración del bloque principal NIDA | 9688022b88fd33e3db4403255fde1704 |

El constructor demuestra que al retirar esas siete inserciones se recupera exactamente el snippet anterior. El resto de secciones de la plantilla y su orden se comparan sin cambios. `main-product.liquid`, `main.js`, carrito/checkout, ajustes de producto y descuentos no se escriben.

## Evidencia de pruebas

- Validación oficial Shopify de los cuatro archivos: sin errores. El snippet compartido ya superaba el umbral de complejidad (199); con las siete guardias pasa a 206 y conserva una advertencia. No se refactoriza la lógica de otros productos para eliminarla.
- Shopify detectó inicialmente un margen fuera del paso de la configuración. Se corrigió a 15 y se añadió verificación de rango/paso contra el schema real; la plantilla quedó aceptada y su checksum fue comprobado.
- Chrome real en la vista previa autorizada: anchos CSS **375, 390, 430, 768, 1024, 1280 y 1440**, imágenes cargadas completas, precios legibles, sin desbordamiento de tarjetas ni distintivos sobre otras tarjetas. Se corrigieron alineación, distintivos y distribución de precios detectados durante la prueba.
- Selección **1 → 2 → 3 → 1 → 2**, vínculo con el formulario existente, teclado y recarga con pack 2: correctos. Consola de la página: cero errores recogidos.
- Carrito nativo con cookies de prueba aisladas: alta y eliminación de 1/2/3 unidades; cambios de cantidad **1 → 2 → 3 → 2 → 1**. Totales y descuentos de la tabla comprobados, exactamente una asignación de descuento por línea, ninguna adicional de carrito. Carrito de prueba vacío al terminar; no se usó el carrito del operador.
- Cero pedidos creados y ningún checkout enviado. Se valida el precio real del carrito y se conserva íntegra la integración de compra existente; no se presenta como una compra finalizada de prueba.
- CollaGum/SEOUL: HTML de su selector idéntico entre MAIN y pruebas tras normalizar únicamente el ID de instancia de la sección y espacios. El CSS/componente NIDA no aparece en esas fichas.
- Manifiesto completo: MAIN y backup conservan los **379 archivos** sin ninguna diferencia; pruebas tiene **381 archivos**, con exactamente dos altas y dos modificaciones. Los otros 377 archivos existentes permanecen idénticos.

Recibos: `postflight.json`, `ui-qa.json`, `validation.json`, `final-manifest-receipt.json` y `candidate-manifest.json`.

Capturas reales conservadas en el workspace de esta tarea: `shopify-theme-work/nida-premium-20261027/images/nida-desktop-final.jpg` y `nida-mobile-final.jpg`. Se presentan al propietario en el chat; no se incorporan conversaciones ni información de clientes al repositorio.

## Construcción y futuro traslado

`changes.patch` contiene los cambios exactos de los dos archivos existentes; los dos recursos nuevos se conservan completos en este directorio. `build.py` reproduce el candidato desde los archivos originales leídos de Shopify en `source/`, sin llamar a ninguna API ni desplegar nada. Necesita los originales `snippets/quantity-breaks.liquid`, `templates/product.parches_glp.json` y `sections/main-product.liquid`, además de los dos recursos nuevos. Se comprueban huellas normalizadas de entrada para bloquear una reconstrucción sobre otra versión. Los respaldos completos permanecen en Shopify; no se guarda un volcado entero del tema en Git.

Antes de un futuro traslado autorizado: volver a leer MAIN, revisar cambios concurrentes, obtener respaldo exacto de los archivos afectados, preparar el diff NIDA contra ese estado actual y volver a validar. Copiar únicamente los cuatro archivos aprobados; no publicar el tema de pruebas completo ni cambiar la plantilla asignada al producto. La aprobación actual **no autoriza** ese paso.

## Backup y reversión

Backup completo: **209083760972**, `BACKUP PROD antes NIDA premium · 27 Oct`, UNPUBLISHED. Incluye las últimas mejoras SEOUL V3 y CollaGum. Para revertir estas pruebas, restaurar únicamente `quantity-breaks.liquid` y `product.parches_glp.json` del backup; las dos altas NIDA quedarían sin referencia y pueden conservarse hasta revisar su eliminación. No cambiar el tema MAIN ni publicar otro tema. Una futura producción debe tener respaldo nuevo de sus archivos exactos para preservar cualquier trabajo posterior.

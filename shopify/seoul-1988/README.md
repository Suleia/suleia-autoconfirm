# SEOUL 1988 — reconstrucción de `neriva_nad`

Implementación y comprobaciones del 28 de septiembre de 2026.

## Estado y alcance

La landing está instalada en el tema **no publicado 206684094796**, «Suleia SEOUL 1988 - revisión 28 sep».

[Abrir vista previa](https://suleia.com/products/crema-seoul-1988?preview_theme_id=206684094796).

Se conserva la plantilla `product.neriva_nad.json`, asociada al producto Crema Seoul 1988 (16138510991692). No se ha publicado un tema ni sustituido MAIN 198240600396. Los seis archivos remotos coinciden con los locales; la comparación de checksums del MAIN no detecta modificaciones. Véase `deployment-verification.json`.

Los dos descuentos automáticos de SEOUL sí están activos en Shopify, también para el producto publicado. La publicación visual de esta landing queda pendiente. El conector solo permite escribir archivos en temas no publicados; no se ha eludido esa restricción.

## Archivos de tema

| Archivo | Cambio |
|---|---|
| `templates/product.neriva_nad.json` | Reconstrucción completa: 12 secciones activas y 2 preparadas/desactivadas. |
| `sections/seoul-design.liquid` | Nuevo cargador de CSS/JS condicionado a `template.suffix == neriva_nad`. |
| `sections/seoul-ingredients.liquid` | Nueva sección editable de ingredientes, bloques y aclaración de retinal. |
| `sections/seoul-step-description.liquid` | Copia aislada de la sección nativa de argumentos; elimina la referencia a un asset inexistente. |
| `assets/seoul-1988.css` | Nuevo diseño marfil/burdeos, tipografía editorial, ofertas y responsive; selectores limitados al marcador SEOUL. |
| `assets/seoul-1988.js` | Etiquetas accesibles de ofertas, alt de imágenes y accesibilidad/estilo del botón Releasit dentro de SEOUL. |

No se editan secciones compartidas, cabecera, pie, carrito, checkout, home, políticas, NIDA ni CollaGum.

## Auditoría y composición

Se respaldaron 377 archivos de texto del tema antes de editar. El respaldo íntegro permanece fuera de Git en `shopify-theme-work/seoul-1988/baseline`, con su manifiesto; contiene contenido anterior que no debe copiarse al repositorio. `audit.json` registra los hashes de las 87 dependencias auditadas y las secciones retiradas.

Reutilización nativa: `main-product` (título/galería dinámicos, quantity breaks y compra), `rich-text`, `image-with-text`, `icon-bar`, `image-slider`, `timeline-results`, `collapsible-content` y `apps` para Judge.me. La arquitectura de NIDA sirve como referencia; no se copian sus reseñas, estadísticas, imágenes o testimonios.

Orden: hero/compra, introducción, cuidado coreano, beneficios, cinco argumentos, galería, ingredientes, ritual de cinco pasos, confianza y FAQ; Judge.me muestra únicamente datos del producto y se oculta si está vacío. El cargador de diseño es la duodécima sección activa.

UGC y comparativa antes/después están preparados pero desactivados: no existe material verificable aportado para SEOUL. No se inventan resultados ni reseñas. Se usan exclusivamente las tres imágenes existentes del producto.

Se retira la composición anterior de NERIVA: copy de suplemento/NAD+, cápsulas, energía y longevidad; imágenes y estilos inline anteriores; bloques de estadísticas y reseñas manuales. No hay Custom Liquid en la nueva plantilla. La cadena `neriva_nad` permanece únicamente como identificador técnico necesario.

## Ofertas reales

| Cantidad | Base | Descuento total | Total comprobado |
|---:|---:|---:|---:|
| 1 | 29,00 € | 0,00 € | **29,00 €** |
| 2 | 58,00 € | 22,01 € | **35,99 €** |
| 3 | 87,00 € | 44,01 € | **42,99 €** |

El pack de dos aparece preseleccionado. `fixed_amount_off` en el tema representa el descuento del pack completo, no por unidad.

Descuentos automáticos creados, restringidos a la variante 58939591852364:

- Pack 2: 2285122945356, mínimo 2 unidades, 22,01 € por conjunto.
- Pack 3: 2285123010892, mínimo 3 unidades, 44,01 € por conjunto.

`verify-cart.mjs` probó 1 → 2 → 3 → 2 → 1 en un carrito anónimo independiente: cinco resultados correctos en EUR. Se eliminó el contenido al terminar; no se creó pedido. Resultados en `cart-verification.json`.

En navegador se añadió el pack preseleccionado al carrito aislado (2 unidades, 35,99 €), se incrementó a 3 (42,99 €) y se retiró la línea de prueba. Se comprobó además que Releasit abre el formulario con 2 unidades, descuento 22,01 € y total 35,99 €, sin completarlo. El artículo previo de NIDA de la sesión Chrome se conservó sin cambios.

Límite: estas ofertas no se combinan con descuentos de producto/pedido. Los descuentos existentes de otras referencias tampoco admiten combinación. Los totales anteriores están verificados para un carrito SEOUL; no constituyen una promesa de acumulación en carritos mixtos. No se han cambiado las promociones de otras referencias.

## Validación

- JSON válido y ajustes cotejados con schemas reales (incluidos valores select/range) mediante `build-template.mjs`.
- Theme Check 3.29.1: seis archivos correctos, sin incidencias reportadas. Revisión adicional del CSS final correcta. Informes en `evidence/theme-check-*.txt`. El validador usó los esquemas oficiales incluidos en el paquete al no poder escribir su caché de AppData.
- JavaScript: `node --check` correcto.
- Consola Chrome e IAB: sin errores ni advertencias capturados durante las pruebas finales.
- DOM visible: sin Liquid errors ni referencias a NERIVA, NAD, NMN o resveratrol.
- Imágenes del contenido cargadas correctamente; hero prioritario, carga diferida fuera del hero y tamaños/srcset nativos conservados. No se ha realizado una medición Lighthouse/CLS de laboratorio.
- Radios de 1, 2 y 3 unidades comprobados con teclado; FAQ expandida mediante Enter; botón contra reembolso accesible con teclado.
- Responsive: 390, 430, 768, 1024 y 1440 px. Anchos de documento 375, 415, 753, 1009 y 1425 px respectivamente (barra vertical de 15 px); sin desbordamiento horizontal. Capturas finales adjuntas.
- Estilos marfil/burdeos y serif editorial propios, frente a la composición visual anterior de NIDA; estructura nativa conservada.

Problemas corregidos durante QA: tarjetas de packs demasiado estrechas, especificidad de `.rte` sobre títulos, enlace a asset inexistente en step-description, ocultación del ATC por Releasit, CTA sin semántica de botón y distribución estrecha de dos botones en tablet. La compra nativa se verificó finalmente mediante teclado tras una primera interacción de automatización que no produjo cambios.

El carrito global conserva sus rótulos heredados (por ejemplo «Oferta Pre-Navidad»), tal como exige el aislamiento. No se ha modificado el diseño global de Releasit ni su formulario final.

## Evidencias y reproducción

`evidence/desktop-1440.png` muestra el hero; `desktop-1440-full.png` la landing completa. `final-390.png`, `final-430.png`, `final-768.png` y `final-1024.png` documentan los otros tamaños. `cart-pack-2.png` y `cart-pack-3.png` corresponden exclusivamente al carrito de prueba SEOUL.

Para reconstruir el JSON contra un respaldo compatible:

```sh
node shopify/seoul-1988/build-template.mjs /ruta/al/respaldo
```

Para repetir la prueba de ofertas (crea y limpia un carrito anónimo; no genera pedidos):

```sh
node shopify/seoul-1988/verify-cart.mjs
```

La revisión Git contiene únicamente esta carpeta de tema y evidencias. No requiere desplegar el backend logístico ni cambiar Render.

# NIDA premium — traslado autorizado al tema activo

El propietario ha aprobado expresamente trasladar el diseño revisado de NIDA a producción. Tema activo **198240600396**, fuente aprobada **209083892044**, producto **15726118502732**, variante **57618953470284**, plantilla efectiva **product.parches_glp**. Esta autorización no permite publicar otro tema completo ni modificar otros productos o automatizaciones.

El diseño está publicado y verificado en [la ficha pública de NIDA](https://suleia.com/products/crema-nida) desde el 28 de octubre de 2026 a las 17:09 UTC. La preparación volvió a leer los archivos y manifiestos: MAIN seguía en la versión sobre la que se creó el borrador. El backup completo **209083760972**, `BACKUP PROD antes NIDA premium · 27 Oct`, coincidía en los **379 nombres/checksums** con MAIN antes del cambio, verificado de nuevo el día 28. Se reutilizó esa copia idéntica y se guardaron además valores exactos y manifiesto actuales antes de las escrituras. No se presenta como un backup creado el día 28.

Se reconstruye el candidato desde MAIN mediante las siete inserciones protegidas por `crema-nida` y la configuración aislada de NIDA. El resultado coincide con los cuatro archivos del borrador aprobado y con los hashes de la validación, las pruebas responsivas y el carrito de la PR #169:

| Archivo | MD5 aprobado |
|---|---|
| `assets/nida-premium.css` | c56859579b699398cbf3cfe561de3a0f |
| `snippets/nida-premium-ui.liquid` | 47631665cff0e5093e55d5a4d59c0e17 |
| `snippets/quantity-breaks.liquid` | ee2e1037f1fdc6cac71ea565b30d0560 |
| `templates/product.parches_glp.json` | 9688022b88fd33e3db4403255fde1704 |

El carrito nativo aislado previo al despliegue confirma 29,99 / 34,99 / 44,99 EUR para 1/2/3 unidades, con descuentos 5 / 34,99 / 59,98, sin promociones duplicadas. Base 34,99 EUR y asignación de plantilla permanecen intactas. Las imágenes aprobadas se utilizan sin edición. La validación Shopify previa de los mismos cuatro archivos pasó sin errores, con la advertencia conocida de complejidad del snippet compartido.

## Ejecución controlada

`deploy.py` usa las credenciales existentes mediante el helper local autorizado, sin imprimirlas ni guardarlas. El conector Shopify limita las escrituras a borradores; el traslado aprobado usa la API nativa de la tienda. Las lecturas/escrituras de contenido se hacen por GraphQL para conservar la representación aprobada: REST devuelve el JSON de plantilla con otra serialización (sin cabecera y con barras escapadas), aunque representa el mismo objeto. No se adapta el diseño a esa diferencia.

El modo predeterminado es lectura/preflight. `--execute` exige el recibo de aprobación y la prueba previa del carrito; escribe solo los cuatro archivos en orden de dependencias, dejando la plantilla para el final. Guarda un journal antes de cada solicitud y verifica cada hash mediante una lectura independiente. Un error incierto se reconcilia con lecturas; no se repite la escritura. Un journal existente exige revisión antes de otra ejecución. Comprueba edición concurrente, fuente, backup, rol MAIN, producto y manifiesto completo.

Ejemplo local, con el directorio de estado preparado de esta tarea:

```powershell
python deploy.py --workspace C:/Users/samue/OneDrive/Documentos/Suleia --state-dir C:/Users/samue/OneDrive/Documentos/Suleia/shopify-theme-work/nida-production-20261028 --execute
```

El script depende del helper local `shopify_web_tools.py`; no contiene credenciales ni se ejecuta automáticamente desde GitHub. Los respaldos de contenido completo y el journal permanecen fuera de Git.

## Reversión

`--rollback` es solo una comprobación; requiere `--execute` adicional para escribir. Reconoce únicamente los hashes previos o aprobados, rechaza ediciones concurrentes y restaura solo los dos archivos existentes desde los valores respaldados. Compara el contenido semántico del JSON y el texto del snippet. Los dos recursos nuevos pueden permanecer sin referencias; no elimina archivos ni publica otro tema. La copia completa nativa se conserva. No restaura pedidos, descuentos, clientes, estados financieros ni temporizadores.

## Verificación final de producción

- Cuatro escrituras, cada una con lectura independiente del hash aprobado. MAIN conserva su identidad y rol; no se publica otro tema completo.
- Una segunda lectura paginada completa a las 17:17 UTC confirma 381 archivos, igualdad con el borrador aprobado, exactamente cuatro diferencias respecto al MAIN anterior y **377 archivos existentes sin cambios**. El backup de 379 archivos permanece intacto.
- El HTML anónimo de NIDA identifica el tema activo y su selector coincide con el aprobado. El precio base de variante, las imágenes y la asignación de plantilla se conservan.
- El carrito nativo aislado devuelve **29,99 / 34,99 / 44,99 EUR** para 1/2/3 unidades; los cambios 1→2→3→2→1 también cuadran, sin descuentos duplicados. Carrito de prueba vaciado, cero pedidos y ningún checkout enviado. No se usa el carrito personal del operador.
- Chrome fuera de vista previa: anchos CSS **375, 390, 430, 767 y 1440 px**; imágenes cargadas, etiquetas sin colisiones ni desbordamiento horizontal y selección 1→2→3→1→2 correcta. No se registran errores de consola. Capturas reales de producción móvil y escritorio conservadas en el directorio de evidencia local.
- CollaGum y SEOUL conservan el selector normalizado idéntico al tema de referencia y no cargan los recursos de NIDA. No se escriben otros productos, precios, descuentos, carrito, checkout ni automatizaciones.

Recibos saneados: `deployment-result.json`, `final-manifest-receipt.json`, `postflight.json` y `final-receipt.json`. Los respaldos completos, el journal y la evidencia del navegador quedan fuera de Git. La reversión fue comprobada en modo lectura; no se ha ejecutado.

# V10 · Acta de aceptación de desarrollo

**24 octubre 2026 · No desplegado.** Todas las cifras de las capturas son
simuladas. Los agregados productivos de la auditoría se documentan por separado
en [ADS_INTELLIGENCE_V10.md](ADS_INTELLIGENCE_V10.md).

## Ejecución final

- **1.264/1.264 pruebas**, 137 archivos, cero fallos, cancelaciones u omisiones.
- Linux/Node22 con PostgreSQL17.5 efímero por socket Unix. `--network=none`, raíz
  de contenedor de solo lectura, sin secretos ni credenciales de producción.
- Duración: 157.548,85 ms. Mismo umbral de rendimiento original, ejecución
  secuencial sobre una CPU para evitar competencia artificial entre suites.
- SHA256 del archivo de fuente aceptado:
  `4ff539e4e1ded28116c4a0bb958bf9064b6e64767072d74fdd45154c8daea630`.
- Acta y log privados del contenedor:
  `/var/tmp/suleia-v10-qa-4ff539e4e1/result.json` y `tests.log`.
- Los contenedores y volúmenes temporales PostgreSQL se eliminaron al terminar.
  No se reiniciaron contenedores productivos ni el bot.

Las pasadas anteriores no se presentan como éxitos: la primera detectó un mock
de DOM sin `document.querySelector`, que se amplió con comprobación del drawer
V10 y reanudación del refresco; otra pasada paralela excedió el umbral original
del test de 2.000 pedidos al competir por una CPU. No se alteró el algoritmo de
pedidos ni ese umbral. La pasada final secuencial superó también ese test.

## Cobertura funcional y de seguridad

| Área | Evidencia ejecutada |
|---|---|
| Embudo | Etapas ausentes; cero/denominador pequeño; población incompatible; etapa mayor al padre; compra con checkout cero; caída comparable válida |
| Métricas | CPA/valor/ROAS ausentes o ambiguos; agregación ponderada; no sumar alcance/frecuencia; huecos sin ceros |
| Clasificación | Pocas compras, contexto no verificado, fuente antigua, día/semana mala con mes bueno, deterioro repetido, aprendizaje/cambios recientes, fuentes opcionales independientes |
| Periodos | Madrid, ventanas completas 3/7/14/30/60/90, personalizados, bases equivalentes, hoy parcial; histórico sin acciones actuales |
| Preparación | Coalescencia, respuesta202, mismo trabajo al reintentar, caché acotada y fuentes opcionales fallidas |
| OAuth/API | 401 sin sesión, GET-only, no suplantar principal/actor, roles de Telegram, sin transferencia de autoridad presupuestaria |
| Journal | Digest cambiado rechazado, actor inválido, evidencia congelada, duplicados idempotentes, evolución posterior separada y no causal |
| SQL objetivo | Fechas Madrid durante DST, corte de madurez, duplicado canónico y pruebas excluidos, confirmaciones de cohortes antiguas, entradas futuras excluidas, salida solo agregada |
| Objetivo | Muestra pequeña/inválida, tasa cero, pesos diarios diferentes, escenarios ordenados, CPA sostenible/presupuesto N/D |
| Contenido | Nombres maliciosos inertes, imágenes no seguras/credenciales/URL ausente rechazadas, sin enlace fantasma `/undefined` |
| Instantáneas | Una fila o hijo de otro periodo nunca sustituye el informe original; acciones históricas deshabilitadas |
| Telegram | Fallback determinista, cuatro partes y tamaño válido, locks/claims, orden, un solo envío por fecha, UNKNOWN bloqueado, reinicios, DST25oct22:30Madrid |
| V5.1 | Suite completa de política, límites, transporte, reservas, idempotencia, learning y ejecutor; 19 hashes protegidos iguales |
| Regresión | V3/V4/V6/V8, pedidos, incidencias, descuentos, readonly SQL/MCP, finanzas y COGS, analítica, AppShell y login |

Además, el cierre de la suite de panel antes del último caso añadido pasó
61/61 en Windows. El nuevo caso de instantánea por periodo pasó en el conjunto
de cinco pruebas UI de crecimiento y está incluido en las **1.264 finales**.

## Prueba visual local real

Chrome mediante la excepción local de navegador ya autorizada. El harness
utiliza `createReviewService` y su `growth` reales sobre fixtures sintéticos;
no sustituye esos servicios por JSON de diseño. Solo el transporte OAuth local
y las fuentes se simulan. Banner visible y nombres DEMO. Ninguna llamada Meta,
Shopify, Dropea, Telegram o OpenAI desde ese entorno.

| Comprobación | Resultado |
|---|---|
| Desktop1440×1080 | Cuatro KPIs principales, 18 totales, cinco prioridades, cuatro etapas principales, sin overflow de página |
| Tablet834×1112 | Dos columnas principales; lectura y drawer adaptables, sin overflow de página |
| Móvil390×844 | Menú plegable, filtros abrir/cerrar, KPIs de dos columnas, drawer del ancho del dispositivo, sin overflow de página |
| AppShell | Los seis botones conservan el mismo componente y selección activa al navegar por los seis módulos |
| Login | Entrada por login local vuelve a `#ads`; las pruebas de OAuth verifican PKCE, vuelta, expiración y refresh sin modificar autenticación real |
| Campaña | ID101, comparación temporal y anuncios propios; guardar observación muestra éxito e historial, cero acciones Meta |
| Conjunto | ID201 y ID203 verificados; anuncio hijo corresponde al conjunto y fechas seleccionados |
| Anuncio | ID3010 e ID3030 verificados; miniatura local DEMO, propuesta de presupuesto deshabilitada |
| Embudo | Carrito ordena primero los dos anuncios de Sérum con caída observada115,5 eventos cada uno, frente a cero de los demás |
| Personalizado | 1–7octubre se propaga al drawer y bloquea registrar decisión/preparar propuesta como acción actual |
| Muestra insuficiente | Conserva N/D y motivos; no se fabrica una decisión de eficiencia ni habilita ejecución |
| Refresco | Los tests conservan el mismo modal abierto y reanudan el refresco tras cierre, sin impedir la actualización explícita |
| Consola | Cero errores JavaScript en la verificación final de la aplicación |

El primer arranque del harness no declaraba la capacidad V7 y entró en la ruta
legacy; se corrigió la configuración de **prueba**, sin cambiar flags de
producción. También se unificó el GET y POST de evidencia del harness bajo el
mismo servicio, en vez de comparar dos variantes de fixture con distinto campo
`force`. Estos fallos de preparación local no se atribuyen al runtime productivo.

Una captura full-page excedió el tiempo del navegador; no se presenta una
imagen de carga como prueba. Se entregan vistas reales del viewport y capturas
separadas del análisis ya cargado. Las capturas de los módulos ajenos demuestran
el menú común en un escenario local vacío, **no verifican sus cifras reales**.
La regresión financiera real quedó documentada y desplegada en PR145/146.

## Capturas revisables

![Dashboard de desarrollo con datos simulados](assets/ads-v10/desktop-dashboard.png)

- [Embudo y series](assets/ads-v10/funnel-and-trends.png)
- [Prioridades y objetivo comercial](assets/ads-v10/daily-decisions.png)
- [Contribución a una caída del embudo](assets/ads-v10/funnel-contributors.png)
- [Análisis de campaña](assets/ads-v10/campaign-analysis.png)
- [Análisis de conjunto](assets/ads-v10/adset-analysis.png)
- [Análisis de anuncio](assets/ads-v10/ad-analysis.png)
- [Móvil](assets/ads-v10/mobile-dashboard.png)
- [Análisis móvil](assets/ads-v10/mobile-analysis.png)
- [Menú móvil](assets/ads-v10/mobile-menu.png)
- [Tablet](assets/ads-v10/tablet-dashboard.png)
- Menú compartido: [Pedidos](assets/ads-v10/menu-orders.png),
  [Incidencias](assets/ads-v10/menu-incidents.png),
  [Resultados](assets/ads-v10/menu-results.png).

Respecto a la referencia aprobada: superficies blancas con azul tenue, iconos
azules/verdes/violetas, tipografía oscura, jerarquía de cuatro KPIs y líneas
basadas en datos. Se añaden los controles de cobertura y N/D necesarios; las
cifras de la imagen de referencia no se copian como datos reales.

## Qué no acredita esta aceptación

No acredita despliegue V10, compras causadas por anuncios, deduplicación Pixel/
CAPI, EMQ, margen/CPA confirmado por campaña, presupuesto sostenible o una
modificación presupuestaria real. La conexión comercial solo acredita los
agregados y la limitación de duplicidad descritos en la auditoría. Ninguna
revisión ni smoke de V10 ha enviado mensajes a clientes o soporte.

Los artefactos, la comprobación de cambios concurrentes, los backups privados
frescos y el rollback para una futura aprobación se describen en el
[plan de despliegue](ADS_INTELLIGENCE_V10.md#artefactos-y-despliegue-pendiente-de-aprobación).

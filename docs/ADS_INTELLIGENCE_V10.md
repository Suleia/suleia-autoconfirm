# Ads Intelligence V10 · Meta Growth Intelligence

Estado: **desplegado con autorización del propietario; validación operativa parcial por límite de Meta**.
Fecha de auditoría: 24 de octubre de 2026. Rama: `codex/ads-intelligence-v10`.
Base compatible: `4d16c9f`, que conserva la reparación financiera de PR145/146.

## Compatibilidad y alcance

| Capa | Estado comprobado | Tratamiento en V10 |
|---|---|---|
| V8, PR141 | PR abierta; funciones ya desplegadas mediante overlays protegidos | Se reutilizan el servicio de revisión, OAuth, caché canónica, informes y ledger |
| V9, PR144 | Abierta/borrador en `2432808`; implementación preliminar sin despliegue | Se reconcilia únicamente su diff respecto a `09af1f6` y se amplía el mismo `buildDailyDecisions` |
| V10 | API y panel activos en `7224c11` | Overlay exacto de 21 archivos; conserva la base financiera |
| V5.1 | LIVE autorizado previamente | Los 19 archivos protegidos son idénticos en servidor y candidato |
| OpenAI | Pendiente, 0 USD | Sin llamadas, claves, proveedores nuevos ni cambio de modelo |

No hay otro panel, bot, lector Insights, ejecutor, base de datos o programador.
No se modifican campañas, presupuestos, pedidos, incidencias, temas, plantillas,
descuentos, devoluciones ni importadores.

La integración cambia `runtime.mjs` únicamente para pasar una lectura agregada
del repositorio existente al servicio de revisión. El pequeño cambio en
`budget-autopilot-v5.js` selecciona el ID de campaña al abrir su vista de consulta;
no altera ninguna regla ni añade un control de escritura.

## Diseño y navegación

El único `SuleiaShell` sigue sirviendo los seis módulos. Se aplica un degradado
azul marino y una selección turquesa al mismo sidebar; los estilos interiores
nuevos quedan limitados a Ads Intelligence y su drawer.

Cuatro indicadores principales: gasto, ROAS atribuido, compras atribuidas y CPA.
Catorce secundarios: impresiones, alcance, frecuencia, CPM, CTR/CPC de enlace,
clics salientes, landing views, carrito/coste por carrito, checkout/coste por
checkout, valor atribuido y presupuesto activo actual. Cada indicador conserva
periodo, cobertura y observación en su descripción. Sus líneas proceden de los
hechos diarios; no hay curvas inventadas para métricas sin serie. El aumento de
costes se marca como desfavorable y el gasto permanece neutral.

Se conservan hoy, ayer, 3/7/14/30/60/90 días completos y fechas personalizadas,
con Madrid y bases equivalentes. Hoy no se compara con ayer completo como si
fuera un corte idéntico. En móvil los filtros se despliegan a petición del usuario.

La gráfica muestra una sola métrica/unidad, con serie actual y anterior cuando
están disponibles y son compatibles. Los huecos permanecen vacíos. Los cambios
de presupuesto son contexto, sin atribuirles causalidad.

El gráfico circular de reparto de gasto no se usa en el nuevo overview. Lo
sustituye el embudo Landing → Carrito → Checkout → Compra, con detalle de seis
etapas. Al seleccionar una etapa se ordenan los anuncios por su contribución a
la caída de eventos respecto a una base de igual duración y ámbito, no por su
volumen bruto ni como supuestos usuarios perdidos.

## Contrato de datos y límites

| Dato | Fuente/reutilización | Límite visible |
|---|---|---|
| Métricas de campaña/conjunto/anuncio | Lector canónico Meta, mismo contrato y jerarquía | No se suman niveles |
| CPA y ROAS | Cocientes de importes/conteos agregados | No se promedian ratios por entidad |
| Alcance y frecuencia | Lectura de una sola entidad sobre el rango completo | N/D al agregar audiencias o reconstruir días |
| Embudo | Eventos agregados con mismo ámbito y periodo | No es un recorrido único de personas |
| Pixel/CAPI | Señales agregadas disponibles | `event_id`, deduplicación y EMQ no verificados |
| Shopify | Lector comercial mínimo existente | Pedidos no equivalen a sesiones de checkout |
| Confirmaciones Dropea | Proyección canónica financiera existente, agregada | Sin teléfonos, direcciones o conversaciones |
| Beneficio/CPA confirmado por campaña | Sin enlace acreditado Meta→pedido→cobro | N/D; no se inventan atribución ni margen |
| Presupuesto necesario para 40 confirmados | Sin CPA sostenible verificado | N/D; no hay escenario monetario autorizado |

El embudo bloquea ratios/pérdidas con eventos ausentes, denominador cero o menor
de 30, poblaciones incompatibles, etapa superior al padre o compras con cero
checkouts. Una caída relativa de al menos 25% con evidencia comparable permite
señalar una etapa para investigar, sin afirmar que la web esté rota.

Las ventanas 3/7/14 días y sus bases se derivan de los mismos hechos diarios de
30 días. Se exige cobertura por entidad y día; una fila ausente no se transforma
en cero. La base de 30 días usa el agregado anterior del lector existente. No
se inventa su serie diaria cuando no está en la ventana ya cargada.

La preparación del análisis se comparte, tiene como máximo dos trabajos y doce
entradas de caché de dos minutos. La respuesta pendiente mantiene HTTP202 y
`Retry-After`; el panel conserva los indicadores disponibles si falla una
dependencia opcional. No se añade el quinto `report()` que proponía V9 al camino
de cuatro lecturas del informe ejecutivo. Los distintos niveles reutilizan el
snapshot multijerarquía del lector, no otro cliente Meta.

## Cerebro Meta y análisis profundo

Se amplía `services/meta-ads/executive/daily-decisions.mjs`, también usado por
Telegram. La política de **revisión**, versionada `suleia-growth-v10.0`, exige
15 EUR de gasto, 1.000 impresiones, cinco compras y tres días con evidencia para
un juicio de eficiencia. Estos umbrales analíticos **no sustituyen los controles
monetarios/intradiarios V5.1**, cuyo mínimo incremental aprobado sigue intacto.

Estados: candidata a escalar, proteger, mantener, mejorar creatividad, mejorar
conversión, investigar, revisar reducción, revisar pausa y datos insuficientes;
las entidades pausadas se distinguen como inactivas. Se priorizan hasta cinco
acciones, con un máximo de dos por campaña. Las recomendaciones incluyen
evidencia numérica de periodos etiquetados, riesgo, confianza cualitativa,
alternativas y una comprobación concreta.

Una candidata necesita semanas comparables y mes favorable; aprendizaje activo,
cambios recientes o una señal contraria de hoy justifican protegerla. Un día
malo no basta para revisar una pausa: se requiere deterioro repetido en dos
semanas completas y contexto mensual desfavorable, o ceros realmente verificados
en varias ventanas con gasto suficiente. Un mes fuerte impide interpretar dos
semanas débiles como prueba suficiente de pausa. Ningún estado ejecuta Meta.

`VER ANÁLISIS` abre el mismo drawer para los tres niveles, con ID exacto,
creatividad/producto solo si están disponibles, resumen, recomendación, doce
KPIs, qué funciona/no funciona, hoy/ayer/3/7/14/30 días y bases, anuncios hijos
del periodo seleccionado, riesgo, alternativas, cambios propios y auditoría.
Sin selección inequívoca devuelve 400. No hay JSON bruto en el drawer.

Preparar propuesta solo abre la campaña exacta en la vista presupuestaria
existente. La propuesta y confirmación del ejecutor siguen en Telegram, con
V5.1, identidad numérica, reservas, límites e idempotencia. Esta revisión no
adquiere capacidad de escritura ni de activar/pausar campañas. Con evidencia
insuficiente, histórica o entidad inactiva, los controles quedan deshabilitados.

## Objetivo 55/40 e histórico

La lectura agregada usa la conexión SQL existente, sin rol nuevo ni migración.
Separa pedidos creados hoy, confirmados de esa cohorte y todos los eventos de
confirmación de hoy. Excluye pruebas y duplicados identificados por la fuente
canónica, y muestra explícitamente los casos `NOT_ASSESSED`.

Se observan 28 días de cohortes con al menos siete días completos de madurez;
son necesarios al menos 30 pedidos y siete días con cinco pedidos. La tasa
agrupada permite `ceil(40/tasa)`. Los escenarios conservador/favorable son
cuartiles diarios descriptivos acotados por la tasa central, no intervalos de
confianza ni previsiones causales. Cero confirmaciones no produce una división
por cero ni un número ficticio de pedidos necesarios.

La consulta real de solo lectura, con datos observados a
**2026-10-24T20:00:22.404Z**, obtuvo:

- Hoy Madrid: 28 pedidos creados, 21 confirmados de esos pedidos, 22 eventos de
  confirmación contando cohortes anteriores.
- Cohorte madura 19 septiembre–16 octubre: 374 pedidos, 293 confirmaciones en
  28 días; tasa observada 78,34%, equivalente descriptivo de 52 pedidos para 40
  confirmados. Duplicidad: `NOT_ASSESSED`, no se presenta como deduplicada.
- Cero escrituras externas; CPA sostenible y escenarios presupuestarios N/D.

`GROWTH_REVIEW`, `GROWTH_DECISION` y `GROWTH_OUTCOME` usan el mismo journal V6.
El servidor toma el usuario del OAuth, recalcula/verifica el digest y conserva
reglas, fechas y evidencia originales. El ledger existente deduplica cuerpos
idénticos por hash. Un resultado posterior debe tener observación más reciente;
se añade separado, enlaza el registro original y nunca lo reescribe. No se
declara una acción ejecutada ni un resultado verificado sin evidencia del
ejecutor. La comparación antes/después no acredita causalidad.

Los drawers de informes guardados permanecen congelados. Una fila o creatividad
de otro periodo no sustituye las métricas originales. Consultar el análisis
actual es una acción distinta y explícita.

## Auditoría del runtime, Telegram y fuentes

A las **20:15:46 UTC del 24 de octubre**:

- API `f72bf2cac58812d84b62a571853ed17b66e3f174`, imagen
  `suleia-finance-cogs:f72bf2c`, saludable; panel
  `/opt/suleia-panel-releases/finance-cogs-a2f2f4f`.
- Render conserva `d175378d288d33823ced70f8db3b3a806854377e` y health OK.
- Bot existente activo, configuración sin cambios, un destinatario aprobado.
- Autopilot habilitado LIVE; 56 slots COMPLETE, último a las 20:00 UTC. COMPLETE
  **no es prueba de cambios presupuestarios verificados**.
- Cuatro partes SENT del informe del 23 de octubre, un destinatario; última a
  las 20:32:23 UTC. No se ha adelantado ni reenviado el informe del día 24.
- 2.189 entradas canónicas financieras, todas con duplicidad no evaluada.
- Los 19 hashes presupuestarios protegidos coinciden en producción y candidato.

Se añade un bloque compacto de decisiones a la cuarta parte del informe
existente, con fallback determinista si el histórico falla. Se mantienen cuatro
partes, un consumidor, un programador, claves diarias, destinatario y ledger.
22:30 Madrid corresponde a 20:30 UTC el 24 de octubre y 21:30 UTC el día 25,
tras el cambio de hora. Los tests cubren concurrencia, reinicios y una sola
entrega durante esa transición; no se envió un informe de prueba a Telegram.

Referencias: contrato y fuentes oficiales conservados en `review/policy.mjs`;
[campos de Insights del SDK oficial Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py).
Los accesos a documentación web de Insights/deduplicación devolvieron bloqueo
o contenido no disponible durante la auditoría. No se incorporaron nuevos
campos Meta ni se declaró verificación de Events Manager. No se ha configurado
una nueva integración de analítica de sesiones Shopify.

## QA y capturas

Acta detallada: [ADS_INTELLIGENCE_V10_QA.md](ADS_INTELLIGENCE_V10_QA.md).
Las imágenes son **capturas reales del panel local con datos simulados**,
identificados como DEMO. No contienen datos ni conversaciones de clientes.

El harness `tools/preview-ads-v10.mjs` escucha únicamente en `127.0.0.1`, usa el
servicio real de revisión con fixtures, simula un login local y nunca se incluye
en los artefactos productivos. No crea una ruta de autenticación de prueba en
la API productiva. Las pruebas de OAuth real conservan sus validadores y roles.

## Artefactos y procedimiento de despliegue

El procedimiento siguiente se preparó antes de la aprobación. El acta de
ejecución al final de esta sección lo sustituye como estado actual.

`tools/package-ads-growth-v10.py` prepara dos overlays y un manifiesto con hashes
anteriores/nuevos, revisión, base productiva, los 19 hashes protegidos y rollback.
Requiere un commit intencional y el acta de producción auditada. No conecta ni
despliega. Excluye fixtures, harness de login, tests y credenciales. No se precisa
migración, permiso SQL adicional, secreto, destinatario o tarea programada.

Artefactos ya preparados para el commit de implementación
`7224c11fad4a5557732da7c935ff3bef5d2c0f35`: **21 archivos de runtime**, con los
19 archivos protegidos contrastados. [Manifiesto revisable](ADS_INTELLIGENCE_V10_RELEASE.json)
registra la aprobación posterior y el despliegue verificado. Archivos privados locales:
`output/ads-intelligence-v10/release-7224c11/`.

- API SHA256: `2f64b9a1131f03c9889f572ba64132b41f6dcaa8884ce002a9e8d2c1b6b023c8`.
- Panel SHA256: `8bf1b98e691e48c6daf88b7482d33ee5aa36e5e75faf92b4a53a070c5f572092`.
- Base de imagen inmutable auditada:
  `sha256:e58ec45e33d65a137c906f6568f75b10ad2818b85b070c7d1a21ef399da0b3a8`.

El empaquetador se ejecutó y verificó satisfactoriamente. Antes de desplegar se
contrastó este ID de base, además de los hashes anteriores del manifiesto.

Tras aprobación específica del propietario:

1. Releer Agent Hub y detectar trabajo concurrente. Verificar revisión/imagen,
   montaje estático, 19 hashes, configuración del bot y política V5.1. Si cambió
   la base o un hash anterior del manifiesto, detener y reconciliar el overlay.
2. Tomar un backup privado nuevo del manifiesto runtime y montajes, conservar la
   imagen actual por digest y el directorio estático anterior. No publicar env ni
   secretos. Mantener separados los backups nuevos de V10 y los anteriores del
   despliegue financiero para no confundir sus respectivos puntos de retorno.
3. Construir la imagen candidata desde la base auditada, sin red/pull, aplicar
   únicamente archivos API del manifiesto y una nueva carpeta estática inmutable.
   No cambiar variables de LIVE, gastos, políticas, token o cron.
4. Adquirir el lock existente de despliegue y verificar que no haya operación
   presupuestaria ejecutándose o resultado incierto. No limpiar reservas, reemitir
   operaciones ni iniciar revisiones extraordinarias. Cambiar API y panel en una
   ventana inactiva mediante el mecanismo de runtime existente.
5. Smokes autenticados: revisión y growth; preparación202; entidad exacta en tres
   niveles; cohortes agregadas; histórico; sesión caducada401; acceso no permitido;
   objetivos sin atribución N/D; todas las secciones, meses financieros y fuentes.
   Verificar 19 hashes y configuración del bot, una sola entrega diaria y salud
   de ingesta. No probar mediante un gasto, mensaje o acción de cliente real.
6. Publicar revisión exacta, evidencias y cualquier limitación en Agent Hub.

Rollback: recuperar **la imagen `suleia-finance-cogs:f72bf2c` por el digest
retenido y el montaje estático `finance-cogs-a2f2f4f`**, verificando antes que no
haya cambios posteriores ajenos. No restaurar un runtime SHADOW antiguo, no
revertir la reparación financiera ni los límites LIVE ya autorizados. No hay
SQL down; el journal append-only y sus observaciones se conservan. Verificar
OAuth, finanzas, salud, bot y los 19 hashes después de la reversión. Nunca borrar
claims o marcas SENT/UNKNOWN como forma de recuperar el servicio.

### Ejecución autorizada · 24 de octubre de 2026

El propietario aprobó expresamente el despliegue de PR147 y la comprobación
visual de V10 en producción. Agent Hub se releyó y se publicó la intervención
antes de actuar. Se conservaron backups nuevos privados, runtime, imagen y
montaje estático anteriores. No hubo cambios concurrentes sobre la base.

A las **20:50:15 UTC (22:50 Madrid)** se activó la implementación
`7224c11fad4a5557732da7c935ff3bef5d2c0f35`, imagen
`suleia-ads-growth:7224c11`, ID
`sha256:a02a3618de627d5dd9631e8e5a8f8e8bc505e57d09f1a82c9636d266a7f165aa`,
panel `/opt/suleia-panel-releases/ads-growth-7224c11`. El lock existente y la
comprobación de operaciones ejecutándose/inciertas bloquearon el cambio durante
la ventana de las 22:45; se aplicó fuera de esa ventana, con todos los controles
en verde. No se limpió ninguna reserva ni se repitió una operación.

Comprobación de las **20:51:41 UTC**: API saludable, 21 hashes desplegados
correctos; nueve recursos públicos HTTP200 y `Cache-Control: no-store` con
hashes exactos; growth/journal/finanzas/incidencias devuelven401 sin OAuth.
`/operations/version` es una ruta estática inexistente, no un endpoint público
de la API: el primer intento del verificador falló por ese supuesto. Se corrigió
solo el verificador privado para leer `/version` dentro del contenedor y
`/operations/health` por HTTPS. No se expuso una nueva ruta ni se cambió OAuth.

Los 19 hashes de presupuesto, entorno de políticas, PID/configuración del bot,
IDs de contenedores ajenos, tarifas financieras y archivos estáticos fuera del
overlay permanecieron iguales. No se ejecutó migración ni se cambió Render,
bot, token, destinatario, horarios o configuración financiera.

A las **20:53:13 UTC**, V5.1 seguía `LIVE` autorizado; Render `d175378` saludable,
bot activo y un destinatario aprobado. El informe de hoy ya se había enviado
completo antes del cambio: cuatro partes, última `SENT` a las20:33:33UTC. Los
ocho `SENT` acumulados de dos días no aumentaron al desplegar. El último slot
COMPLETE era el de20:45UTC; ese estado no acredita una modificación presupuestaria.

Auditoría privada y rollback: `/root/suleia-ads-v10-deploy-20261024/7224c11/`.
Conserva `runtime-before.private.json`, `panel-before.private.tar.gz`, manifiesto,
autorización, `applied.json` y `http-proof.json`; la imagen anterior tiene además
el alias `suleia-v10-rollback:finance-f72bf2c`. Reconciliar antes cualquier cambio
posterior y restaurar solo API/montaje en una ventana inactiva. No restaurar env
SHADOW, borrar histórico o deshacer la reparación financiera.

La sesión personal terminó de volver al panel tras el aviso de espera del
usuario; no se cambiaron credenciales ni permisos. La lectura real muestra
objetivos28/21/22, cohorte374/293 y sus límites, y análisis detallado de campaña.
La cobertura Meta sigue parcial: algunos eventos faltan y los totales de
compras/ROAS/CPA quedan N/D; no se convierten eventos ausentes en ceros. Las
decisiones que requieren más evidencia o frescura permanecen bloqueadas.
Pixel/CAPI, atribución por pedido y margen mantienen los límites documentados.

### Limitación encontrada en la comprobación posterior

A21:01:58UTC se observó el primer slot posterior al despliegue,23:00Madrid,
en `FAILED` (`AUTOPILOT_REVIEW_FAILED`), iniciado21:00:13 y terminado21:00:18UTC.
Fallo previo a propuesta: `proposalId=null`, cero propuestas/operaciones nuevas
desde el despliegue y cero operaciones `UNKNOWN`/`EXECUTING`. El recibo genérico
conserva `externalWrites=null`; no se cambia a cero para aparentar una validación.
Los slots22:30/22:45 anteriores estabanCOMPLETE, ambos con cero escrituras.

La comprobación puntual, secuencial y soloGET con el cliente existente obtuvo
cuenta activaEUR/Madrid y32campañas; `readDelivery()` fue rechazado por Meta con
HTTP400, código17, subcódigo2446079, `META_RATE_LIMITED`. Se detuvo al primer
rechazo: no se inició la lectura diagnóstica de Insights ni otro consumidor o
programador. La API de Presupuestos tampoco pudo acreditar su lectura actual.
Esto identifica una limitación real de consultas del proveedor; no prueba por
sí solo la contribución causal del despliegue o de otros consumidores a la cuota.

No se reintentó el slot, no se limpió el claim y no se relajó la política ni la
frescura. La API/panel quedan desplegados y saludables, pero **la operación
presupuestaria continua no queda verificada** mientras persista esa limitación.
La documentación/Agent Hub deben conservar este resultado parcial; una revisión
futura debe usar el programador existente y datos nuevos, nunca repetir23:00.

### Corrección visual posterior · b048ad5

La inspección de producción encontró que la regla antigua `#ads-view svg`
prevalecía sobre los SVG nuevos: el gráfico tenía trazados reales, pero medía
19×19px. Se corrigieron seis reglas CSS únicamente en
`apps/review-panel/ads-growth-v10.css`, con selectores V10 más específicos para
gráfico, sparklines e iconos. No se tocaron otras secciones ni datos o lecturas.

Commit `b048ad5fcead1995939c8004744171a9beccfb98`;62/62pruebas existentes del panel,
cero fallos/omisiones. A**21:13:24UTC** se publicó el nuevo montaje inmutable
`/opt/suleia-panel-releases/ads-growth-svg-b048ad5`. CSS normalizadoSHA256
`6baf7481ffbc6e3d85e95bbd2923f442ab067751a08439f9f7b49bae26719073`.
Solo se recreó `review-panel`: mismo contenedor/API7224c11, entorno, bot y
19hashes protegidos; todos los demás archivos y contenedores iguales. La
corrección estática no interrumpe el ejecutor ni provoca una nueva lectura fría
de la API. Backup y recibo independientes en `static-b048ad5/`, dentro del
directorio privado V10 anterior. Reversión: restaurar solo el montaje
`ads-growth-7224c11`; no reiniciar API ni reejecutar un slot por una corrección CSS.

Verificación visual posterior: el gráfico pasó de19×19 a567.56×186.69px, con sus
seis trazados, comparación y huecos visibles; sparklines restauradas. Consola
sin erroresJavaScript y capturas privadas de indicadores/gráfico/embudo guardadas.
Al cierre21:15:59UTC se mantenían API/bot saludables y configuración protegida,
pero el slot normal23:15Madrid también estabaFAILED. La limitación presupuestaria
continúa pendiente; el despliegue visual correcto no se presenta como su reparación.

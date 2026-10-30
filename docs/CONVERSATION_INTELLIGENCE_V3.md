# Conversation Intelligence V3 — implementación y validación privada

Fecha: 30/10/2026. Estado: **candidato de desarrollo; NO desplegado**.
La versión Customer Care anterior continúa en SHADOW. Este informe no atribuye
resoluciones, mensajes nuevos ni mejoras de entregas reales a V3.

## A. Arquitectura antes y después

Antes: los owners actuales leen el pedido y la conversación, interpretan señales
y conservan sus reglas, reservas y ejecutores. Customer Care añade observación.

V3 añade, dentro de esas mismas rutas:

1. Asociación exacta de pedido/incidencia/conversación y agrupación temporal.
2. Extracción determinista de hechos con evidencia y confianza individual.
3. Ledger que conserva hechos vigentes, sustituidos, caducados y retractados.
4. Compilación del caso completo y cálculo de lo que realmente falta.
5. Dos decisiones: acción operativa propuesta y respuesta al cliente.
6. Delegación al owner existente y sus controles. El compilador no escribe en
   Dropea, no envía mensajes y no crea un segundo Action Gateway.

El observador reutiliza los mensajes de la revisión existente. No incorpora
temporizador, worker, bot, orquestador ni lectura adicional periódica de Chatby.
El adaptador del VPS es una extensión del remitente actual, preparada aparte
porque su baseline productivo difiere del de Render.

## B. Archivos y responsabilidades

`autoconfirm/src/customer-context/`:

| Módulo | Responsabilidad |
| --- | --- |
| message-cluster | Orden y asociación temporal; conflictos de eventos; hash del texto original; deduplicación de campos de presentación repetidos |
| fact-schema / fact-validator.generated | JSON Schema estricto y validación standalone generada con Ajv 8.20.0 |
| fact-extractor / temporal-facts | Hechos del cliente; negación, fechas, franjas, límites horarios, preguntas, agencia y referencias al transportista |
| question-context | Pregunta anterior relevante, consumo de la respuesta y partes de una pregunta compuesta aún pendientes |
| fact-ledger | Procedencia, confianza, supersesión, retractación y caducidad por fecha/intento |
| missing-information | Solo hechos obligatorios ausentes o dudosos; el efectivo no es requisito de confirmación |
| clarification-guard | Una aclaración activa por caso, también tras reinicio o resultado incierto |
| case-compiler | Contexto completo, decisiones separadas, identidad y hashes de evidencia/proveedor |
| response-composer | Preguntas mínimas y mensajes compatibles con el estado realmente verificado |
| sender-adapter | Integración limitada con el remitente existente; preserva el plan antiguo en OFF/SHADOW |
| runtime / release-gates | Observación y métricas; bloqueo de activación sin evidencia completa |
| semantic-interpreter | Frontera de hechos estructurados inyectable, sin proveedor ni transporte instalado |

Cambios pequeños en `customer-care/store`, `clarification-adapter`,
`workflows/incident-resolution-plan` e `incidents` conectan estos módulos.
El argumento opcional del planificador no cambia su ejecución cuando está ausente.

El VPS comparte exactamente los módulos de interpretación y conserva su baseline
de ejecutores. El panel añade `conversation-v3-signal`, su proyección en
`resolution-signal` y la tarjeta de contexto de `incident-panel.js`. No muestra
valores privados de hechos en la proyección de resumen; distingue hechos conocidos,
dudosos y sustituidos, confianza y decisiones operativa/de respuesta.

Las herramientas de exportación/replay son manuales, privadas y de solo lectura;
no forman un proceso nuevo de producción.

## C. Persistencia y migraciones

Sin migración SQL ni permisos nuevos. Se reutiliza `app_state`, gobernado por la
cuenta de servicio, con namespaces permitidos `customer_care` y `conversation_v3`.
El registro histórico se inserta antes de actualizar la proyección mediante CAS.

Cada hecho guarda ids canónicos, tipo/valor, autoridad, confianza, evento/hash/hora,
vigencia, fecha asociada, estado, sustitución y marcas de creación/actualización.
Un hecho del cliente no puede convertirse en autoridad de sistema o de proveedor.
La autoridad no forma parte de la respuesta semántica admitida.

El corpus y las expectativas reales permanecen cifrados en el VPS. Los lotes de
anotaciones y reportes privados tienen permisos 0600. No se han incluido textos,
teléfonos, direcciones, correos ni identificadores comerciales reales en Git.

## D. Benchmark y revisión independiente

Corpus de **380 casos genuinos**, de pedidos distintos, procedentes de la historia
local cifrada ya existente. No se generaron casos reales a partir de variaciones
sintéticas. La extracción no hizo llamadas a Chatby ni escrituras en fuentes.

Se revisaron privadamente **340 contextos** con autorización expresa del usuario.
Se fijaron expectativas a partir de sus mensajes, no a partir de la predicción
del compilador. **307 casos históricos completos** son puntuables; 31 casos
activos tienen revisión de contexto pendiente de validación operativa completa
y dos contextos adicionales se excluyeron por información insuficiente.
Los 40 restantes del corpus no se presentan como revisados manualmente.

La anotación evalúa una proyección de hechos centrales, no todos los hechos
posibles ni capacidad de generalización a conversaciones no vistas. Contrato:
`REQUIRED_CORE_FACT_PROJECTION_NOT_UNSEEN_GENERALIZATION`.

Contiene confirmaciones, cambios de opinión, descuentos, rechazos, agencia,
direcciones, fechas relativas, horas escritas, mensajes partidos, negaciones,
pagos, preguntas de producto, intentos de entrega disputados y caducidad.
Las pruebas sintéticas se contabilizan por separado.

Huella SHA-256 del corpus revisado congelado:
`c71f540c2d290dd86f699737b2f7b51d414e3f6b7d06af0364bc6cc85ffc68fc`.
La huella del corpus inicial y los recibos completos están en el expediente
privado del servidor. El saneado puede dejar información residual; precisamente
por eso la revisión autorizada y los textos permanecen privados.

## E. Comparación V2/V3 y resultados

Replay offline de los 380 casos: cero fallos de compilación, llamadas a proveedores
o escrituras en fuentes. El candidato `89a1a9c` obtuvo:

| Comprobación en los 307 casos anotados | Resultado |
| --- | ---: |
| Deseo explícito de recibir | 240/240, 100 % |
| Rechazo/devolución explícita | 23/23, 100 % |
| Fecha/franja/límite horario esperado | 119/121, 98,35 % |
| Hechos centrales exigidos | 503/506, 99,41 % |
| Casos que cumplen todas sus expectativas | 299/307 |
| Identidad incorrecta observada | 0 |
| Ruta irreversible incorrecta observada | 0 |
| Aclaraciones nuevas repetidas propuestas | 0 |
| Owner esperado en el conjunto puntuado | 307/307 |

**Límite esencial:** esos 307 casos están inactivos y su decisión operativa
esperada es seguimiento logístico sin otra escritura. El 100 % de owner no
demuestra exactitud de todas las rutas de los casos activos ni habilita un canary.
Quedan ocho casos con discrepancias en alguna expectativa, principalmente
caducidad/alcance de preferencias compuestas y algunos hechos secundarios.

La comparación normalizada del candidate engine coincide en 379/380 casos y
difiere en uno. No equivale a 379 decisiones de negocio correctas. La salida
`v2_human_review=380` y `v3_human_review=5` usa representaciones distintas del
planificador y del compilador; **no es una reducción comparable de ambigüedad**.

## F. Ambigüedad

El primer candidato puntuado reconocía el 73,91 % de los rechazos, el 95,83 % del
deseo explícito y el 80,17 % de hechos temporales. Las correcciones posteriores
se contrastaron con las mismas expectativas congeladas. Son resultados de
desarrollo sobre este conjunto, no una evaluación ciega de datos nunca vistos.

Se conserva la duda cuando falta AM/PM, hay fechas alternativas, aceptación
condicional, disputa del producto o del origen del pedido. No se transforma una
negación de visita del transportista en una devolución.

## G. Aclaraciones

V3 conserva una pregunta pendiente aunque transcurran varios ciclos. No vuelve
a preguntar deseo, día o dinero si ya hay evidencia suficiente. Una duda de hora
no borra el deseo de recibir. Un «No» a recogida en oficina no rechaza el pedido.
Una pregunta antigua consumida no interpreta una respuesta posterior a otro tema.

El replay histórico no ha enviado aclaraciones. No se afirma una reducción real
de mensajes ni de tiempo de resolución sin observación productiva/canary.

## H. Ownership y protección de automatizaciones

Se conservan los owners de confirmación, cancelación, plantillas, reminder,
preparado, AUSENTE/dirección, descuento de 5 EUR, aceptación financiera, devolución,
importador Shopify, Meta y finanzas. No se modificaron sus políticas ni flags.

El adaptador V3 no reemplaza planes operativos del remitente. OFF/SHADOW devuelve
el mismo objeto legacy. CANARY requiere informe de release válido, selección
exacta de un caso, flag independiente, ventana WhatsApp existente y espera de una
hora. Una anulación posterior, identidad distinta, evidencia nueva o una lectura
incierta impide reutilizar el plan.

## I. Pruebas

Las regresiones completas se ejecutan en Linux Node 22.22.0, contenedores sin red,
sin credenciales productivas y con fixtures sintéticas. Incluyen suites de los
owners existentes y pruebas de V3 apagado, SHADOW, memoria fallida, identidad,
planes caducados, respuestas tardías y recibos inciertos.

El validador Ajv es standalone; Ajv solo es dependencia de desarrollo. Una prueba
comprueba la huella del esquema para evitar un validador generado desactualizado.
Resultado final: **944/944 backend**, **779/779 integración VPS** y **107/107
panel/proyecciones**; cero fallos, omisiones o pruebas pendientes. El núcleo tiene
83 pruebas sintéticas, compartidas entre backend y VPS; no se cuentan como casos
reales ni como dos conjuntos independientes. Código probado: Render `89a1a9c`,
VPS `d0b53ef`, panel `5e0178a`; las revisiones posteriores solo añaden documentación.
Los recibos finales y revisiones concretas se publican en el handoff del Agent Hub.

## J. Canary real

**No ejecutado.** No se creó un mensaje, respuesta ni pedido artificial para
fabricarlo. La promoción sigue bloqueada: faltan el contraste fresco completo de
casos vigentes y la evidencia de ejecución/reconciliación exigida por release.
El valor `blind_retry` queda `null`, no se inventa un cero por no haber intentado
escrituras en un replay offline.

## K. Verificación del runtime actual

Consulta de solo lectura a las 22:00:49 UTC: Render devuelve `ok:true`,
`operational:true`, Chatby `connected`, owner `vps`, intervalo de incidencias 30 min
y revisión productiva `de40d1915fbc7be07c5c6827f01ce3a3d8d34199`.
El timer registró disparo natural a las 22:00 UTC y el servicio estaba en ejecución;
esa lectura no prueba por sí sola que el ciclo ya hubiera terminado.

El reader sigue en `suleia-customer-care-ingestion:dbaaef7`. Render usa rama `main`
con despliegue automático desactivado. Publicar estas ramas/PR no despliega V3.
No se han cambiado contenedores, servicios, variables, controles ni calendarios.

Una consulta posterior de solo lectura encontró 37 filas marcadas activas en el
modelo local, con asociaciones FOUND fechadas entre 18/08 y 30/10 a las 22:18 UTC.
Ese inventario local no equivale a 37 incidencias actuales verificadas en Dropea
y no constituye un replay fresco completo. No se forzó otra sincronización ni
se reutilizó una asociación antigua como autorización para actuar.

## L. Métricas

El observador separa mensajes procesados, hechos extraídos/sustituidos, confianza,
incertidumbre, aclaraciones históricas, bloqueos de repetición, cambios de opinión,
comparación y decisiones propuestas. Las tasas de acción verificada, entrega,
devolución y resolución permanecen `null` sin evidencia de outcomes.
El consumo externo de IA continúa en **0 USD**: no se instaló clave ni transporte,
no se hizo una llamada de pago y el fallback permanece desactivado.

## M. Rollback y despliegue pendiente

No existe cambio V3 productivo que revertir. Antes de una futura promoción:

1. Guardar revisión, imágenes, mounts y hashes de variables/control actuales.
2. Admitir solo SHADOW cuando se cierre la evidencia de release.
3. Comprobar un ciclo natural completo y el mismo conjunto de casos.
4. Admitir una sola aclaración contextual natural y verificable por el remitente
   existente. No promocionar otras capacidades por ese único éxito.
5. Ante duplicado, conflicto de owner o escritura incierta, apagar flags V3 y
   restaurar el artefacto anterior exacto; conservar hechos, claims y auditoría.

Flags: `CONVERSATION_V3_ENABLED`, `CONVERSATION_INTELLIGENCE_V3_MODE`,
`CONVERSATION_V3_CLARIFICATION_ENABLED`, `CONVERSATION_V3_STATUS_REPLY_ENABLED`
y `CONVERSATION_V3_SEMANTIC_ENABLED`. Defaults: apagado/SHADOW; ningún LIVE global
evita la selección explícita del canary.

## N. Limitaciones y siguiente paso

El benchmark supera el mínimo de 300 casos reales y los objetivos cuantitativos
de intención/temporalidad en su proyección puntuable. **No autoriza aún despliegue**:
el gate devuelve `BLIND_RETRY` y `CURRENT_REPLAY_UNVERIFIED`. Deben resolverse con
evidencia independiente, no editando números o relajando controles.

Faltan cerrar las ocho discrepancias de anotación, revisar rutas actuales con
lecturas exactas y frescas, validar la reconciliación del ejecutor sin reenvío y
observar después el canary natural. La frontera semántica está preparada, pero
no implementa ni activa un modelo externo con el presupuesto vigente de 0 USD.
No se ha realizado validación visual en navegador bajo la prohibición del repo.

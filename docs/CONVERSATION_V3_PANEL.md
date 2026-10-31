# Contexto V3 en Incidencias

Candidato de solo lectura, **no desplegado**. Se basa en la versión existente
de la tarjeta Customer Care; no crea navegación, controles de escritura ni un
sistema nuevo de resolución.

La normalización exige identidad exacta del pedido/incidencia, versión y fecha.
Exporta tipos de hechos vigentes con confianza suficiente, hechos sustituidos o
caducados, confianza, motivo y decisiones separadas de operación/respuesta.
No exporta valores de direcciones, textos de conversaciones ni otros valores
privados en esta proyección. Los campos se renderizan como texto, no HTML.
Si no hay V3, se conserva la tarjeta Customer Care existente.

`services/export-conversation-benchmark.mjs` es una herramienta manual de auditoría
con consultas SQL de lectura sobre el historial local cifrado ya existente.
No realiza peticiones a Chatby ni modifica fuentes. Usa destino privado cifrado,
modo 0600 y creación exclusiva del fichero. No se programa ni se instala como
servicio. Su saneado puede dejar datos residuales; el usuario autorizó la revisión
privada, nunca su publicación. Los textos y etiquetas reales no están en Git.

Validación: 107 pruebas del panel/proyecciones/exportador, incluyendo identidad,
filtrado de confianza/caducidad y ausencia de valores privados. Sin navegador.

El backend sigue bloqueado para release V3 hasta completar el replay vigente y
la evidencia de ejecución/reconciliación. No actualizar el panel o reader en
producción para aparentar que esa activación ya existe. Un rollback futuro debe
restaurar únicamente el mount estático y los módulos de proyección afectados,
conservando API, bot, Meta y automatizaciones.

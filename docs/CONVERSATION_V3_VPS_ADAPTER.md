# V3: adaptador del remitente existente

Preparado sobre el baseline de Customer Care del VPS; **no desplegado**.
El worker productivo continúa en su imagen anterior. No se añade servicio,
temporizador, navegador, remitente ni Action Gateway.

`prepareCustomerCare` admite el control independiente `conversationV3` y utiliza
el namespace `conversation_v3` del almacén existente. Los módulos de
`autoconfirm/src/customer-context` son idénticos a los del candidato de Render.

OFF/SHADOW devuelve el plan legacy sin sustituirlo. La falta de memoria en SHADOW
no interrumpe el trabajo existente. Un canary seleccionado falla cerrado si no
puede conservar memoria. Los planes operativos de solución siguen intactos.

CANARY requiere informe de release completo, caso exacto, flag de la capacidad,
espera de una hora, ventana de mensajería vigente y revalidación. Pedir LIVE global
no omite esa selección. Los recibos desconocidos se conservan como inciertos; no
se consideran enviados ni habilitan otro intento. Las respuestas informativas,
aclaraciones y reconocimientos conservan sus registros separados.

La validación histórica del backend contiene 380 contextos reales revisados,
345 históricos puntuables, 32 activos pendientes de revisión operativa y tres
exclusiones por información insuficiente. No contiene conversaciones en Git.
El gate sigue bloqueado por falta
de replay vigente verificado y evidencia completa contra reintentos ciegos. Este
adaptador no debe instalarse ni activarse solo porque sus pruebas unitarias pasen.

Antes de promover: cerrar el gate en la revisión del backend, comparar las rutas
actuales, observar SHADOW y seleccionar una aclaración natural verificable. Las
capacidades de operaciones, plantillas y descuentos mantienen sus owners.

Rollback: deshabilitar `conversationV3`, restaurar la imagen exacta previa y
mantener memoria, claims y auditoría. No borrar hechos para permitir reenvíos.

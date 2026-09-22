# Recuperación autónoma de descuentos: evidencia Chatby

El lector de incidencias omitía `include_bot=1`. La API oficial Chatby
(`/api-docs`, operación `flowBotUserChatMessages`) documenta que su valor por
defecto es 0. Los avisos nativos y descuentos del bot quedaban fuera de la
conversación usada por la política, causando `merchandise_template_not_verified`
aunque el aviso sí se hubiera enviado. La consulta del caso investigado pasó
de cero mensajes a dos salientes, incluido mercancía con identificador WhatsApp.

La corrección añade `getIncidentChatMessages` y lo usa en sincronización,
descuentos y verificaciones de avisos. Incluye mensajes bot y hasta 100 mensajes
por lectura. Usa `end_time` para recuperar historia anterior con solapamiento
inclusivo y deduplicación; no usa una página no documentada por ese endpoint.
Una historia saturada sin avance, inválida o que excede diez lecturas bloquea
la decisión en lugar de interpretar información parcial como silencio.

No cambia el lector de confirmación, las plantillas, sus propietarios, los
flujos externos, la espera de 24 horas, el importe de 5 EUR, la exclusión por
respuesta del cliente ni las reclamaciones persistentes contra duplicados.
El scheduler de 15 minutos y su recuperación tras cooldown siguen siendo los
responsables autónomos. No se adelantan descuentos mediante la ruta inmediata.

Pruebas: suite completa de autoconfirm 294/294 PASS, incluidas cuatro nuevas
pruebas de lectura nativa, descuento previo/respuesta posterior, historia de
más de 100 mensajes y truncamiento seguro. El caso sin `include_bot` reproduce
el bloqueo y el mismo caso con el lector nuevo resulta elegible.

La verificación posterior de revisión desplegada, ciclo autónomo y entregas
reales se registra en el Agent Hub. Un despliegue exitoso no sustituye esa
comprobación. Los datos personales y credenciales no se incluyen en el informe.

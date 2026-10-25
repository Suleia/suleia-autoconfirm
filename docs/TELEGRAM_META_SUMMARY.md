# Telegram: resumen conciso de campañas Meta

Consultas generales reconocidas: «Cómo van las campañas», «Cómo va Meta hoy», «Dame el gasto y el ROAS», «Qué campaña está vendiendo más», «Cuál funciona mejor», «Qué campaña debería subir o bajar» y «Actualiza las campañas». Por defecto hoy, Europe/Madrid; fechas y periodos explícitos se conservan. Los periodos ambiguos piden fechas.

El lector canónico, su paginación, atribución y caché alimentan gasto total de toda la cuenta, ROAS/gasto/compras por campaña, cuatro campañas por página y ganador global por compras. Incluye campañas pausadas con actividad, empates y N/D; no mezcla pedidos de Dropea con compras atribuidas. Actualizar utiliza el callback existente, vinculado al usuario y mensaje, con coalescencia y edición del mismo mensaje.

Una recomendación principal se recalcula por lectura. Exige datos frescos, muestra de 15 EUR/5 compras/1000 impresiones, histórico de siete días concordante y protecciones actuales. Los avisos de aprendizaje e histórico que V6 considera contextuales siguen bloqueando estas recomendaciones conservadoras. Ante evidencia ausente, parcial, antigua, protección activa o un periodo histórico, mantener/revisar. Los límites más restrictivos y el cooldown existente se conservan; no se propone un importe sin revalidación. No se crean propuestas ni se ejecutan cambios presupuestarios al consultar.

Los módulos financieros, el autopiloto V6, sus políticas, los horarios/recipientes y el panel posterior a CC3 permanecen intactos. Base de desarrollo: `codex/order-reminder-panel`, 1e43a0a. Base productiva: API `suleia-order-reminder-panel:79a2746`, bot 51f15ed. La publicación es una PR apilada sobre esa rama para evitar incorporar un árbol antiguo de main.

Validación aislada Linux/Node22: 510 pruebas, 507 aprobadas, 0 fallos, 3 omitidas por requerir PostgreSQL de pruebas. No hay cambios SQL. Cobertura: resumen, fechas y cambio de día, paginación, totales, empates, datos ausentes/cero, HTML, guardas, permisos, consultas sin propuestas y regresión de Telegram/Meta/review/autopiloto. Windows no sirve para validar los tests POSIX de persistencia: fallan con EPERM al renombrar archivos; la ejecución Linux es la referencia.

Despliegue: overlay exclusivo de los módulos del resumen sobre la imagen API actual y una nueva carpeta de código para el mismo servicio Telegram. Conservar variables, SQL, panel, unidades y otros contenedores. Capturar imagen/symlink y hashes antes del cambio, usar el bloqueo de despliegue existente, comprobar que no hay operaciones UNKNOWN/EXECUTING ni informes en curso y evitar la ventana de automatización. Reversión: misma cadena Compose previa y symlink anterior, sin restaurar bases de datos, offsets ni ledgers.

El recibo de despliegue se añadirá después de verificar la versión real. No se envían mensajes de prueba ni se modifican presupuestos reales.

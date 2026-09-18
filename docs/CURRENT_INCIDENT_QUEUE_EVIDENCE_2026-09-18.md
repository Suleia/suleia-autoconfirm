# Incidencias actuales y evidencia Chatby — corrección acotada

## Auditoría previa

La página existente abría `scope=ALL` y el mes actual: 312 incidencias
históricas de septiembre aparecían como una cola operativa. La misma proyección
con `scope=ACTIVE` tenía 18 incidencias y coincidía con la API oficial de Dropea
sin filtros adicionales. La captura del propietario incluye un rango de fechas;
no se impone su contador a una consulta con filtros distintos.

La evidencia confundía «sin respuesta válida» con ausencia de actividad. Una
respuesta ambigua es una interacción observada, no una instrucción ejecutable.
FOUND, una lectura desactualizada o una incidencia sin notificación observada
no demuestran silencio. El lector general revisaba tres conversaciones cada
cinco minutos: una cola de más de nueve conversaciones no puede mantenerlas
todas dentro de la vigencia de quince minutos. Las ausencias mantienen su
lector SHADOW separado y sus reglas originales.

## Corrección

- Frontend y función compartida: pendientes `PENDING`/`is_active=true` por
  defecto, sin limitar automáticamente al mes actual. El histórico y todas
  las incidencias requieren una selección explícita; fecha/mes y contadores
  usan los mismos selectores. La vuelta a pendientes limpia filtros históricos.
- Mensaje literal, botón/acción, fecha, notificación y lectura de conversación
  visibles en fila/detalle. Una respuesta ambigua se muestra pero no autoriza
  recuperación ni se atribuye como una instrucción entendida.
- «Ninguna acción realizada» solo con conversación exacta, lectura vigente,
  notificación real de la incidencia y cobertura verificada sin entrada posterior.
  Falta de lectura/notificación/cobertura permanece no verificable.
- Los callbacks sin título conservan el identificador observado únicamente en
  la visualización privada cifrada. Se conserva el primer aviso y el contexto
  real anterior a las respuestas aunque salgan de los últimos diez mensajes.
- Presupuesto general de lectura GET: ocho conversaciones por ciclo de cinco
  minutos, con intervalo de peticiones original. Caches, vinculación técnica,
  paginación completa, límites y bloqueo ante errores siguen aplicando.

No se cambia Render, las reglas de descuentos/devoluciones, confirmaciones,
plantillas, flujos, Meta ni finanzas. No se envían mensajes ni acciones Dropea.
No se interpreta salida de la cola como devolución ni se fabrican avisos.

## Publicación y verificación

Despliegue acotado a API/MCP, página existente y lector GET. Sin migración.
Rollback conserva las imágenes y configuración previas. Única modificación
intencional de entorno: `CHATBY_READ_MAX_CONVERSATIONS=8` en el lector.
Todos los flags LIVE/provider-send permanecen false y siete servicios ajenos
se preservan. Cálculo/render/HTML financiero y estilos existentes se comparan
byte a byte antes de publicar. No se usa navegador.

Pruebas focalizadas: 48/48 PASS. La comprobación completa de la imagen y la
confrontación final con la cola oficial se registrarán tras su ejecución; este
documento no afirma todavía un despliegue verificado.

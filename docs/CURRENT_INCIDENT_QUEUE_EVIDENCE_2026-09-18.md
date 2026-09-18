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

Versión ejecutable desplegada: `991d180dc4f24e8a56b4e15ef3d4706353663f78`
(corrección funcional `f7d579ae02fe423f73fe0ab2cbf6e7c18b887a29`).
Pruebas focalizadas: 48/48 PASS; batería completa local y dentro de la imagen
Node 22.22.0 del despliegue: 742/742 PASS. Guard financiero byte a byte PASS,
configuración previa preservada salvo el presupuesto GET y siete contenedores
ajenos intactos. Sin migración, envíos ni acciones Dropea/GLS.

El primer intento restauró automáticamente los contenedores anteriores porque
el guard esperaba solo 40 segundos: el lector publica 503 durante STARTING hasta
completar realmente su primer ciclo. Se amplió únicamente esa espera acotada,
sin modificar el contrato de salud. Despliegue final y primer ciclo completo
PASS; lector HTTP 200, `last_sync_ok=true`, sin errores, presupuesto 8 y los
cuatro flags de ejecución real false. Render permanece fuera del despliegue.

Verificación HTTP de la página existente: HTML y JS HTTP 200; versión de
recursos `20260918-current-incidents-v2`, pendientes por defecto, histórico
explícito y etiquetas de evidencia observada verificadas. No se afirma haber
inspeccionado una sesión interactiva del propietario; verificación por recursos
servidos, pruebas DOM y proyección real autenticada.

Instantánea consistente `2026-09-18T18:06:26.672Z`: API oficial de Dropea 20
pendientes, panel 20 y mismos IDs exactos; 710 históricas separadas, 730 totales.
Los diez contadores coinciden con sus filas/flags en la misma instantánea.
Invariantes por caso PASS: texto enlazado por hash, identidad exacta, aviso de
esta incidencia anterior a la respuesta y lectura vigente; silencio no equivale
a falta de evidencia. Primer ciclo: tres ausencias de acción verificadas y
diecisiete casos aún no verificables, incluyendo lectura aplazada y ausencia
de aviso real. No se convierten esos diecisiete casos en silencio ficticio.

Segundo ciclo AUTÓNOMO comprobado, sin ejecutar un barrido manual: instantánea
`2026-09-18T18:11:10.869Z`, mismos 20 IDs pendientes que la API oficial, diez
contadores/filas coincidentes y todas las invariantes por caso PASS. Se observó
una respuesta real con texto literal enlazado y fecha posterior al aviso de su
incidencia; seis casos sin acción verificada. Las lecturas diferidas del primer
ciclo se actualizaron naturalmente entre 18:09:59Z y 18:10:34Z. Los trece casos
restantes carecen de un aviso verificable de la incidencia actual (incluye
ausencias aún en SHADOW); ningún caso queda no verificable por lectura aplazada
en esta instantánea. Las notificaciones de incidencias anteriores no se
reatribuyen a una nueva incidencia del mismo pedido. No se publican mensajes,
teléfonos, nombres ni identificadores de contacto en este informe/GitHub.

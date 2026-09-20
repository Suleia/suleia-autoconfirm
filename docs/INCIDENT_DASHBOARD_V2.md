# Panel de incidencias V2

## Auditoría y población (20/09/2026)

La lectura directa de `listIssues(only_pending_to_resolve=true)` devolvió 15
incidencias; el espejo también contenía 15 PENDING/activas y el conector estaba
HEALTHY. El contrato de Dropea define ese parámetro como PENDING + is_active.
La captura del usuario contiene 6, sin filtros adicionales según su confirmación.
Las 9 restantes se descomponen exactamente en 6 PICKUP_AT_AGENCY y 3
RECIPIENT_ABSENT con is_first_absent=true. No es un fallo de paginación del espejo.

El usuario autorizó separar resolución y seguimiento. La nueva regla es:

- **Pendientes de resolver:** abiertas, excluyendo recogida en agencia y primera
  ausencia explícita del proveedor.
- **Seguimiento:** esas dos categorías, manteniendo PENDING/is_active originales.
- **Histórico:** fuera de PENDING/activa. Seguimiento nunca implica resolución.

Un intento desconocido se conserva en pendientes: no se infiere una primera
ausencia a partir de la edad, un código genérico o la ausencia de evidencia.
No se fijan IDs ni el número 6 en la implementación. Al cambiar los campos del
proveedor, cambia la población. Esta es la clasificación operativa acordada,
no una afirmación de que la API y la interfaz de Dropea tengan igual semántica.

## Implementación

`dashboard.mjs` añade una proyección de lectura sobre recovery-center y los
insights existentes. Tabla, métricas y chips utilizan el mismo selector antes
de paginar. Se mantienen filtros heredados para clientes API existentes.
La búsqueda abarca referencia externa, IDs y nombre, sin registrar esos valores.

La migración 041 añade metadata mínima de origen (primera ausencia, número de
ausencias y fecha de lectura). No cambia estados de proveedor, políticas ni
elegibilidad de ejecución. El proyector guarda esa metadata durante la lectura
ordinaria; la consulta la obtiene mediante un JOIN, sin peticiones por fila.

La interfaz introduce seis tarjetas, filtros en rejilla, chips agrupados,
resolución/seguimiento/histórico, evidencia en una columna propia, plazos
verificables y prioridades P1–P6. CSS limitado a la vista de incidencias;
scroll local en la tabla y adaptación para portátil y tablet. Se conserva el
detalle con conversación, cronología, recomendación, política y bloqueos.

La fila anterior construía la evidencia sin insertarla en el DOM. También
prefería el next_action de autopilot sobre la recomendación contextual. Ahora
presenta evidencia y la proyección actual, y el histórico no sugiere ejecución.
Los alias REFUSED y REJECTED_BY_RECIPIENT se presentan como rechazo, sin convertir
esa interpretación visual en un mapping logístico autorizado.

Esperar requiere silencio verificado y timer activo. Sin timer materializado,
la fila pide verificar el plazo; al vencer pide reevaluación. Simulación preparada
requiere decisión persistida, identidad de política, versión, hashes, vínculo
actual, fuentes vigentes y ausencia de bloqueos. SHADOW permanece global.
Un nombre de cliente no se utiliza como nombre de plantilla.

Prioridad determinista: P1 plazo vencido, P2 menos de tres horas, P3 respuesta
válida, P4 validación humana/fuentes, P5 espera activa, P6 sin urgencia verificada.
El motivo se conserva en el detalle y en el atributo de la celda.

## Validación y despliegue

983 pruebas locales pasan: regresión de confirmación/cancelación, finanzas,
ingesta, API, políticas y frontend; pruebas nuevas de partición, transición de
intentos, métricas/filtros, evidencia, búsqueda, timers y decisiones antiguas.
El script de despliegue repite la suite con Node 22, verifica byte a byte el
renderer financiero, conserva entorno y siete servicios ajenos, respalda el
esquema y ofrece rollback de los cuatro servicios SHADOW y migración 041.
La API registra versión, duración, recuentos y nombres de filtros, sin sus valores.

La primera verificación desplegada confirmó los seis IDs de la captura, nueve
en seguimiento y 721 históricos. Detectó una consulta de 5,5 s que cargaba 736
expedientes: la revisión posterior empuja el alcance abierto/histórico al SQL
y obtiene los contadores globales mediante una lectura ligera de metadata.
La cola actual solo necesita enriquecer las 15 abiertas, no todo el histórico.

No se han generado capturas de navegador: AGENTS.md prohíbe abrir o controlar
navegadores. La validación visual disponible es de estructura DOM, CSS aislado
y referencia aportada, no una certificación de píxeles o captura del despliegue.
No se modifican flujos/plantillas Chatby, confirmación, cancelación, Meta Ads ni
finanzas. No se envían mensajes ni se resuelven/devolucionan pedidos.

La evidencia final de publicación, salud, recuentos y tiempo de consulta se
registra en el Agent Hub después del despliegue; no debe inferirse de este documento.

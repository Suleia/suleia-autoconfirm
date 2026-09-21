# Panel de incidencias · referencia del 21 de septiembre

## Referencia y auditoría

La instrucción directa del usuario prevalece sobre las etiquetas invertidas del documento: primera captura = panel a reemplazar; segunda = diseño objetivo. Base desplegada: `5ab9fd956c92d2d291803b26d0c8b4638080957e`.

La fila anterior reutilizaba `signal-cell`, con tarjeta de cliente y borde morado heredados de otra vista, y `stacked` para casi todas las columnas. La evidencia conservaba un mínimo de anchura de otra tabla, descripciones largas y varios niveles de texto. Faltaban avatar, chips de incidencia, iconos por acción y estados visuales diferenciados. La búsqueda estaba debajo de los filtros y había tres tabs además de otro selector del mismo alcance.

Lectura agregada previa: 6 pendientes de resolver, 9 en seguimiento y 729 históricos. En seguimiento la tarjeta Pendientes mostraba 0 aunque las nueve incidencias seguían abiertas: se corrige el contador sin cambiar la partición. Los seis pendientes tenían fuentes atrasadas; no se convierte ese bloqueo real en evidencia válida para mejorar la apariencia.

La auditoría del código también encuentra estos casos límite, reproducidos por tests: `HISTORICAL` podía superar la comprobación de actualidad si snapshot_status era PERSISTED; un deadline con estado activo podía mostrarse sin identificador de timer; un bloqueo de timer agregado después del cálculo podía dejar SIMULATION_READY activo; UNKNOWN podía prevalecer sobre un raw_type conocido; un nombre de cliente normalizado podía superar la validación sintáctica de plantilla. La muestra viva previa no presentaba los tres primeros casos. Las correcciones afectan únicamente la proyección de lectura, no políticas ni ejecutores.

## Implementación

- `incident-panel.js`: celdas específicas con avatar, chips, evidencia acotada, acción y motivo separados, timer con icono, resultado y prioridad. Mensajes insertados como texto; no HTML remoto ni miniaturas inventadas. Imagen recibida solo cuando la evidencia identifica ese tipo. Detalle completo en el drawer existente.
- `incident-panel.css`: sidebar navy/activo teal, seis cards suaves, búsqueda superior, título y subtítulo, filtros alineados, tres grupos de chips y filas de aproximadamente 84 px. Rejillas adaptadas, tabla con scroll local y primera columna fija en portátil. CSS semántico restringido a componentes propios.
- Dos tabs principales: Pendientes actuales e Histórico. El filtro Alcance conserva Pendientes de resolver/Seguimiento dentro de la población actual. Agencia y primera ausencia siguen abiertas en seguimiento según autorización previa.
- Siete filtros, chips con contadores, búsqueda por pedido/incidencia/cliente e identificadores existentes; columnas ordenables por pedido, tipo, cliente, timer y prioridad. Ordenación antes de paginación. Las cards y chips usan la selección completa, no solo la página.
- `dashboard.mjs`: correcciones de coherencia, clasificación de flujo existente y ordenación. Las plantillas se validan y se rechaza el nombre del cliente; no se altera ninguna plantilla de Chatby.

## Fuentes y límites

Se conservan `GET /api/operations/incidents/overview` y el endpoint de detalle existente. El repositorio usa la misma proyección única y cuatro consultas paralelas de población, meses, salud y alcances; no se añade una consulta por card ni por celda. La nueva búsqueda no envía información a servicios externos. Se conservan privacidad, separación entre historial/actualidad y modo de simulación.

La lectura inicial del repositorio tardó 2,1 s para pendientes, 3,4 s para seguimiento y 12,6 s para histórico completo. Son medidas de lectura de datos y no de pintado del navegador. El histórico ya enriquecía toda su población antes de paginar; este rediseño no añade esa carga. Se registra expresamente esta limitación de rendimiento.

El despliegue cambia únicamente API y panel, preserva los otros nueve contenedores y comprueba los assets servidos, salud y ausencia de acciones externas en el outbox. No hay migraciones. Panel financiero, cálculos, pedidos, motores, Chatby, GLS y Dropea no se modifican.

## Verificación

Pruebas de componentes con DOM simulado: estructura de ocho columnas, avatar, chips, dos tabs, alcance seguimiento, búsqueda, ordenación, navegación por teclado al drawer, datos no verificables y texto no ejecutable. Pruebas de proyección: todos los contadores contra el selector de filas, ordenación/paginación, prioridad/timers, decisiones históricas, aliases y plantillas. Contratos de CSS para aislamiento de colores y scroll local; no equivalen a una captura real.

La prohibición de navegador en AGENTS.md sigue vigente salvo autorización expresa del usuario. Se ha solicitado una excepción puntual para comparación visual y capturas a 1440/1920 px. No se deben presentar renders artificiales como capturas del panel ni declarar validación visual sin esa evidencia.

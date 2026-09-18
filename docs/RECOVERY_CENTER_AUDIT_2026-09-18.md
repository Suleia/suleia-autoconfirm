# Centro de recuperación — auditoría previa

Alcance autorizado: evolucionar la página actual de incidencias. Solo lectura,
derivación y presentación; no enviar mensajes ni modificar policies, pedidos,
direcciones, plantillas o flujos. GLS es el perfil operativo; no TIPSA.
Documento recibido: termina en apartado 27, `CUSTOMER_RESPONSE`.

## Fase 0: arquitectura localizada antes de escribir código

| Elemento | Fuente existente reutilizada |
|---|---|
| Operations Center | apps/review-panel/{app.js,index.html,styles.css}; apps/api/server.mjs |
| Panel y detalle de incidencias | OperationsRepository.incidentOverview/listIncidents/incidentDetail; incident-insight.mjs |
| Modelo canónico | read_models.operations_incident_records/evidence_context; migrations 014,017,036,037 |
| Event Store / Digital Twin | platform-core/{event-store,contracts,digital-twin,decision-engine}.mjs; operations_order_timeline |
| Decision/Policy Engine | incident/{incident-processor,absent-decision,gls-policies}.mjs; configuration.policy_versions |
| Timer/Scheduler | timer-engine.mjs, incident-timers.mjs, operations.incident_timers; worker independiente AUSENTE |
| Dropea | services/integrations/dropea/{public-api-client,shadow-sync}.mjs; integration_dropea_orders/issues |
| GLS | incident/{gls-policies,gls-calendar,absent-evidence}.mjs; integrations/gls/absent-read-context.mjs |
| Chatby | integrations/chatby/readonly-sync.mjs; notification-evidence.mjs; operaciones de mensajes privadas cifradas |
| Descuento / NO ACEPTA | Render production; incident-discount-signal-sync.mjs; operations_incident_discount_recovery_latest |
| AUSENTE | política persistida V1, simulación con plantilla v3 aprobada; absent-panel-projection.mjs |
| Dirección / FALTAN DATOS | parser chatby-customer-instruction.mjs; propuesta existente incident-insight.mjs |
| Pendientes reales | status PENDING e is_active=true; no equiparar salida de cola con devolución |
| Cliente actuó / evidencia | mensaje exacto de pedido/incidencia posterior a notificación, lectura verificada; FOUND no basta |
| Solución concreta | tailored_recommendation; absent_shadow.concrete_solution; no ejecutar la presentación |
| Devolución / entrega | estado y resolución oficial Dropea + timestamp económico real cuando existe |
| Pruebas | platform-core/test, MCP/test y operaciones, services, apps/api y review-panel, infrastructure, autoconfirm, scripts |

## Contradicciones y carencias identificadas

- El contador SQL `VALID_RESPONSE` se calcula antes de interpretar el texto privado
  en JavaScript. Una tarjeta no puede usar ese contador y filtrar mediante otra
  interpretación. La nueva capa compartirá una sola proyección y selector.
- Varias tarjetas actuales no son filtros; «Atención prioritaria» solo es riesgo
  HIGH/CRITICAL y no prioriza al cliente que espera acción.
- La recomendación genérica de rechazo puede sugerir devolución sin representar
  correctamente oferta/espera. Se corregirá únicamente la presentación derivada,
  usando el registro real de recuperación; no se altera el ejecutor de Render.
- El descuento shadow antiguo y timers genéricos mencionan 48 h. No son autoridad
  para la espera de 24 h tras el descuento real en Render. `discount_due_at` es la
  fecha de elegibilidad de oferta, NO un deadline de devolución. Si falta el
  deadline real de respuesta al descuento, se muestra N/D y no se calcula desde
  un número supuesto, ni se reutiliza ese timer genérico.
- Los hitos históricos de nueva entrega, recuperación y devolución no están todos
  instrumentados con timestamp real. Se utilizarán resoluciones oficiales y
  eventos verificados; falta de timestamp impide calcular duración, no autoriza
  inventar fecha a partir de updated_at ni fabricar un evento ejecutado.
- SHADOW_ISSUE_CREATED_ONLY no demuestra contacto ni respuesta a un aviso.
  CONFIRMAR MI PEDIDO no demuestra acción de incidencia aunque exista un chat.
- Un RETURN_REQUESTED es devolución SOLICITADA, no devolución física completada.
  RESOLVED/inactiva por sí sola tampoco prueba recuperación ni devolución.

Meta v3: APPROVED/es_ES/UTILITY, contenido exacto verificado el
2026-09-18T16:35:48.472Z. Aprobación no concede permisos LIVE.

## Diseño de menor riesgo

Capa derivada sin nueva base de datos ni migraciones. Una única consulta al
universo existente y una única función canónica calculan flags, estados,
contadores y filtros. KPI y filas usan el mismo predicado, con paginación después
de filtrar. Métricas históricas por pedidos distintos; operativas por incidencias
distintas. Ventana por creación de incidencia en Europe/Madrid; resultados
posteriores observados hasta la fecha de lectura. Campos incompletos visibles
como N/D/cobertura parcial. Score determinista informativo, sin autoridad de acción.

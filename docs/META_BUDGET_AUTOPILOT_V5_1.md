# Meta Budget Autopilot V5.1 — entrega de desarrollo

22 de octubre de 2026. V5.1 sustituye las fórmulas porcentuales solicitadas en V5.
Esta rama prepara código y pruebas; **no despliega ni activa el Autopilot**.

## Estado y alcance

- Modo nuevo predeterminado: SHADOW; scheduler y notificaciones desactivados.
- `AUTOPILOT_LIVE_COMPILED=false`; ninguna variable de entorno puede convertirlo
  en LIVE. Los ensayos de ejecución utilizan exclusivamente dependencias falsas.
- Perfil preparado: `META_WRITES_ENABLED=false`,
  `ADS_INTELLIGENCE_WRITES_ENABLED=false`, `ADS_INTELLIGENCE_MODE=SHADOW`.
- Se conserva un único bot, una base PostgreSQL y un ejecutor monetario:
  `AdsIntelligence.confirmLocked` y su transporte de presupuestos existente.
- No se modifica el token, los administradores, los pedidos, las incidencias,
  las campañas, los presupuestos reales ni las reglas nativas de Meta.

La producción observada es posterior al estado descrito inicialmente en V5:
Command Center 3 ya tiene presupuestos **manuales confirmados** autorizados por
el propietario. Esa producción continúa funcionando; no se ha cambiado aquí.
Desplegar el perfil SHADOW nuevo requeriría aprobación y pondría también las
propuestas del ejecutor compartido en simulación durante esa fase.

## Auditoría realizada

Lectura real del VPS y de Meta, sin escrituras, a las 10:18 de Madrid:

| Elemento | Resultado observado |
|---|---|
| API | `suleia-command-center3-api:8985416`, saludable |
| Telegram | Único `suleia-telegram.service`, activo; release `command-center3-8985416` |
| Ejecutor anterior | Manual, LIVE con confirmación; `LIVE_COMPILED=true` en esa versión |
| Límite anterior | 100 €/campaña, 10 % por cambio, +30 €/día agregado, 24 h entre cambios |
| Muestra anterior para filtro ROAS | 15 € de gasto, cinco compras, 1.000 impresiones |
| Cuenta Meta | EUR, Europe/Madrid, estado elegible |
| Permisos del token existente | `ads_read` y `ads_management` concedidos |
| Campañas activas | Nueve, con presupuesto diario de campaña |
| Reglas nativas | Ninguna en el inventario completo de esa lectura |
| Scheduler automático anterior | Ningún timer de presupuestos activo encontrado |
| Mínimo operativo aprobado | No configurado |

La consulta de mínimos Meta de las 10:57 devolvió categorías EUR de 90, 447 y
3.571 céntimos. No son una correspondencia acreditada por campaña. El código
no elige el máximo, el mínimo ni una categoría arbitraria como suelo universal.
Los importes no se presentan como una aprobación operativa.

La política V1 antigua era un simulador con ROAS 6/3 y techo nocturno de 35 €,
sin escritor habilitado. No se ha activado ni desactivado ningún proceso suyo.
Su loader ahora rechaza coexistir con `AUTOPILOT_ENABLED=true`; su endpoint de
política se identifica como archivo sustituido cuando V5.1 está habilitado.

## Reglas implementadas

| Revisión Madrid | Decisión candidata |
|---|---|
| 07:00; 08:00–11:00; 13:00–18:00; 20:00–22:00 | ROAS >3,8: `min(actual + 1.000, 7.000)` céntimos, con al menos tres compras enteras válidas, gasto positivo y evidencia suficiente |
| 12:00 y 19:00 | Igual incremento; con ROAS <3,8: `max(actual − 1.000, mínimo aprobado)`, sin aumentar una campaña que ya esté bajo el mínimo |
| ROAS =3,8 | Mantener en las revisiones diurnas |
| ROAS ausente, ambiguo, de otro evento o de otra fecha | No aumentar; no tratar ausencia como cero ni reducir por ausencia de compras |
| Noche, ROAS fiable ≥3,8 | Techo de 25 € |
| Noche, ROAS bajo | Techo de 20 € |
| Noche, datos no fiables | Techo conservador de 20 €, identificado como dato insuficiente |

Siete escalones nocturnos: **22:30, 22:45, 23:00, 23:15, 23:30, 23:45 y 23:59**.
En cada uno se distribuye la diferencia actual entre los escalones restantes,
en céntimos enteros. Se vuelve a calcular con la lectura real: admite cambios
externos y cambios de ROAS, y nunca eleva un presupuesto que ya esté bajo el techo.
Estos ajustes nocturnos pueden ser distintos de 10 €.

Las decisiones usan el día de Madrid desde las 00:00 y el lector Meta canónico,
con contrato de atribución explícito. Se añade el ROAS nativo de compras sin
cambiar las métricas históricas de V3/V4. La antigüedad máxima es de dos minutos;
datos futuros, paginación incompleta, eventos incompatibles o día cambiado bloquean.
No se utiliza la tabla histórica congelada para decidir.
El contador y el valor de compras del Autopilot se seleccionan del mismo evento
que su ROAS nativo (por ejemplo, web u omni), sin sumar aliases. Los campos
históricos de V3/V4 mantienen su significado anterior.

## Protecciones y aprobaciones pendientes

La fórmula candidata no equivale a permiso para ejecutar. Se conservan los
controles anteriores como bloqueantes hasta consolidar la política:

- **10 % por operación**: 25→35 € viola este límite; 65→70 € no lo viola.
- **24 horas entre cambios**: impide escalar cada hora y puede bloquear la noche.
- **+30 € agregado al día**: sigue reservando los resultados inciertos, incluso
  si son anteriores al día actual; no se libera por reiniciar ni por cambiar de fecha.
- **Cinco compras y muestra anterior**: pueden bloquear una candidata V5.1 con
  tres compras; la diferencia queda explícita y no se relaja en producción.
- Protección de aprendizaje, volatilidad, modificaciones recientes, conflictos
  y operaciones sin conciliar del sistema V4.

No hay valores inventados para:

1. Mínimo operativo aprobado y mínimo conservador verificado por campaña en Meta.
2. Máximo global de presupuesto configurado y límite diario de gasto observado.
3. Número de compras **nuevas** requerido tras una subida. Se puede proponer tres
   compras adicionales, pero no está configurado ni aprobado por esta entrega.
4. Muestra de gasto/tráfico y madurez de atribución para reducir por ROAS bajo.
5. Excepciones a 10 %, 24 h, cinco compras o +30 € necesarias para la nueva estrategia.

La configuración aprobada exige una referencia de autorización. Los mínimos por
campaña llevan cuenta, moneda, referencia, fecha y vencimiento: un registro de otra
cuenta o caducado no sirve. Las compras utilizadas antes, una revisión de atribución
o un cambio de tipo de evento no justifican otra subida.

El guard de gasto lee el total diario a nivel de cuenta, incluidos gastos de
campañas que ya estén pausadas. Cero explícito y dato desconocido son distintos.
Al alcanzar el límite aprobado bloquea incrementos y produce una alerta. No es
un límite duro de cobro del proveedor: las consultas tienen latencia, una campaña
puede seguir gastando su asignación y no se han autorizado pausas automáticas.

## Arquitectura y ejecución

```text
API existente: tick cada 15 s, solo si está habilitado
  → slot actual de Madrid, sin recuperar revisiones pasadas
  → reserva única PostgreSQL por cuenta/fecha/hora
  → lector Meta + historial del ejecutor + reglas + protección V4
  → motor V5.1 y validación de límites
  → propuesta estructurada del mismo AdsIntelligence
  → bloqueo de cuenta y campaña, relectura y comprobación de política
  → mismo transporte monetario (bloqueado en esta release)
  → lectura posterior + auditoría existente
```

No hay otro daemon, importador, timer ni consumidor de Telegram. La migración
058 añade únicamente reservas de slots y un índice de auditoría en las tablas
Ads existentes. Usa el mismo rol limitado. Ninguna migración se ha aplicado aquí
al PostgreSQL productivo.

Un slot que quedó ejecutándose tras una caída permanece pendiente de revisión;
no se roba su reserva ni se repite. Las revisiones de las 12:00 y 19:00 son únicas.
Los cambios monetarios inciertos siguen en el ledger común y no se reenvían.
El archivo de auditoría tiene paginación estable por fecha e ID, conservando los
microsegundos de PostgreSQL. Un historial incompleto bloquea la decisión.

Prioridad: límites y conflictos primero; conciliación nocturna; órdenes manuales
confirmadas; revisiones especiales; ordinarias. La orden manual mantiene su
prioridad hasta las 22:30 del día, sin anular techos nocturnos ni límites. Las
protecciones de 24 h no se saltan para aplicar esa prioridad.

## Telegram

Se reutilizan los IDs numéricos autorizados, el chat privado, la firma del bridge,
la caducidad de cinco minutos, los botones vinculados al actor y la misma auditoría.
No se añade un proveedor de modelos ni una clave de pago.

Frases preparadas y probadas:

- «Sube 10 € a las campañas con ROAS superior a 3,8».
- «Baja 10 € a todas las campañas activas».
- «Pon CollaGum a 50 € diarios»; si hay varias campañas pide ID exacto.
- «¿Qué presupuestos tenemos ahora?».
- «¿Qué campañas han subido hoy de presupuesto?».
- «¿Qué campañas están cerca de los 70 €?» — a un paso de 10 € o en el techo.
- «¿Por qué no has aumentado Seoul 1988?».
- «¿Cuánto presupuesto hemos reducido hoy?».
- «Muéstrame el historial de modificaciones de NIDA».

Cada escritura sigue propuesta→confirmación→revalidación→ejecutor→lectura posterior.
El modo SHADOW simula ese flujo. Las órdenes porcentuales antiguas se aclaran
cuando V5.1 está habilitado; los botones anteriores no se reinterpretan como euros.
El resumen deja de ofrecer recomendaciones porcentuales y enlaza Budget Autopilot.

Informes preparados para 07:00, 12:00, 19:00, 22:30 y 23:59, desactivados por defecto.
Se envían desde el mismo poller a los administradores existentes únicamente tras
un ciclo terminado. La última entrega admite demora acotada después de medianoche.
Una reserva de envío incierta no se repite. No se enviaron mensajes reales de prueba.

## Panel y capturas

Entrada «Budget Autopilot» dentro de Ads Intelligence. Muestra modo y activación,
fuente/fecha, próxima revisión, presupuesto actual, ROAS, compras, candidata, techo
de 70 €, techo nocturno, cambios verificados, planes, bloqueos y auditoría paginada.
Las líneas discontinuas del gráfico son planes SHADOW; no se cuentan como cambios.
En móvil las filas son tarjetas con motivos visibles. Los nombres se insertan
como texto, sin interpretar HTML.

Capturas **locales con datos ficticios**, sin sesión ni conexión a Meta:

- [Escritorio](assets/budget-autopilot-v51-desktop.png).
- [Móvil](assets/budget-autopilot-v51-mobile.png).

Se comprobó filtrado, ausencia de errores JavaScript y ausencia de desbordamiento
del documento a 1536 y 390 px. El panel no está desplegado por esta entrega.

## Simulación reproducible

```sh
node services/meta-ads/cli/autopilot-simulate.mjs
```

El CLI usa exclusivamente datos ficticios, no acepta argumentos LIVE y no importa
ningún escritor, conexión SQL ni cliente HTTP. Las candidatas se entregan junto a
sus bloqueos; no se presentan los resultados de pruebas como una aprobación.

[Resultados JSON de los ejemplos](assets/budget-autopilot-v51-simulations.json).

| Caso | Candidata V5.1 |
|---|---|
| 20 / 25 / 60 / 65 € con ROAS 4,2 | 30 / 35 / 70 / 70 € |
| 70 € con ROAS alto | Mantener |
| 70 € con ROAS 3,7 a las 12:00 | 60 € |
| 30 € con ROAS 3,7 a las 19:00 | 20 €, si el mínimo lo admite |
| ROAS exactamente 3,8 | Mantener de día |
| 70 € a las 23:59, ROAS alto / desconocido | 25 / 20 €, sujetos a mínimos y controles |

## Pruebas y límites de la verificación

La matriz de pruebas cubre incrementos y tope, reducciones, ROAS cero/ausente/
ambiguo/exacto, tres compras/una compra/fracciones, gasto cero, datos caducados,
campañas pausadas/ABO, evidencia reutilizada, segundo escalado, reglas simultáneas,
prioridad manual, final nocturno cambiante, mínimo incompatible, reinicio, DST,
duplicados, dos administradores, firma, confirmación caducada, cambio externo,
rechazo, resultado incierto, fallo parcial y lectura posterior.

Los ensayos futuros LIVE se ejecutan con un escritor falso, inyectado directamente;
la fábrica real no ofrece ese override. Demuestran el contrato y las postcondiciones,
no una escritura financiera real ni aceptación de los mínimos actuales por Meta.
La autorización del token tampoco certifica una operación real completada.

Verificación final del código:

- **Node 22/Linux: 358 aprobadas, 0 fallidas**, una integración opcional omitida
  en ese grupo y ejecutada después por separado.
- **PostgreSQL 17 aislado: 1 aprobada, 0 fallidas**. Incluye migración 058, unicidad
  de slot, permisos de lectura, reserva antigua incierta y paginación con empates
  de fecha y precisión de microsegundos.
- Capturas locales y filtro comprobados a 1536×1000 y 390×844: sin errores de script
  ni desbordamiento horizontal del documento.
- Cero credenciales productivas suministradas a los contenedores de prueba;
  red deshabilitada, sin puertos publicados. Los contenedores productivos mantuvieron
  sus identidades antes y después. Los recursos PostgreSQL de prueba se retiraron.

Los resultados también se registran en el handoff de esta PR. En Windows se
observaron limitaciones de fsync de directorios;
no se quitó esa protección del bot para adaptar el código al PC.

## Despliegue propuesto y rollback

1. Aprobar por separado el despliegue SHADOW y la migración 058. Confirmar que
   durante esa fase las órdenes presupuestarias del ejecutor compartido se simulan.
2. Releer Agent Hub y el runtime del otro PC; conservar las versiones posteriores
   de panel/incidencias y la identidad/offset/estado del único bot.
3. Aplicar la migración aprobada; desplegar API, panel y el mismo bot con rollback
   preparado. Mantener `AUTOPILOT_ENABLED=false` hasta verificar lecturas, permisos
   y acceso de ambos administradores en el nuevo runtime.
4. Autorizar/habilitar el scheduler SHADOW y, si procede, sus informes. Comprobar
   un slot, la auditoría y cero POST presupuestarios. No ejecutar slots anteriores.
5. Consolidar mínimos, exposición/gasto, evidencia incremental y excepciones.
6. Solo después de otra autorización: nueva release revisada que compile LIVE,
   canary de una campaña/importe reversible, lectura posterior y revisión del
   resultado. La automatización completa requiere otra autorización específica.

Rollback: detener solo el scheduler nuevo, volver al artefacto anterior de API/
panel/bot y restaurar únicamente las opciones no secretas cambiadas con aprobación.
Conservar offsets, propuestas, reservas, operaciones y eventos; nunca rebobinar
mensajes ni limpiar resultados inciertos. El rollback SQL conserva la tabla de
slots y revoca sus escrituras. No revierte presupuestos automáticamente.

No se puede garantizar confirmar un estado exactamente a las 23:59: la API puede
responder tarde, fallar o cruzar medianoche. El control final relee presupuesto y
ROAS; una fecha cambiada, error o resultado incierto produce alerta crítica y no
se declara cumplimiento. El presupuesto configurado no es el gasto consumido.

## Contrato Meta comprobado

Se verificaron los campos y operaciones con fuentes primarias del SDK oficial:
[Campaign.api_update](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py),
[AdAccount.get_minimum_budgets](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py) y
[MinimumBudget](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/minimumbudget.py).
El transporte existente usa una asignación absoluta `daily_budget` en céntimos EUR,
un solo POST, sin reintentos, y verificación GET posterior. No modifica adsets.

## Archivos modificados

Cambios de esta rama respecto de Command Center 3:

- apps/api/ads-intelligence.test.mjs
- apps/api/server.mjs
- apps/review-panel/ads-intelligence-v3.js
- apps/review-panel/budget-autopilot-v5.css
- apps/review-panel/budget-autopilot-v5.js
- apps/review-panel/budget-autopilot-v5.test.mjs
- apps/review-panel/index.html
- docs/AGENT_HANDOFF.md
- docs/META_BUDGET_AUTOPILOT_V5_1.md
- docs/assets/budget-autopilot-v51-desktop.png
- docs/assets/budget-autopilot-v51-mobile.png
- docs/assets/budget-autopilot-v51-simulations.json
- infrastructure/telegram-center/ads-gateway.mjs
- infrastructure/telegram-center/autopilot-reports.mjs
- infrastructure/telegram-center/autopilot-reports.test.mjs
- infrastructure/telegram-center/compact-reports.mjs
- infrastructure/telegram-center/config.mjs
- infrastructure/telegram-center/install.sh
- infrastructure/telegram-center/service.mjs
- migrations/058_ads_budget_autopilot.sql
- migrations/rollback/058_ads_budget_autopilot.down.sql
- services/command-center/center.mjs
- services/meta-ads/autopilot/autopilot.test.mjs
- services/meta-ads/autopilot/environment.example
- services/meta-ads/autopilot/policy.mjs
- services/meta-ads/autopilot/queries.mjs
- services/meta-ads/autopilot/schedule.mjs
- services/meta-ads/autopilot/service.mjs
- services/meta-ads/budget/config.mjs
- services/meta-ads/cli/autopilot-simulate.mjs
- services/meta-ads/command-service.mjs
- services/meta-ads/intelligence.mjs
- services/meta-ads/intent.mjs
- services/meta-ads/ledger.integration.test.mjs
- services/meta-ads/ledger.mjs
- services/meta-ads/meta-ads-client.mjs
- services/meta-ads/meta-ads-client.test.mjs
- services/meta-ads/meta-money.mjs
- services/meta-ads/meta-money.test.mjs
- services/meta-ads/metrics.mjs
- services/meta-ads/runtime.mjs

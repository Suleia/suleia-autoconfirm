# V11 — preparación, despliegue y reversión

**Candidato sin desplegar. Requiere autorización humana específica V11.** No sustituir este paso por la autorización anterior de V10. No desplegar el árbol completo del monorepo a Render: contiene referencias históricas que no representan el worker productivo actual.

## Artefactos

`tools/package-operations-v11.py` crea, sin red ni despliegue:

- `operations-v11-api.tar.gz`: once módulos de lectura/review y Dockerfile overlay sobre la imagen V10 comprobada.
- `operations-v11-panel.tar.gz`: nueve archivos estáticos.
- `manifest.json`: commit fuente, hashes por archivo, base real, 19 hashes protegidos y reversión; `deploymentApproved:false`, `deployed:false`.

Ejemplo desde el repositorio, con los informes privados de la auditoría local:

```powershell
python tools/package-operations-v11.py --audit ../output/operations-center-v11/production-audit-final.json --runtime ../output/operations-center-v11/runtime-audit-final.json --output ../output/operations-center-v11/release
```

El generador exige cambios runtime confirmados en Git y rechaza una base o hash protegido diferente. Los artefactos no incluyen credenciales, variables de entorno, imágenes con datos personales, migraciones ni los harness DEMO. Las capturas sintéticas y las herramientas QA están en Git, fuera de los overlays de producción.

Manifiesto preparado: [OPERATIONS_CENTER_V11_RELEASE.json](OPERATIONS_CENTER_V11_RELEASE.json), código runtime `3333429`. La imagen candidata se construyó y pasó importación/hashes sin red ni credenciales; sigue sin desplegar. Esa construcción no acredita recuperación de cuota productiva ni éxito de la automatización presupuestaria.

## Preflight tras la aprobación

1. Volver a leer Agent Hub y comprobar que otro agente no está desplegando el mismo subsistema. Confirmar API, image ID, estáticos, 108 archivos y 19 hashes contra el manifiesto; detener ante cualquier diferencia.
2. Verificar salud de PostgreSQL/API/proxy/bot/Render y que no hay operaciones presupuestarias UNKNOWN/EXECUTING ni un slot en ejecución. Elegir ventana fuera de los cinco minutos alrededor de un slot y del informe diario. No cancelar una operación financiera en curso para desplegar.
3. Guardar privadamente configuración y hashes de flags, IDs de contenedor/imagen, montaje estático y estado del bot. No imprimir secretos. Conservar la imagen y carpeta estática anteriores. Validar el image ID del tag de base antes de `docker build`; no confiar solo en el tag mutable.
4. Extraer artefactos en una carpeta nueva, validar todas las sumas y rutas. Construir una imagen con etiqueta inmutable desde la base auditada. Copiar la carpeta estática actual a una nueva release y aplicar solo el overlay. No editar la release activa en sitio.
5. Revisar el diff de configuración efectivo: solo imagen API y montaje estático. Conservar redes, secretos, SQL, flags LIVE y horarios. No reiniciar bot, Render, tareas logísticas o recuperación Shopify. No ejecutar migraciones.
6. Cambiar API y estáticos de manera coordinada con un reinicio controlado del servicio API. No repetir claims ni limpiar reservas/ledgers.

## Smokes y evidencia posterior

- API/proxy saludables y revisión/hash iguales al candidato. Archivos importados nuevos presentes; ninguna respuesta de contrato frontend/backend mezclado.
- OAuth vigente en la sesión del dueño: recorrer las seis vistas en lectura; valores/fuentes/fechas, gráficos y tablas comparados con las fuentes actuales. No falsear una prueba de sesión caducada reutilizando cookies extraídas.
- Ads: un único trabajo inicial, estado finito, conservación del último corte, cambio de fechas/nivel/entidad, apertura y cierre de los tres tipos de análisis, cancelación de respuestas antiguas, salud de cola y número de GET. No hacer carga artificial sobre Meta productivo.
- Resultados: mismas reglas de cohorte, ingresos/costes/COGS/beneficio y controles de coherencia que antes del cambio. Pedidos e incidencias conservan sus proyecciones y no ejecutan acciones por navegar.
- 19 hashes financieros idénticos; misma política/flags, escritor, mínimos, máximos, aprendizaje, 72 h cuando aplique, confirmaciones, idempotencia y canario. Una lectura crítica no acepta hechos financieros cacheados.
- Mismo bot/configuración/destinatario y planificación 22:30 Europe/Madrid. Comprobar el siguiente envío natural en su ledger; no enviar un informe de prueba ni duplicar el diario.
- Documentar cualquier código de cuota/autenticación que siga impidiendo funciones principales. Un HTTP 200 con datos históricos no prueba recuperación de frescura. No declarar una subida o bajada sin evento de escritura verificado y lectura posterior.

## Reversión

Ante error de autenticación, contrato, importación, finanzas, guardas presupuestarias o regresión grave, restaurar la **misma** imagen LIVE anterior `suleia-ads-growth:7224c11` / image ID `sha256:a02a3618de627d5dd9631e8e5a8f8e8bc505e57d09f1a82c9636d266a7f165aa` y el montaje `/opt/suleia-panel-releases/ads-growth-svg-b048ad5`. Reiniciar solo API si es necesario y repetir smokes.

No revertir a una imagen histórica SHADOW, no restaurar una base de datos antigua, no resetear ledgers de entregas/presupuestos y no reejecutar operaciones inciertas. V11 no necesita downgrade de esquema. Conservar registros para la auditoría y publicar el resultado en Agent Hub con los hashes efectivos.

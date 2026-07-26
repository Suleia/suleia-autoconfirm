# MCP preflight checklist

## Local

- [x] Dependencias instaladas con lockfile.
- [x] Tests unitarios verdes.
- [x] Cliente stdio enumera ocho tools.
- [x] Cliente Streamable HTTP enumera ocho tools.
- [x] Request sin bearer devuelve 401.
- [x] Scope incompleto bloquea simulacion.
- [x] Schemas de entrada y salida presentes.
- [x] Un unico pedido ficticio enmascarado.
- [x] Ninguna PII obvia en respuestas.
- [x] Ninguna PII en auditoria.
- [x] `actions_executed=0`.
- [x] No existe tool de escritura.
- [x] No existe import desde `autoconfirm`.

## Supabase staging

- [ ] Proyecto separado de produccion.
- [ ] SQL revisado y aprobado.
- [ ] Rol `mcp_staging_reader` creado.
- [ ] Solo `SELECT` sobre `mcp_read`.
- [ ] Token lector no puede acceder a `staging_private`.
- [ ] Token lector no puede escribir.
- [ ] Pipeline de copia unidireccional usa otra identidad.
- [ ] Enmascarado ocurre antes de cargar staging.
- [ ] Solo un pedido real enmascarado tras autorizacion.

## Render staging

- [ ] Servicio separado de produccion.
- [ ] Variables secretas solo en Render.
- [ ] Ref del proyecto staging validada en arranque.
- [ ] Health verde.
- [ ] Endpoint MCP autenticado.
- [ ] Logs sin PII.
- [ ] Rate limit activo.
- [ ] Rollback probado.

## ChatGPT

- [ ] OAuth 2.1 listo.
- [ ] Audience exacta.
- [ ] Scopes `orders:read` y `orders:simulate`.
- [ ] Refresh tokens configurados si aplican.
- [ ] Scan Tools muestra solo ocho tools.
- [ ] App permanece en borrador durante las pruebas.

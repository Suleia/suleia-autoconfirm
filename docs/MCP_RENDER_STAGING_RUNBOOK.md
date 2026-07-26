# Runbook futuro - Render staging

No ejecutar sin autorizacion.

## Servicio independiente

Crear un servicio nuevo. No reutilizar `suleia-autoconfirm`.

- Nombre sugerido: `suleia-operations-mcp-staging`
- Root directory: `packages/suleia-operations-mcp`
- Runtime: Node
- Node: 22.22.x
- Build: `pnpm install --frozen-lockfile`
- Start: `node src/transports/http.mjs`
- Health path: `/health`
- Region: la misma region europea que Supabase staging

## Variables secretas de Render

- `MCP_DATA_MODE=supabase`
- `MCP_AUTH_MODE=bearer` solo durante el preflight
- `MCP_STAGING_BEARER_TOKEN=<secreto aleatorio>`
- `MCP_GRANTED_SCOPES=orders:read,orders:simulate`
- `SUPABASE_STAGING_URL=<solo staging>`
- `SUPABASE_STAGING_READER_TOKEN=<JWT del rol lector>`
- `SUPABASE_STAGING_SCHEMA=mcp_read`
- `SUPABASE_STAGING_PROJECT_REF=<ref staging>`
- `EXPECTED_STAGING_PROJECT_REF=<misma ref staging>`
- `READ_ONLY=true`
- `SIMULATION_ONLY=true`
- `PRODUCTION_WRITES_ENABLED=false`
- `ACTION_EXECUTOR_ENABLED=false`
- `MCP_WRITE_TOOLS_ENABLED=false`
- `MCP_AUDIT_MODE=stderr`

Las credenciales de Supabase no se guardan en GitHub. La service-role key no
debe asignarse al MCP.

## Pruebas despues del despliegue

1. `/health` devuelve modo lectura, simulacion y cero acciones.
2. `/mcp` sin token devuelve 401.
3. `/mcp` con token invalido devuelve 401.
4. El cliente MCP autorizado enumera exactamente ocho tools.
5. Se consulta un unico pedido enmascarado.
6. Todos los resultados contienen `pii_masked=true`.
7. Las simulaciones contienen `actions_executed=0`.
8. Los logs solo contienen identificadores aleatorios y hashes.
9. Un intento de arrancar con cualquier flag de escritura falla.
10. El token lector no puede insertar, actualizar, borrar ni ejecutar RPC.

## Rollback

1. Suspender exclusivamente el servicio MCP staging.
2. Revocar el token lector de staging.
3. Revocar el bearer temporal u OAuth client.
4. Conservar auditoria sin PII.
5. No tocar el servicio de produccion.

# Phase 3B - Suleia Operations MCP staging

Estado: preparado localmente, sin despliegue y sin datos reales.

## Arquitectura cerrada

```text
ChatGPT
  -> OAuth 2.1 (pendiente antes del registro)
  -> Suleia Operations MCP /mcp
  -> servicios de consulta y simulacion
  -> vistas mcp_read de Supabase staging
  -> copia enmascarada y unidireccional de produccion
```

ChatGPT no recibe credenciales de Supabase y no accede a Supabase directamente.
El servidor MCP tampoco tiene clientes de Dropea, Chatby, Shopify o Meta.

## Controles implementados

- Paquete aislado en `packages/suleia-operations-mcp`.
- Streamable HTTP en `POST /mcp`.
- Transporte stdio para pruebas locales.
- Ocho herramientas, todas de lectura o simulacion.
- Anotaciones MCP `readOnlyHint=true`, `destructiveHint=false` e
  `idempotentHint=true`.
- Scopes `orders:read` y `orders:simulate`.
- Bearer temporal para las pruebas previas de staging.
- Adaptador Supabase que solo emite `GET`.
- Lista cerrada de seis vistas `mcp_read`.
- Comprobacion estricta del identificador del proyecto staging.
- Enmascarado recursivo de PII antes de construir la respuesta MCP.
- Auditoria sin argumentos, mensajes, telefonos, emails ni payloads.
- Invariantes de arranque que bloquean escritura y ejecutores.
- `actions_executed=0` en simulaciones y auditoria.

## Datos

El modo por defecto es `fixture`. Solo carga `STG-ORDER-0001`, un pedido
completamente ficticio y enmascarado. No se ha ejecutado el SQL de staging ni
se ha importado informacion de produccion.

El SQL propuesto se encuentra en:

`packages/suleia-operations-mcp/sql/staging_read_model.sql`

Define:

- tablas privadas para la copia enmascarada;
- vistas publicables bajo el esquema `mcp_read`;
- rol `mcp_staging_reader` sin login y con `SELECT` solamente;
- restriccion de base de datos que obliga a que
  `actions_executed = 0`.

## Autenticacion

### Preflight local y Render staging

Se usa temporalmente un bearer opaco de al menos 32 caracteres. El secreto solo
debe existir en variables de entorno de Render staging y en el cliente local de
pruebas. No debe escribirse en GitHub, logs o documentacion.

### Conexion posterior desde ChatGPT

Antes de registrar la app se debe sustituir el bearer temporal por OAuth 2.1:

- Authorization Code con PKCE;
- metadata de Authorization Server;
- resource metadata para el endpoint MCP;
- access tokens de corta duracion;
- refresh token si el proveedor lo requiere;
- audience exacta del MCP staging;
- scopes unicos `orders:read` y `orders:simulate`.

No se registrara la app en ChatGPT mientras OAuth 2.1 no este validado o mientras
no se haya aprobado expresamente otro mecanismo compatible.

## URL planificada

Sin asignar todavia:

`https://<render-staging-host>/mcp`

La URL no existe hasta que se autorice un servicio Render staging separado.

## Criterio de salida

No avanzar al despliegue hasta que:

1. todas las pruebas locales sean verdes;
2. la revision de seguridad confirme que no hay imports desde `autoconfirm`;
3. se cree un proyecto Supabase staging independiente;
4. el rol lector y las vistas se validen en staging;
5. se apruebe cargar un unico pedido real enmascarado;
6. se apruebe crear Render staging;
7. OAuth 2.1 quede configurado y probado.

# Registro futuro de Suleia Operations MCP en ChatGPT

No ejecutar hasta autorizar el despliegue y validar OAuth 2.1.

## Requisitos

- ChatGPT Business, Enterprise o Edu en web.
- Usuario administrador/propietario o desarrollador autorizado.
- Servidor MCP remoto accesible.
- URL final `https://<render-staging-host>/mcp`.
- OAuth 2.1 validado con scopes:
  - `orders:read`
  - `orders:simulate`
- Ocho tools revisadas y congeladas.

ChatGPT no se conecta directamente a servidores MCP locales. El servicio debe
ser remoto o usar Secure MCP Tunnel. Para esta fase se usara Render staging.

## Pasos exactos

1. En ChatGPT web, abrir `Settings`.
2. Abrir `Apps`.
3. Entrar en `Advanced Settings` y activar `Developer mode` si el plan y el rol
   lo permiten.
4. Como administrador/propietario, tambien puede hacerse desde
   `Workspace settings -> Apps -> Create`.
5. Pulsar `Create`.
6. Introducir:
   - nombre: `Suleia Operations MCP - Staging`;
   - descripcion: `Consulta y simulacion de pedidos en staging, sin acciones`;
   - MCP endpoint: `https://<render-staging-host>/mcp`.
7. Elegir OAuth como mecanismo de autenticacion.
8. Completar el consentimiento solo para `orders:read` y `orders:simulate`.
9. Pulsar `Scan Tools`.
10. Verificar que aparecen exactamente las ocho tools documentadas.
11. Comprobar que todas se muestran como lectura/simulacion y que no existe
    ninguna tool de escritura.
12. Pulsar `Create`.
13. Confirmar que la app aparece como borrador en
    `Workspace settings -> Apps -> Drafts`.
14. En ajustes personales, comprobar que aparece con la etiqueta `Dev`.
15. Probar primero `get_data_freshness` y despues `get_order` con el pedido
    enmascarado autorizado.
16. No publicar la app en el workspace hasta completar la revision de seguridad.

Si se modifican tools o schemas despues de aprobar la app, ChatGPT puede
mantener una instantanea congelada. Se debera revisar/refrescar las acciones o
recrear la app segun las opciones disponibles en el plan.

## Fuentes oficiales

- Developer mode y apps MCP:
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- Controles administrativos:
  https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-in-apps-connectors-enterprise-edu-and-business

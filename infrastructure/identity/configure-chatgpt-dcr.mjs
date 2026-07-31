const baseUrl = "http://keycloak:8080/auth";
const defaultClientId = "suleia-config-service";
const clientId =
  process.env.KEYCLOAK_CONFIG_SERVICE_CLIENT_ID ?? defaultClientId;
const clientSecret = process.env.KEYCLOAK_CONFIG_SERVICE_SECRET;
const configAdminUsername = "suleia-config-admin";
const configAdminPassword = process.env.KEYCLOAK_CONFIG_ADMIN_PASSWORD;

if (!clientSecret && !configAdminPassword) {
  throw new Error(
    "A temporary Keycloak configuration credential is required",
  );
}

const tokenBody = configAdminPassword
  ? new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: configAdminUsername,
      password: configAdminPassword,
    })
  : new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

const tokenResponse = await fetch(
  `${baseUrl}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  },
);

if (!tokenResponse.ok) {
  throw new Error(`Temporary service token failed: ${tokenResponse.status}`);
}

const { access_token: accessToken } = await tokenResponse.json();
if (!accessToken) {
  throw new Error("Temporary service token is missing");
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Keycloak admin request failed: ${options.method ?? "GET"} ${path} ${response.status}`,
    );
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

let primaryError;
try {
  const componentType =
    "org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy";
  const components = await adminRequest(
    `/admin/realms/suleia/components?type=${encodeURIComponent(componentType)}`,
  );

  const trustedHosts = components.find(
    (component) =>
      component.providerId === "trusted-hosts" &&
      component.subType === "anonymous",
  );
  const maxClients = components.find(
    (component) =>
      component.providerId === "max-clients" &&
      component.subType === "anonymous",
  );

  if (!trustedHosts || !maxClients) {
    throw new Error("Required anonymous registration policies are missing");
  }

  const staticClients = await adminRequest(
    "/admin/realms/suleia/clients?clientId=chatgpt-suleia-mcp&search=true",
  );
  const staticClient = staticClients.find(
    (client) => client.clientId === "chatgpt-suleia-mcp",
  );
  const clientScopes = await adminRequest(
    "/admin/realms/suleia/client-scopes?search=offline_access",
  );
  const offlineAccessScope = clientScopes.find(
    (scope) => scope.name === "offline_access",
  );

  if (!staticClient || !offlineAccessScope) {
    throw new Error("Static ChatGPT client or offline_access scope is missing");
  }

  await adminRequest(
    `/admin/realms/suleia/clients/${encodeURIComponent(staticClient.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...staticClient,
        attributes: {
          ...staticClient.attributes,
          resource_url: "https://mcp.suleia.com/mcp",
        },
      }),
    },
  );

  const optionalScopes = await adminRequest(
    `/admin/realms/suleia/clients/${encodeURIComponent(staticClient.id)}/optional-client-scopes`,
  );
  if (!optionalScopes.some((scope) => scope.id === offlineAccessScope.id)) {
    await adminRequest(
      `/admin/realms/suleia/clients/${encodeURIComponent(staticClient.id)}/optional-client-scopes/${encodeURIComponent(offlineAccessScope.id)}`,
      { method: "PUT" },
    );
  }

  const protocolMappers = await adminRequest(
    `/admin/realms/suleia/clients/${encodeURIComponent(staticClient.id)}/protocol-mappers/models`,
  );
  const audienceMapper = protocolMappers.find(
    (mapper) => mapper.name === "suleia-mcp-audience",
  );
  if (!audienceMapper) {
    throw new Error("Static ChatGPT audience mapper is missing");
  }
  await adminRequest(
    `/admin/realms/suleia/clients/${encodeURIComponent(staticClient.id)}/protocol-mappers/models/${encodeURIComponent(audienceMapper.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...audienceMapper,
        config: {
          ...audienceMapper.config,
          "included.client.audience": "chatgpt-suleia-mcp",
        },
      }),
    },
  );

  const users = await adminRequest("/admin/realms/suleia/users?enabled=true");
  const humanUsers = users.filter((user) => !user.serviceAccountClientId);
  if (humanUsers.length > 1) {
    throw new Error(`Expected at most one private user, found ${humanUsers.length}`);
  }
  if (humanUsers.length === 1) {
    const userId = encodeURIComponent(humanUsers[0].id);
    await adminRequest(`/admin/realms/suleia/users/${userId}/logout`, {
      method: "POST",
    });
    const consents = await adminRequest(
      `/admin/realms/suleia/users/${userId}/consents`,
    );
    if (consents.length > 0) {
      await adminRequest(
        `/admin/realms/suleia/users/${userId}/consents/${encodeURIComponent(staticClient.clientId)}`,
        { method: "DELETE" },
      );
    }
  }

  await adminRequest(
    `/admin/realms/suleia/components/${encodeURIComponent(trustedHosts.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...trustedHosts,
        config: {
          "trusted-hosts": [
            "20.170.184.28",
            "20.170.184.32",
            "20.170.184.33",
            "chatgpt.com",
            "*.chatgpt.com",
          ],
          "host-sending-registration-request-must-match": ["true"],
          "client-uris-must-match": ["true"],
        },
      }),
    },
  );

  await adminRequest(
    `/admin/realms/suleia/components/${encodeURIComponent(maxClients.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...maxClients,
        config: {
          "max-clients": ["20"],
        },
      }),
    },
  );

  console.log("ChatGPT dynamic registration policy is configured.");
  console.log("Static ChatGPT client accepts the offline_access scope.");
  console.log("Static ChatGPT client maps the protected resource to the token audience.");
  console.log("Tokens issued before the audience correction were revoked.");
} catch (error) {
  primaryError = error;
} finally {
  try {
    for (const cleanupClientId of new Set([clientId, defaultClientId])) {
      const clients = await adminRequest(
        `/admin/realms/master/clients?clientId=${encodeURIComponent(cleanupClientId)}&search=true`,
      );
      const temporaryClient = clients.find(
        (client) => client.clientId === cleanupClientId,
      );
      if (temporaryClient) {
        await adminRequest(
          `/admin/realms/master/clients/${encodeURIComponent(temporaryClient.id)}`,
          { method: "DELETE" },
        );
      }
    }
    console.log("Temporary Keycloak configuration services were removed.");

    if (configAdminPassword) {
      const users = await adminRequest(
        `/admin/realms/master/users?username=${encodeURIComponent(configAdminUsername)}&exact=true`,
      );
      const temporaryAdmin = users.find(
        (user) => user.username === configAdminUsername,
      );
      if (temporaryAdmin) {
        await adminRequest(
          `/admin/realms/master/users/${encodeURIComponent(temporaryAdmin.id)}`,
          { method: "DELETE" },
        );
      }
      console.log("Temporary Keycloak configuration administrator was removed.");
    }
  } catch (cleanupError) {
    if (!primaryError) {
      primaryError = cleanupError;
    }
  }
}

if (primaryError) {
  throw primaryError;
}

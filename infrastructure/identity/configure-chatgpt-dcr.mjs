const baseUrl = "http://keycloak:8080/auth";
const clientId = "suleia-config-service";
const clientSecret = process.env.KEYCLOAK_CONFIG_SERVICE_SECRET;

if (!clientSecret) {
  throw new Error("KEYCLOAK_CONFIG_SERVICE_SECRET is required");
}

const tokenResponse = await fetch(
  `${baseUrl}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
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

  await adminRequest(
    `/admin/realms/suleia/components/${encodeURIComponent(trustedHosts.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...trustedHosts,
        config: {
          "trusted-hosts": [
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
} catch (error) {
  primaryError = error;
} finally {
  try {
    const clients = await adminRequest(
      `/admin/realms/master/clients?clientId=${encodeURIComponent(clientId)}&search=true`,
    );
    const temporaryClient = clients.find(
      (client) => client.clientId === clientId,
    );
    if (temporaryClient) {
      await adminRequest(
        `/admin/realms/master/clients/${encodeURIComponent(temporaryClient.id)}`,
        { method: "DELETE" },
      );
    }
    console.log("Temporary Keycloak configuration service was removed.");
  } catch (cleanupError) {
    if (!primaryError) {
      primaryError = cleanupError;
    }
  }
}

if (primaryError) {
  throw primaryError;
}

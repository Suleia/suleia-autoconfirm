import crypto from "node:crypto";

const keycloakBase = "http://keycloak:8080/auth";
const mcpUrl = "http://mcp-server:3100/mcp";
const resource = "https://mcp.suleia.com/mcp";
const adminUsername = "suleia-config-admin";
const adminPassword = process.env.KEYCLOAK_CONFIG_ADMIN_PASSWORD;
const requiredScopes = [
  "orders:read",
  "timelines:read",
  "decisions:read",
  "reviews:read",
  "orders:simulate",
];

if (!adminPassword) {
  throw new Error("KEYCLOAK_CONFIG_ADMIN_PASSWORD is required");
}

const adminTokenResponse = await fetch(
  `${keycloakBase}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: adminUsername,
      password: adminPassword,
    }),
  },
);
if (!adminTokenResponse.ok) {
  throw new Error(`Temporary administrator token failed: ${adminTokenResponse.status}`);
}
const { access_token: adminToken } = await adminTokenResponse.json();

async function adminRequest(path, options = {}) {
  const response = await fetch(`${keycloakBase}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Keycloak admin request failed: ${options.method ?? "GET"} ${path} ${response.status}`,
    );
  }
  if (response.status === 204 || response.status === 201) {
    return { location: response.headers.get("location") };
  }
  return response.json();
}

let testUserId;
let staticClient;
let primaryError;
try {
  const clients = await adminRequest(
    "/admin/realms/suleia/clients?clientId=chatgpt-suleia-mcp&search=true",
  );
  staticClient = clients.find(
    (client) => client.clientId === "chatgpt-suleia-mcp",
  );
  if (!staticClient) throw new Error("Static ChatGPT client is missing");

  await adminRequest(`/admin/realms/suleia/clients/${staticClient.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...staticClient,
      directAccessGrantsEnabled: true,
      consentRequired: false,
    }),
  });

  const username = `suleia-e2e-${crypto.randomUUID()}`;
  const email = `${username}@example.invalid`;
  const password = crypto.randomBytes(32).toString("base64url");
  const createUser = await adminRequest("/admin/realms/suleia/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      email,
      firstName: "Suleia",
      lastName: "E2E",
      emailVerified: true,
      enabled: true,
    }),
  });
  testUserId = createUser.location?.split("/").pop();
  if (!testUserId) throw new Error("Temporary test user id is missing");

  await adminRequest(`/admin/realms/suleia/users/${testUserId}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: password, temporary: false }),
  });
  const readerRole = await adminRequest(
    "/admin/realms/suleia/roles/mcp_reader",
  );
  await adminRequest(
    `/admin/realms/suleia/users/${testUserId}/role-mappings/realm`,
    { method: "POST", body: JSON.stringify([readerRole]) },
  );

  const tokenResponse = await fetch(
    `${keycloakBase}/realms/suleia/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "chatgpt-suleia-mcp",
        username: email,
        password,
        scope: `openid offline_access ${requiredScopes.join(" ")}`,
        resource,
      }),
    },
  );
  if (!tokenResponse.ok) {
    const tokenError = await tokenResponse.json().catch(() => ({}));
    const errorCode = String(tokenError.error ?? "unknown_error").replace(
      /[^a-zA-Z0-9_.-]/g,
      "_",
    );
    const errorDescription = String(
      tokenError.error_description ?? "no_description",
    )
      .replace(/[\r\n]/g, " ")
      .slice(0, 240);
    throw new Error(
      `End-to-end access token failed: ${tokenResponse.status} ${errorCode} ${errorDescription}`,
    );
  }
  const { access_token: accessToken } = await tokenResponse.json();
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
  );
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const scopes = String(payload.scope ?? "").split(/\s+/);
  const roles = payload.realm_access?.roles ?? [];
  if (!audiences.includes(resource)) throw new Error("Resource audience is missing");
  if (!requiredScopes.every((scope) => scopes.includes(scope))) {
    throw new Error("Required MCP scopes are missing");
  }
  if (!roles.includes("mcp_reader")) throw new Error("MCP reader role is missing");

  const mcpResponse = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "suleia-e2e", version: "1.0.0" },
      },
    }),
  });
  if (mcpResponse.status !== 200) {
    throw new Error(`Authenticated MCP initialize failed: ${mcpResponse.status}`);
  }

  const clientAudienceTokenResponse = await fetch(
    `${keycloakBase}/realms/suleia/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "chatgpt-suleia-mcp",
        username: email,
        password,
        scope: `openid ${requiredScopes.join(" ")}`,
      }),
    },
  );
  if (!clientAudienceTokenResponse.ok) {
    throw new Error(
      `Client-audience token failed: ${clientAudienceTokenResponse.status}`,
    );
  }
  const { access_token: clientAudienceToken } =
    await clientAudienceTokenResponse.json();
  const clientAudiencePayload = JSON.parse(
    Buffer.from(
      clientAudienceToken.split(".")[1],
      "base64url",
    ).toString("utf8"),
  );
  const clientAudiences = Array.isArray(clientAudiencePayload.aud)
    ? clientAudiencePayload.aud
    : [clientAudiencePayload.aud];
  if (!clientAudiences.includes("chatgpt-suleia-mcp")) {
    throw new Error("Static client audience is missing");
  }
  const clientAudienceMcpResponse = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${clientAudienceToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "suleia-e2e", version: "1.0.0" },
      },
    }),
  });
  if (clientAudienceMcpResponse.status !== 200) {
    throw new Error(
      `Client-audience MCP initialize failed: ${clientAudienceMcpResponse.status}`,
    );
  }

  console.log("audience_exact=1");
  console.log("non_resource_grant_url_audience=1");
  console.log("required_scopes=5");
  console.log("reader_role=1");
  console.log("authenticated_mcp_initialize=200");
  console.log("authenticated_mcp_client_audience=200");
} catch (error) {
  primaryError = error;
} finally {
  try {
    if (staticClient) {
      await adminRequest(`/admin/realms/suleia/clients/${staticClient.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...staticClient, directAccessGrantsEnabled: false }),
      });
    }
    if (testUserId) {
      await adminRequest(`/admin/realms/suleia/users/${testUserId}`, {
        method: "DELETE",
      });
    }
    const admins = await adminRequest(
      `/admin/realms/master/users?username=${adminUsername}&exact=true`,
    );
    const temporaryAdmin = admins.find((user) => user.username === adminUsername);
    if (temporaryAdmin) {
      await adminRequest(`/admin/realms/master/users/${temporaryAdmin.id}`, {
        method: "DELETE",
      });
    }
    console.log("temporary_e2e_identity_removed=1");
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
  }
}

if (primaryError) throw primaryError;

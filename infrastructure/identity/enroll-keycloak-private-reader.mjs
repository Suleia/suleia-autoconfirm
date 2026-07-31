const baseUrl = "http://keycloak:8080/auth";
const adminUsername = "suleia-config-admin";
const adminPassword = process.env.KEYCLOAK_CONFIG_ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error("KEYCLOAK_CONFIG_ADMIN_PASSWORD is required");
}

const tokenResponse = await fetch(
  `${baseUrl}/realms/master/protocol/openid-connect/token`,
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

if (!tokenResponse.ok) {
  throw new Error(`Temporary administrator token failed: ${tokenResponse.status}`);
}

const { access_token: accessToken } = await tokenResponse.json();

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
  return response.status === 204 ? null : response.json();
}

let primaryError;
try {
  const users = await adminRequest("/admin/realms/suleia/users?enabled=true");
  const humanUsers = users.filter((user) => !user.serviceAccountClientId);
  if (humanUsers.length !== 1) {
    throw new Error(
      `Expected exactly one enabled private user, found ${humanUsers.length}`,
    );
  }

  const readerRole = await adminRequest(
    "/admin/realms/suleia/roles/mcp_reader",
  );
  const userId = encodeURIComponent(humanUsers[0].id);
  const existingRoles = await adminRequest(
    `/admin/realms/suleia/users/${userId}/role-mappings/realm`,
  );
  if (!existingRoles.some((role) => role.name === "mcp_reader")) {
    await adminRequest(
      `/admin/realms/suleia/users/${userId}/role-mappings/realm`,
      { method: "POST", body: JSON.stringify([readerRole]) },
    );
  }

  await adminRequest(`/admin/realms/suleia/users/${userId}/logout`, {
    method: "POST",
  });

  const clients = await adminRequest(
    "/admin/realms/suleia/clients?clientId=chatgpt-suleia-mcp&search=true",
  );
  const staticClient = clients.find(
    (client) => client.clientId === "chatgpt-suleia-mcp",
  );
  if (!staticClient) {
    throw new Error("Static ChatGPT client is missing");
  }
  const consents = await adminRequest(
    `/admin/realms/suleia/users/${userId}/consents`,
  );
  if (consents.length > 0) {
    await adminRequest(
      `/admin/realms/suleia/users/${userId}/consents/${encodeURIComponent(staticClient.clientId)}`,
      { method: "DELETE" },
    );
  }

  const realm = await adminRequest("/admin/realms/suleia");
  await adminRequest("/admin/realms/suleia", {
    method: "PUT",
    body: JSON.stringify({ ...realm, registrationAllowed: false }),
  });

  console.log("The private Suleia user has the MCP reader role.");
  console.log("Pre-role OAuth sessions and consent were revoked.");
  console.log("Public user registration is disabled.");
} catch (error) {
  primaryError = error;
} finally {
  try {
    const admins = await adminRequest(
      `/admin/realms/master/users?username=${encodeURIComponent(adminUsername)}&exact=true`,
    );
    const temporaryAdmin = admins.find(
      (user) => user.username === adminUsername,
    );
    if (temporaryAdmin) {
      await adminRequest(
        `/admin/realms/master/users/${encodeURIComponent(temporaryAdmin.id)}`,
        { method: "DELETE" },
      );
    }
    console.log("Temporary Keycloak configuration administrator was removed.");
  } catch (cleanupError) {
    if (!primaryError) {
      primaryError = cleanupError;
    }
  }
}

if (primaryError) {
  throw primaryError;
}

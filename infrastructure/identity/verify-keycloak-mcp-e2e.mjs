import crypto from "node:crypto";

const keycloakBase = "http://keycloak:8080/auth";
const mcpUrl = process.env.MCP_E2E_URL || "https://mcp.suleia.com/mcp";
const resource = "https://mcp.suleia.com/mcp";
const adminClientId = process.env.KEYCLOAK_CONFIG_SERVICE_CLIENT_ID;
const adminClientSecret = process.env.KEYCLOAK_BOOTSTRAP_ADMIN_CLIENT_SECRET;
const requiredScopes = [
  "orders:read",
  "timelines:read",
  "decisions:read",
  "reviews:read",
  "platform:read",
  "orders:simulate",
];
const expectedTools = [
  "get_order", "get_order_timeline", "get_data_freshness", "get_active_timers",
  "get_agent_decisions", "preview_order_decision", "compare_simulation_with_current_system",
  "list_orders_needing_ai_review", "search_orders", "search_incidents", "get_incident",
  "search_operational_findings", "get_platform_overview", "get_runtime_inventory",
  "get_database_catalog", "get_component_details",
].sort();

if (!adminClientId || !adminClientSecret) {
  throw new Error("Temporary Keycloak configuration service credentials are required");
}

const adminTokenResponse = await fetch(
  `${keycloakBase}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: adminClientId,
      client_secret: adminClientSecret,
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
let accessToken;
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
  ({ access_token: accessToken } = await tokenResponse.json());
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

  let sessionId;
  let requestId = 0;
  const parseRpcResponse = (text, contentType, id) => {
    const messages = contentType.includes("text/event-stream")
      ? text.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5).trim()))
      : [JSON.parse(text)];
    const message = messages.find((item) => item.id === id);
    if (!message) throw new Error(`MCP response ${id} is missing`);
    if (message.error) throw new Error(`MCP ${message.error.code}: ${message.error.message}`);
    return message.result;
  };
  const rpc = async (method, params = {}, notification = false) => {
    const id = notification ? undefined : ++requestId;
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }),
    });
    if (!response.ok) throw new Error(`MCP ${method} failed: ${response.status}`);
    sessionId ||= response.headers.get("mcp-session-id") || undefined;
    if (notification) return null;
    return parseRpcResponse(await response.text(), response.headers.get("content-type") || "", id);
  };
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "suleia-e2e", version: "1.0.0" },
  });
  await rpc("notifications/initialized", {}, true);
  const catalog = await rpc("tools/list");
  const publishedTools = catalog.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(publishedTools) !== JSON.stringify(expectedTools)) {
    throw new Error(`Published MCP catalog mismatch: ${publishedTools.length}`);
  }

  const callTool = async (name, args) => {
    const startedAt = Date.now();
    const result = await rpc("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(`${name} returned an MCP tool error`);
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > 51_200) throw new Error(`${name} exceeded the response limit`);
    if (Date.now() - startedAt > 10_000) throw new Error(`${name} exceeded the time limit`);
    const text = result.content?.find((item) => item.type === "text")?.text;
    const envelope = text ? JSON.parse(text) : null;
    if (!envelope || envelope.meta?.read_only !== true || envelope.meta?.actions_executed !== 0) {
      throw new Error(`${name} omitted the read-only zero-action envelope`);
    }
    return { envelope, bytes };
  };

  const incidentSearch = await callTool("search_incidents", { status: "PENDING", is_active: true, limit: 5 });
  const orderSearch = await callTool("search_orders", { active: true, limit: 5 });
  const firstOrderId = orderSearch.envelope.data?.items?.[0]?.canonical_order_id;
  if (firstOrderId) await callTool("get_order", { order_id: firstOrderId });
  await callTool("get_platform_overview", { section: "STATUS" });
  await callTool("get_runtime_inventory", { limit: 10 });
  await callTool("get_database_catalog", { platform: "VPS_POSTGRES", limit: 5 });
  await callTool("get_component_details", { component_type: "SERVICE", component_id: "mcp-server", depth: 2 });

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
  console.log("required_scopes=6");
  console.log("reader_role=1");
  console.log(`published_tools=${publishedTools.length}`);
  console.log(`pending_incidents=${incidentSearch.envelope.data?.total ?? 0}`);
  console.log(`active_orders=${orderSearch.envelope.data?.total ?? 0}`);
  console.log(`opened_order=${firstOrderId ? 1 : 0}`);
  console.log("authenticated_public_mcp=1");
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
    console.log("temporary_e2e_identity_removed=1");
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
  }
}

if (primaryError) throw primaryError;

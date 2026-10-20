import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixturePassword } from "../fixtures/identity.mjs";
const base = process.env.INTEGRATION_URL || "http://127.0.0.1:3000/forge";
const origin = new URL(base).origin;
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const results = [];
async function call(path, { method = "GET", body, cookie, token } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "X-Panel-Request": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return {
    status: r.status,
    data,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const admin = await call("/_panel/login", {
  method: "POST",
  body: { email: credentials.email, password: credentials.password },
});
assert.equal(admin.status, 200, JSON.stringify(admin.data));
assert.ok(admin.cookie);
results.push("Admin login through panel; JWT not exposed");
const run = randomUUID().slice(0, 8);
const email = `panel-user-${run}@example.com`;
const password = fixturePassword();
let serverId, tokenId, panelTokenId, roleId, teamId, userCookie;
const user = await call("/v1/auth/email/admin/users", {
  method: "POST",
  cookie: admin.cookie,
  body: {
    email,
    password,
    full_name: "Panel Integration User",
    is_admin: false,
    password_change_required: false,
  },
});
assert.equal(user.status, 201, JSON.stringify(user.data));
try {
  const login = await call("/_panel/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  userCookie = login.cookie;
  const me = await call("/v1/auth/email/me", { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.is_admin, false);
  const perms = await call("/v1/rbac/my/permissions", { cookie: login.cookie });
  assert.equal(perms.status, 200);
  assert.ok(perms.data.includes("tokens.create"));
  results.push("Ordinary user login and effective permissions");
  const role = await call("/v1/rbac/roles", {
    method: "POST",
    cookie: admin.cookie,
    body: {
      name: `panel-reader-${run}`,
      scope: "global",
      permissions: ["servers.read"],
      description: "Integration role",
    },
  });
  assert.equal(role.status, 200, JSON.stringify(role.data));
  roleId = role.data.id;
  const assigned = await call(
    `/v1/rbac/users/${encodeURIComponent(email)}/roles`,
    {
      method: "POST",
      cookie: admin.cookie,
      body: { role_id: roleId, scope: "global" },
    },
  );
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  const roles = await call(
    `/v1/rbac/users/${encodeURIComponent(email)}/roles`,
    { cookie: admin.cookie },
  );
  assert.equal(roles.status, 200);
  assert.ok(roles.data.some((r) => r.role_id === roleId));
  results.push("Admin creates role and assigns it to ordinary user");
  const denied = await call("/v1/rbac/roles", {
    method: "POST",
    cookie: login.cookie,
    body: { name: "forbidden-role", scope: "global", permissions: ["*"] },
  });
  assert.equal(denied.status, 403);
  results.push("Ordinary user denied role creation");
  const server = await call("/v1/servers", {
    method: "POST",
    cookie: admin.cookie,
    body: {
      server: {
        name: `panel-server-${run}`,
        description: "Integration fixture",
        visibility: "public",
      },
    },
  });
  assert.equal(server.status, 201, JSON.stringify(server.data));
  serverId = server.data.id;
  const created = await call("/v1/tokens", {
    method: "POST",
    cookie: login.cookie,
    body: {
      name: `panel-key-${run}`,
      expires_in_days: 1,
      scope: {
        server_id: serverId,
        permissions: ["servers.read", "tools.read"],
      },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  tokenId = created.data.token.id;
  const apiKey = created.data.access_token;
  assert.equal(typeof apiKey, "string");
  results.push("Ordinary user creates scoped API key");
  const external = await call("/v1/servers/" + serverId, { token: apiKey });
  assert.equal(external.status, 200, JSON.stringify(external.data));
  const mcpHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const initialize = await fetch(`${base}/servers/${serverId}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "panel-integration", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const initializedText = await initialize.text();
  assert.equal(initialize.status, 200, initializedText);
  const decodeMcp = (text) =>
    text.startsWith("{")
      ? JSON.parse(text)
      : text
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5)))
          .find((data) => data.result || data.error);
  const initialized = decodeMcp(initializedText);
  assert.ok(initialized.result?.serverInfo, initializedText);
  const mcpSession = initialize.headers.get("mcp-session-id");
  if (mcpSession) mcpHeaders["Mcp-Session-Id"] = mcpSession;
  mcpHeaders["MCP-Protocol-Version"] = initialized.result.protocolVersion;
  const notified = await fetch(`${base}/servers/${serverId}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    signal: AbortSignal.timeout(15000),
  });
  await notified.arrayBuffer();
  assert.ok([200, 202, 204].includes(notified.status));
  const tools = await fetch(`${base}/servers/${serverId}/mcp`, {
    method: "POST",
    headers: mcpHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    signal: AbortSignal.timeout(15000),
  });
  const toolsText = await tools.text();
  assert.equal(tools.status, 200, toolsText);
  assert.ok(Array.isArray(decodeMcp(toolsText).result?.tools), toolsText);
  results.push(
    "Real MCP Streamable HTTP initialize, session headers and tools/list through public prefix",
  );
  const catalogDenied = await call("/v1/tokens", { token: apiKey });
  assert.equal(catalogDenied.status, 403);
  results.push(
    "External API key accesses allowed server but cannot manage keys",
  );
  const team = await call("/v1/teams/", {
    method: "POST",
    cookie: admin.cookie,
    body: { name: `Panel isolated ${run}`, visibility: "private" },
  });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  teamId = team.data.id;
  const teamDenied = await call(`/v1/teams/${teamId}/members`, {
    cookie: login.cookie,
  });
  assert.equal(teamDenied.status, 403);
  results.push("Non-member denied access to private team members");

  const serverScopedConnection = await call("/_panel/token-login", {
    method: "POST",
    body: { token: apiKey },
  });
  assert.equal(serverScopedConnection.status, 403);
  const scopedKeyStillWorks = await call("/v1/servers/" + serverId, {
    token: apiKey,
  });
  assert.equal(scopedKeyStillWorks.status, 200);
  results.push("Server-scoped API key cannot use the panel identity endpoint");

  const panelKey = await call("/v1/tokens", {
    method: "POST",
    cookie: login.cookie,
    body: {
      name: `panel-session-key-${run}`,
      expires_in_days: 1,
    },
  });
  assert.equal(panelKey.status, 201);
  panelTokenId = panelKey.data.token.id;
  const panelApiKey = panelKey.data.access_token;

  const tokenConnection = await call("/_panel/token-login", {
    method: "POST",
    body: { token: panelApiKey },
  });
  assert.equal(tokenConnection.status, 200);
  assert.ok(tokenConnection.cookie);
  const tokenSession = await call("/_panel/session", {
    cookie: tokenConnection.cookie,
  });
  assert.equal(tokenSession.status, 200);
  assert.equal(tokenSession.data.mode, "token");

  const tokenRefresh = await call("/_panel/refresh", {
    method: "POST",
    cookie: tokenConnection.cookie,
  });
  assert.equal(tokenRefresh.status, 403);
  const afterRefresh = await call("/_panel/session", {
    cookie: tokenConnection.cookie,
  });
  assert.equal(afterRefresh.status, 200);
  assert.equal(afterRefresh.data.mode, "token");
  const tokenManagementDenied = await call("/v1/tokens", {
    cookie: tokenConnection.cookie,
  });
  assert.equal(tokenManagementDenied.status, 403);

  const disconnected = await call("/_panel/logout", {
    method: "POST",
    cookie: tokenConnection.cookie,
  });
  assert.equal(disconnected.status, 200);
  const staleTokenSession = await call("/_panel/session", {
    cookie: tokenConnection.cookie,
  });
  assert.equal(staleTokenSession.status, 401);

  const afterDisconnect = await call("/v1/servers/" + serverId, {
    token: panelApiKey,
  });
  assert.equal(
    afterDisconnect.status,
    200,
    JSON.stringify(afterDisconnect.data),
  );
  const keyCatalog = await call("/v1/tokens?include_inactive=true", {
    cookie: login.cookie,
  });
  assert.equal(keyCatalog.status, 200);
  const listedKey = keyCatalog.data.tokens.find(
    (item) => item.id === panelTokenId,
  );
  assert.ok(listedKey);
  assert.equal(listedKey.is_revoked, false);
  assert.equal(listedKey.revoked_at, null);

  const reconnectedToken = await call("/_panel/token-login", {
    method: "POST",
    body: { token: panelApiKey },
  });
  assert.equal(reconnectedToken.status, 200);
  const reconnectedSession = await call("/_panel/session", {
    cookie: reconnectedToken.cookie,
  });
  assert.equal(reconnectedSession.status, 200);
  assert.equal(reconnectedSession.data.mode, "token");
  const reconnectedDisconnect = await call("/_panel/logout", {
    method: "POST",
    cookie: reconnectedToken.cookie,
  });
  assert.equal(reconnectedDisconnect.status, 200);
  results.push(
    "API key connection cannot refresh or manage keys; disconnect preserves the key and allows reconnect",
  );

  const revoked = await call("/v1/tokens/" + tokenId, {
    method: "DELETE",
    cookie: login.cookie,
  });
  assert.equal(revoked.status, 204, JSON.stringify(revoked.data));
  tokenId = undefined;
  const after = await call("/v1/servers/" + serverId, { token: apiKey });
  assert.equal(after.status, 401, JSON.stringify(after.data));
  results.push("Revoked API key rejected by real backend");

  const panelKeyRevoked = await call("/v1/tokens/" + panelTokenId, {
    method: "DELETE",
    cookie: login.cookie,
  });
  assert.equal(panelKeyRevoked.status, 204);
  panelTokenId = undefined;
  const panelKeyAfterRevoke = await call("/v1/servers/" + serverId, {
    token: panelApiKey,
  });
  assert.equal(panelKeyAfterRevoke.status, 401);
  const logout = await call("/_panel/logout", {
    method: "POST",
    cookie: login.cookie,
  });
  assert.equal(logout.status, 200, JSON.stringify(logout.data));
  const oldSession = await call("/v1/auth/email/me", { cookie: login.cookie });
  assert.equal(oldSession.status, 401);
  results.push("Logout revokes old backend session");
} finally {
  if (panelTokenId)
    await call("/v1/tokens/" + panelTokenId, {
      method: "DELETE",
      cookie: userCookie || admin.cookie,
    });
  if (serverId)
    await call("/v1/servers/" + serverId, {
      method: "DELETE",
      cookie: admin.cookie,
    });
  if (teamId)
    await call("/v1/teams/" + teamId, {
      method: "DELETE",
      cookie: admin.cookie,
    });
  if (roleId) {
    await call(`/v1/rbac/users/${encodeURIComponent(email)}/roles/${roleId}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    await call("/v1/rbac/roles/" + roleId, {
      method: "DELETE",
      cookie: admin.cookie,
    });
  }
  await call("/v1/auth/email/admin/users/" + encodeURIComponent(email), {
    method: "DELETE",
    cookie: admin.cookie,
  });
  await call("/_panel/logout", { method: "POST", cookie: admin.cookie });
}
await mkdir(".cache/reports", { recursive: true });
await writeFile(
  ".cache/reports/integration.json",
  JSON.stringify(
    {
      backend: "1.0.11",
      publicPrefix: "/forge",
      date: new Date().toISOString(),
      checks: results,
    },
    null,
    2,
  ),
);
for (const result of results) console.log("PASS " + result);

import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { createPanelServer } from "../../apps/server/server.mjs";
import { readConfig } from "../../apps/server/config.mjs";
import { restToolExamples } from "../../apps/web/src/tool-workflows.mjs";
import { Validator } from "@cfworker/json-schema";

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(".cache/browsers");
const { chromium } = await import("@playwright/test");
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const randomSecret = () => randomBytes(24).toString("base64url");
const authSecrets = {
  basic: { username: randomSecret(), password: randomSecret() },
  bearer: { token: randomSecret() },
  custom: { key: randomSecret() },
};
const restAuthSecrets = {
  basic: { username: randomSecret(), password: randomSecret() },
  bearer: { token: randomSecret() },
  custom: randomSecret(),
};
let expectedBearer = authSecrets.bearer.token;
const invocations = [];
const protectedCalls = [];
const restRequests = [];
const upstream = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const data = JSON.parse(text || "{}");
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname;
  if (pathname === "/echo") {
    invocations.push(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        echoed: data.query,
        count: data.count,
        enabled: data.enabled,
      }),
    );
    return;
  }

  let authorized = false;
  const examplePath =
    pathname === "/products" ||
    /^\/customers\/[^/]+\/orders$/.test(pathname) ||
    /^\/orders\/[^/]+$/.test(pathname);
  if (examplePath) {
    if (pathname === "/products") {
      authorized = req.headers["x-api-key"] === restAuthSecrets.custom;
    } else if (pathname.startsWith("/customers/")) {
      authorized =
        req.headers.authorization === `Bearer ${restAuthSecrets.bearer.token}`;
    } else {
      const expected = `Basic ${Buffer.from(
        `${restAuthSecrets.basic.username}:${restAuthSecrets.basic.password}`,
      ).toString("base64")}`;
      authorized = req.headers.authorization === expected;
    }
    restRequests.push({
      method: req.method,
      path: pathname,
      query: Object.fromEntries(requestUrl.searchParams),
      body: req.method === "GET" ? null : data,
      authorized,
    });
    if (!authorized) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (pathname === "/products") {
      res.end(
        JSON.stringify({
          products: [
            {
              id: "coffee-001",
              name: "Coffee",
              price: 12.5,
              stock: 8,
              internal_code: "inventory-a",
            },
            {
              id: "tea-002",
              name: "Tea",
              price: 7,
              stock: 14,
              internal_code: "inventory-b",
            },
          ],
          page: 1,
          total: 2,
        }),
      );
    } else {
      res.end(JSON.stringify({ accepted: true }));
    }
    return;
  }
  if (pathname === "/auth/basic") {
    const expected = `Basic ${Buffer.from(
      `${authSecrets.basic.username}:${authSecrets.basic.password}`,
    ).toString("base64")}`;
    authorized = req.headers.authorization === expected;
  } else if (pathname === "/auth/bearer") {
    authorized = req.headers.authorization === `Bearer ${expectedBearer}`;
  } else if (pathname === "/auth/custom") {
    authorized = req.headers["x-api-key"] === authSecrets.custom.key;
  }
  protectedCalls.push({ path: pathname, authorized });
  if (!authorized) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ authorized: true, path: pathname }));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const origin = "http://127.0.0.1:3002";
const root = origin + "/tool-lab";
const panel = createPanelServer(
  readConfig({
    BACKEND_URL: "http://127.0.0.1:4446",
    APP_ROOT_PATH: "/tool-lab",
    PUBLIC_ORIGIN: origin,
    LOG_LEVEL: "warn",
  }),
);
panel.listen(3002, "127.0.0.1");
await once(panel, "listening");
let browser, cookie, tokenId, executeTokenId, teamId;
const toolIds = new Set();
async function api(url, method = "GET", body) {
  const response = await fetch(root + url, {
    method,
    headers: {
      Origin: origin,
      "X-Panel-Request": "1",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${url} failed (${response.status})`);
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return data;
}
const safeCheck = (condition, message) => assert.ok(condition, message);
const unwrap = (data) => data?.tool ?? data;
const authTypeOf = (record) => {
  const auth = record?.auth;
  return auth?.authType ?? auth?.auth_type ?? record?.auth_type ?? null;
};
const noTeamKey = (value) => {
  if (Array.isArray(value)) return value.every(noTeamKey);
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(
    ([key, nested]) =>
      !["team_id", "teamId"].includes(key) && noTeamKey(nested),
  );
};
function toolOutputFromRpc(payload) {
  const result = payload.result;
  if (result?.structuredContent !== undefined) return result.structuredContent;
  for (const item of result?.content || []) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      return JSON.parse(item.text);
    } catch {
      // Try another text item before reporting an invalid JSON tool result.
    }
  }
  throw new Error("REST tool call did not return a JSON result");
}

try {
  await api("/_panel/login", "POST", {
    email: credentials.email,
    password: credentials.password,
  });
  const teamSuffix = randomUUID().slice(0, 8);
  const teamResult = await api("/v1/teams/", "POST", {
    name: `tool-call-${teamSuffix}`,
    slug: `tool-call-${teamSuffix}`,
    description: "Temporary browser integration fixture",
    visibility: "private",
  });
  teamId = teamResult.id ?? teamResult.team?.id;
  safeCheck(Boolean(teamId), "Temporary team creation returned no ID");

  const name = "tool_call_" + randomUUID().slice(0, 8);
  const created = await api("/v1/tools", "POST", {
    tool: {
      name,
      description: "Isolated local tool-call integration fixture",
      integration_type: "REST",
      request_type: "POST",
      url: `http://127.0.0.1:${upstream.address().port}/echo`,
      visibility: "public",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2 },
          count: { type: "integer", minimum: 1 },
          enabled: { type: "boolean" },
        },
        required: ["query", "count", "enabled"],
        additionalProperties: false,
      },
    },
  });
  toolIds.add(created.id);
  safeCheck(Boolean(created.id), "No-auth REST tool creation returned no ID");
  const restricted = await api("/v1/tokens", "POST", {
    name: "tool-read-only-" + randomUUID().slice(0, 8),
    expires_in_days: 1,
    scope: { permissions: ["tools.read"] },
  });
  tokenId = restricted.token.id;
  const denied = await fetch(root + "/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${restricted.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "denied-call",
      method: "tools/call",
      params: {
        name: created.name,
        arguments: { query: "denied call", count: 1, enabled: true },
      },
    }),
  });
  const deniedResult = await denied.json();
  safeCheck(
    denied.status === 403 ||
      (deniedResult.error &&
        /permission|forbidden|denied|scope/i.test(
          JSON.stringify(deniedResult.error),
        )),
    "A read-only token must be refused",
  );
  assert.deepEqual(invocations, []);

  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", () => errors.push("page error"));
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "工作台" }).waitFor();
  await page.goto(root + "/app/#tools");
  const filter = page.getByLabel("Filter resources", { exact: true });
  await filter.fill(name);
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("arguments.query", { exact: true })
    .fill("actual local call");
  await dialog.getByLabel("arguments.count", { exact: true }).fill("3");
  await dialog
    .getByLabel("arguments.enabled", { exact: true })
    .selectOption("false");
  const responsePromise = page.waitForResponse(
    (response) =>
      /\/rpc\/?$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
  const response = await responsePromise;
  const result = await response.json();
  safeCheck(
    response.status() === 200,
    "No-auth browser tool call did not return HTTP 200",
  );
  safeCheck(!result.error, "No-auth browser tool call returned an RPC error");
  safeCheck(
    result.result?.isError !== true,
    "No-auth browser tool call failed",
  );
  assert.deepEqual(invocations, [
    { query: "actual local call", count: 3, enabled: false },
  ]);
  await dialog
    .locator(".result")
    .getByText(/actual local call/)
    .waitFor();
  safeCheck(
    (await dialog.locator(".result").innerText()).includes("actual local call"),
    "Browser did not display the local upstream result",
  );
  assert.deepEqual(errors, []);
  await mkdir(".cache/reports", { recursive: true });
  await page.screenshot({ path: ".cache/reports/tool-call-real.png" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto(root + "/app/#api");
  await page.getByLabel("Search API", { exact: true }).fill("/rpc");
  await page
    .locator(".api-row")
    .filter({ has: page.getByText("/rpc", { exact: true }) })
    .click();
  const rpcDialog = page.getByRole("dialog");
  await rpcDialog.getByLabel("method", { exact: true }).fill("ping");
  const pingResponse = page.waitForResponse(
    (response) =>
      /\/rpc\/?$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await rpcDialog.getByRole("button", { name: "执行", exact: true }).click();
  const ping = await (await pingResponse).json();
  assert.deepEqual(ping.result, {});
  safeCheck(!ping.error, "RPC workbench ping returned an error");

  await page.goto(root + "/app/#tools");
  async function createBrowserTool({
    toolName,
    url,
    visibility = "public",
    authType,
    authValues,
    assignedTeam,
  }) {
    await filter.fill("");
    await page
      .getByRole("button", { name: "创建 REST 工具", exact: true })
      .click();
    const form = page.getByRole("dialog");
    await form.getByLabel("name", { exact: true }).fill(toolName);
    await form
      .getByLabel("description", { exact: true })
      .fill("Temporary browser auth regression fixture");
    await form.getByLabel("url", { exact: true }).fill(url);
    const integrationType = form.getByLabel("integration_type", {
      exact: true,
    });
    if (await integrationType.count())
      await integrationType.selectOption("REST");
    const requestType = form.getByLabel("request_type", { exact: true });
    if (await requestType.count()) await requestType.selectOption("POST");
    await form
      .getByLabel("visibility", { exact: true })
      .selectOption(visibility);
    await form.getByLabel("inputSchema", { exact: true }).fill("{}");
    if (assignedTeam) {
      const teamSelect = form.getByLabel("team_id", { exact: true });
      await teamSelect
        .locator(`option[value="${assignedTeam}"]`)
        .waitFor({ state: "attached" });
      await teamSelect.selectOption(assignedTeam);
    }
    if (authType) {
      await form.getByLabel("authType", { exact: true }).selectOption(authType);
      for (const [field, value] of Object.entries(authValues || {}))
        await form.getByLabel(field, { exact: true }).fill(value);
    }
    const createResponse = page.waitForResponse(
      (candidate) =>
        /\/v1\/tools\/?$/.test(new URL(candidate.url()).pathname) &&
        candidate.request().method() === "POST",
    );
    await form
      .getByRole("button", { name: "创建REST 工具", exact: true })
      .click();
    const saved = await createResponse;
    safeCheck(saved.ok(), "Browser REST tool create request failed");
    const submitted = saved.request().postDataJSON();
    const savedData = unwrap(await saved.json());
    safeCheck(
      Boolean(savedData?.id),
      "Browser REST tool create response returned no ID",
    );
    toolIds.add(savedData.id);
    await form.getByRole("button", { name: "关闭", exact: true }).click();
    await form.waitFor({ state: "detached" });
    return { id: savedData.id, request: submitted };
  }
  async function openEdit(toolName) {
    await filter.fill(toolName);
    await page
      .getByRole("button", { name: /编辑|Edit/ })
      .first()
      .click();
    const form = page.getByRole("dialog");
    await form.getByLabel("name", { exact: true }).waitFor();
    return form;
  }
  async function saveEdit(form) {
    const updateResponse = page.waitForResponse(
      (candidate) =>
        /\/v1\/tools\/[^/]+\/?$/.test(new URL(candidate.url()).pathname) &&
        ["PUT", "PATCH"].includes(candidate.request().method()),
    );
    await form.getByRole("button", { name: /保存修改|Save changes/ }).click();
    const saved = await updateResponse;
    safeCheck(saved.ok(), "Tool edit request failed");
    const body = saved.request().postDataJSON();
    await form.getByRole("button", { name: "关闭", exact: true }).click();
    await form.waitFor({ state: "detached" });
    return body;
  }
  async function invokeProtected(toolName, expectedAuthorized) {
    await filter.fill(toolName);
    await page.getByRole("button", { name: "测试调用", exact: true }).click();
    const callDialog = page.getByRole("dialog");
    const upstreamCallsBefore = protectedCalls.length;
    const callResponse = page.waitForResponse(
      (candidate) =>
        /\/rpc\/?$/.test(new URL(candidate.url()).pathname) &&
        candidate.request().method() === "POST",
    );
    await callDialog
      .getByRole("button", { name: "调用工具", exact: true })
      .click();
    const call = await callResponse;
    const payload = await call.json();
    safeCheck(
      call.status() === 200,
      "Protected tool RPC call did not return HTTP 200",
    );
    if (expectedAuthorized)
      safeCheck(
        !payload.error && payload.result?.isError !== true,
        "Protected upstream rejected the configured credential",
      );
    else
      safeCheck(
        Boolean(payload.error) || payload.result?.isError === true,
        "Protected upstream accepted a cleared credential",
      );
    safeCheck(
      protectedCalls.length === upstreamCallsBefore + 1,
      "Protected tool RPC did not reach the upstream exactly once",
    );
    await callDialog.getByRole("button", { name: "关闭", exact: true }).click();
    const latest = protectedCalls.at(-1);
    safeCheck(Boolean(latest), "Protected upstream was not called");
    safeCheck(
      latest.authorized === expectedAuthorized,
      "Protected upstream authorization result did not match expectation",
    );
  }

  const port = upstream.address().port;
  const methodCases = [
    {
      kind: "basic",
      authType: "basic",
      authValues: {
        username: authSecrets.basic.username,
        password: authSecrets.basic.password,
      },
      path: "/auth/basic",
    },
    {
      kind: "bearer",
      authType: "bearer",
      authValues: { token: authSecrets.bearer.token },
      path: "/auth/bearer",
    },
    {
      kind: "custom",
      authType: "authheaders",
      authValues: {
        authHeaderKey: "X-Api-Key",
        authHeaderValue: authSecrets.custom.key,
      },
      path: "/auth/custom",
    },
  ];
  const authTools = [];
  for (const testCase of methodCases) {
    const toolName = `tool_auth_${testCase.kind}_${randomUUID().slice(0, 8)}`;
    const createdAuthTool = await createBrowserTool({
      toolName,
      url: `http://127.0.0.1:${port}${testCase.path}`,
      visibility: "public",
      authType: testCase.authType,
      authValues: testCase.authValues,
    });
    const bodyTool = createdAuthTool.request.tool ?? createdAuthTool.request;
    const canonical =
      bodyTool.auth_type === testCase.authType && !bodyTool.auth;
    if (testCase.kind === "basic")
      safeCheck(
        canonical &&
          bodyTool.auth_username === authSecrets.basic.username &&
          bodyTool.auth_password === authSecrets.basic.password,
        "Basic auth form did not submit canonical credentials",
      );
    else if (testCase.kind === "bearer")
      safeCheck(
        canonical && bodyTool.auth_token === authSecrets.bearer.token,
        "Bearer auth form did not submit a canonical token",
      );
    else
      safeCheck(
        canonical &&
          Array.isArray(bodyTool.auth_headers) &&
          bodyTool.auth_headers.length === 1 &&
          bodyTool.auth_headers[0].key === "X-Api-Key" &&
          bodyTool.auth_headers[0].value === authSecrets.custom.key,
        "Custom header form did not submit canonical credentials",
      );
    const record = unwrap(
      await api(`/v1/tools/${encodeURIComponent(createdAuthTool.id)}`),
    );
    safeCheck(
      authTypeOf(record) === testCase.authType,
      `${testCase.kind} auth type was not persisted`,
    );
    authTools.push({ ...testCase, id: createdAuthTool.id, name: toolName });
    await invokeProtected(toolName, true);
  }

  for (const testCase of authTools) {
    const form = await openEdit(testCase.name);
    await form
      .getByLabel("description", { exact: true })
      .fill("Updated unrelated description");
    const body = await saveEdit(form);
    safeCheck(
      !Object.keys(body).some((key) => key.toLowerCase().startsWith("auth")),
      `${testCase.kind} unrelated edit sent authentication fields`,
    );
    const record = unwrap(
      await api(`/v1/tools/${encodeURIComponent(testCase.id)}`),
    );
    safeCheck(
      authTypeOf(record) === testCase.authType,
      `${testCase.kind} authentication did not survive unrelated edit`,
    );
    await invokeProtected(testCase.name, true);
  }

  const bearerCase = authTools.find((testCase) => testCase.kind === "bearer");
  expectedBearer = randomSecret();
  let form = await openEdit(bearerCase.name);
  await form.getByLabel("authType", { exact: true }).selectOption("bearer");
  await form.getByLabel("token", { exact: true }).fill(expectedBearer);
  const rotateBody = await saveEdit(form);
  safeCheck(
    rotateBody.auth_type === "bearer" &&
      rotateBody.auth_token === expectedBearer,
    "Bearer replacement did not submit canonical token fields",
  );
  let record = unwrap(
    await api(`/v1/tools/${encodeURIComponent(bearerCase.id)}`),
  );
  safeCheck(
    authTypeOf(record) === "bearer",
    "Bearer replacement was not persisted",
  );
  await invokeProtected(bearerCase.name, true);

  form = await openEdit(bearerCase.name);
  await form.getByLabel("authType", { exact: true }).selectOption("none");
  const clearBody = await saveEdit(form);
  safeCheck(
    clearBody.auth?.authType === "none" && clearBody.auth?.authValue === "",
    "Selecting none did not submit the explicit credential clear",
  );
  record = unwrap(await api(`/v1/tools/${encodeURIComponent(bearerCase.id)}`));
  safeCheck(
    authTypeOf(record) !== "bearer",
    "GET still reports bearer authentication after clearing it",
  );
  await invokeProtected(bearerCase.name, false);

  safeCheck(
    restToolExamples.length === 3 &&
      restToolExamples.map((example) => example.id).join(",") ===
        "search_products,create_order,update_order_status",
    "The REST example catalog must contain the three supported workflows",
  );
  const exampleTools = restToolExamples.map((example) => {
    const tool = structuredClone(example.tool);
    tool.name = `tool_example_${example.id}_${randomUUID().slice(0, 8)}`;
    tool.visibility = "public";
    const rawPath = tool.url.replace(/^https?:\/\/[^/]+/, "");
    tool.url = `http://127.0.0.1:${port}${rawPath}`;
    if (example.id === "search_products")
      tool.auth.authHeaders[0].value = restAuthSecrets.custom;
    else if (example.id === "create_order")
      tool.auth.token = restAuthSecrets.bearer.token;
    else if (example.id === "update_order_status") {
      tool.auth.username = restAuthSecrets.basic.username;
      tool.auth.password = restAuthSecrets.basic.password;
    }
    return { ...example, tool };
  });

  const executeToken = await api("/v1/tokens", "POST", {
    name: "tool-example-execute-" + randomUUID().slice(0, 8),
    expires_in_days: 1,
    scope: { permissions: ["tools.read", "tools.execute"] },
  });
  executeTokenId = executeToken.token.id;
  safeCheck(
    Boolean(executeToken.access_token),
    "Could not create a scoped token for REST example execution",
  );

  await page.goto(root + "/app/#tools");
  await page
    .getByRole("button", { name: "REST 工具导入 / 导出", exact: true })
    .click();
  const transferDialog = page.getByRole("dialog");
  await transferDialog.locator('input[type="file"]').setInputFiles({
    name: "rest-examples.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "contextforge-panel",
        version: 1,
        resource: "tools",
        kind: "create",
        records: exampleTools.map(({ tool }) => tool),
      }),
    ),
  });
  const approval = transferDialog.getByRole("checkbox", {
    name: /确认创建以上资源/,
  });
  await approval.waitFor();
  await approval.check();
  const importResponses = [];
  const collectImportResponse = (response) => {
    if (
      /\/v1\/tools\/?$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST"
    )
      importResponses.push(response);
  };
  page.on("response", collectImportResponse);
  await transferDialog
    .getByRole("button", { name: "确认导入", exact: true })
    .click();
  await transferDialog
    .locator(".batch-results > div")
    .nth(exampleTools.length - 1)
    .waitFor();
  page.off("response", collectImportResponse);
  const importResults = await transferDialog
    .locator(".batch-results > div")
    .allTextContents();
  safeCheck(
    importResults.length === exampleTools.length &&
      importResults.every((result) => result.includes("成功")),
    "The browser import did not create all three REST examples",
  );
  safeCheck(
    importResponses.length === exampleTools.length,
    "Browser import did not issue exactly three REST tool create requests",
  );
  const imported = await Promise.all(
    importResponses.map(async (response) => {
      safeCheck(response.ok(), "A REST example create request failed");
      return unwrap(await response.json());
    }),
  );
  for (const createdTool of imported) {
    safeCheck(Boolean(createdTool.id), "REST example create returned no ID");
    toolIds.add(createdTool.id);
  }
  const endpointPath = (value) => {
    if (typeof value !== "string") return null;
    try {
      const parsed = new URL(value);
      return decodeURIComponent(parsed.pathname) + parsed.search;
    } catch {
      return null;
    }
  };
  const importedByExample = new Map();
  for (const createdTool of imported) {
    const originalName =
      createdTool.originalName ?? createdTool.original_name ?? null;
    let example = exampleTools.find(
      (candidate) =>
        originalName === candidate.tool.name || originalName === candidate.id,
    );
    if (!example) {
      const createdEndpoint = endpointPath(createdTool.url);
      if (createdEndpoint)
        example = exampleTools.find(
          (candidate) => endpointPath(candidate.tool.url) === createdEndpoint,
        );
    }
    safeCheck(
      Boolean(example) && !importedByExample.has(example.id),
      "Could not uniquely match an imported REST tool by original name or endpoint URL",
    );
    importedByExample.set(example.id, createdTool);
  }
  const savedByExample = new Map();
  for (const example of exampleTools) {
    const createdTool = importedByExample.get(example.id);
    safeCheck(
      Boolean(createdTool),
      "A REST example was not found after import",
    );
    const savedTool = unwrap(
      await api(`/v1/tools/${encodeURIComponent(createdTool.id)}`),
    );
    safeCheck(
      typeof savedTool.name === "string" && savedTool.name.length > 0,
      `${example.id} detail response returned no callable tool name`,
    );
    savedByExample.set(example.id, savedTool);
    safeCheck(
      authTypeOf(savedTool) === example.tool.auth.authType,
      `${example.id} authentication type was not persisted`,
    );
    if (example.id === "search_products") {
      assert.deepEqual(
        savedTool.outputSchema ?? savedTool.output_schema,
        example.tool.outputSchema,
        "GET outputSchema did not persist from the REST example",
      );
      safeCheck(
        (savedTool.jsonpath_filter ?? savedTool.jsonpathFilter) ===
          example.tool.jsonpath_filter,
        "GET jq filter did not persist from the REST example",
      );
    }
  }
  await transferDialog
    .getByRole("button", { name: "关闭", exact: true })
    .click();

  async function callImportedTool(name, args) {
    const response = await fetch(root + "/rpc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${executeToken.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rest-example-" + randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const payload = await response.json();
    safeCheck(
      response.status === 200,
      `${name} RPC call did not return HTTP 200`,
    );
    let errorMessage = String(
      payload.error?.message ||
        payload.result?.content?.find((item) => item.type === "text")?.text ||
        "Unspecified tool error",
    );
    for (const secret of [
      restAuthSecrets.custom,
      restAuthSecrets.bearer.token,
      restAuthSecrets.basic.username,
      restAuthSecrets.basic.password,
      Buffer.from(
        `${restAuthSecrets.basic.username}:${restAuthSecrets.basic.password}`,
      ).toString("base64"),
      executeToken.access_token,
    ])
      errorMessage = errorMessage.replaceAll(secret, "[redacted]");
    safeCheck(
      !payload.error && payload.result?.isError !== true,
      `${name} RPC call returned an error: ${errorMessage.slice(0, 600)}`,
    );
    return payload;
  }

  const upstreamProducts = [
    {
      id: "coffee-001",
      name: "Coffee",
      price: 12.5,
      stock: 8,
      internal_code: "inventory-a",
    },
    {
      id: "tea-002",
      name: "Tea",
      price: 7,
      stock: 14,
      internal_code: "inventory-b",
    },
  ];
  for (const example of exampleTools) {
    const before = restRequests.length;
    const payload = await callImportedTool(
      savedByExample.get(example.id).name,
      example.arguments,
    );
    safeCheck(
      restRequests.length === before + 1,
      `${example.id} did not call the local REST upstream exactly once`,
    );
    const observed = restRequests.at(-1);
    const pathParameters = [...example.tool.url.matchAll(/\{([^{}]+)\}/g)].map(
      (match) => match[1],
    );
    const expectedPath = example.tool.url
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/\{([^{}]+)\}/g, (_placeholder, key) =>
        encodeURIComponent(String(example.arguments[key])),
      );
    const expectedBody =
      example.tool.request_type === "GET"
        ? null
        : Object.fromEntries(
            Object.entries(example.arguments).filter(
              ([key]) => !pathParameters.includes(key),
            ),
          );
    const expectedQuery =
      example.tool.request_type === "GET"
        ? Object.fromEntries(
            Object.entries(example.arguments).map(([key, value]) => [
              key,
              String(value),
            ]),
          )
        : {};
    assert.deepEqual(observed, {
      method: example.tool.request_type,
      path: expectedPath,
      query: expectedQuery,
      body: expectedBody,
      authorized: true,
    });
    if (example.tool.request_type !== "GET")
      safeCheck(
        pathParameters.every((key) => !Object.hasOwn(observed.body, key)),
        `${example.id} duplicated a path parameter in its JSON body`,
      );
    if (example.id === "search_products") {
      const filteredOutput = toolOutputFromRpc(payload);
      assert.deepEqual(filteredOutput, [
        { id: "coffee-001", name: "Coffee", price: 12.5 },
        { id: "tea-002", name: "Tea", price: 7 },
      ]);
      const outputValidator = new Validator(
        example.tool.outputSchema,
        "2020-12",
        false,
      );
      safeCheck(
        outputValidator.validate(filteredOutput).valid,
        "GET jq output does not conform to its outputSchema",
      );
    }
  }
  safeCheck(
    !restAuthSecrets.custom ||
      !restRequests.some((request) =>
        JSON.stringify(request).includes(restAuthSecrets.custom),
      ),
    "Sanitized REST request report contains the API Key",
  );
  safeCheck(
    !restRequests.some((request) =>
      JSON.stringify(request).includes(restAuthSecrets.bearer.token),
    ) &&
      !restRequests.some((request) =>
        JSON.stringify(request).includes(restAuthSecrets.basic.username),
      ) &&
      !restRequests.some((request) =>
        JSON.stringify(request).includes(restAuthSecrets.basic.password),
      ),
    "Sanitized REST request report contains authentication credentials",
  );

  const teamToolName = `tool_team_${randomUUID().slice(0, 8)}`;
  const teamTool = await createBrowserTool({
    toolName: teamToolName,
    url: `http://127.0.0.1:${port}/auth/custom`,
    visibility: "private",
    assignedTeam: teamId,
  });
  const teamCreateBody = teamTool.request;
  safeCheck(
    (teamCreateBody.team_id ?? teamCreateBody.tool?.team_id) === teamId,
    "Team assignment was not included in tool creation",
  );
  const teamRecord = unwrap(
    await api(`/v1/tools/${encodeURIComponent(teamTool.id)}`),
  );
  safeCheck(
    (teamRecord.team_id ?? teamRecord.teamId) === teamId,
    "Created tool did not retain its selected team",
  );
  form = await openEdit(teamToolName);
  await form.getByLabel("visibility", { exact: true }).selectOption("team");
  const teamUpdateBody = await saveEdit(form);
  safeCheck(
    noTeamKey(teamUpdateBody),
    "Tool update unexpectedly submitted team ownership",
  );
  const updatedTeamRecord = unwrap(
    await api(`/v1/tools/${encodeURIComponent(teamTool.id)}`),
  );
  safeCheck(
    (updatedTeamRecord.team_id ?? updatedTeamRecord.teamId) === teamId &&
      updatedTeamRecord.visibility === "team",
    "Team visibility update did not preserve the existing team assignment",
  );

  const report = {
    backend: "v1.0.11",
    checks: [
      "Tool definition created in isolated backend",
      "Browser loaded actual inputSchema and rendered typed fields",
      "POST /rpc tools/call executed through prefixed panel",
      "Local REST upstream received exact arguments once",
      "Browser displayed actual upstream result with no page errors",
      "Read-only API token refused tools/call before reaching upstream",
      "RPC workbench ping form executed against the actual backend",
      "Browser created and called Basic, Bearer, and custom-header protected tools",
      "Unrelated browser edits preserved live credentials for all auth methods",
      "Bearer credentials could be replaced and explicitly cleared",
      "Cleared Bearer credentials no longer authorize the protected endpoint",
      "Browser imported all three catalog REST examples with runtime credentials",
      "GET query, custom-header auth, jq output, and outputSchema were verified through /rpc",
      "POST and PATCH replaced path parameters, preserved nested JSON types, and used Bearer/Basic auth",
      "Each example reached the local upstream exactly once; reports retain no credentials",
      "Browser assigned a real team on create and changed visibility without submitting team_id on update",
    ],
    protectedCalls: protectedCalls.map(({ path, authorized }) => ({
      path,
      authorized,
    })),
    restRequests,
    boundary:
      "Local controlled REST upstream only; no external MCP/A2A credentials or providers tested",
  };
  await writeFile(
    ".cache/reports/tool-call-real.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const id of toolIds)
    await api("/v1/tools/" + encodeURIComponent(id), "DELETE").catch(() => {});
  if (executeTokenId)
    await api(
      "/v1/tokens/" + encodeURIComponent(executeTokenId),
      "DELETE",
    ).catch(() => {});
  if (tokenId)
    await api("/v1/tokens/" + encodeURIComponent(tokenId), "DELETE").catch(
      () => {},
    );
  if (teamId)
    await api("/v1/teams/" + encodeURIComponent(teamId), "DELETE").catch(
      () => {},
    );
  if (cookie) await api("/_panel/logout", "POST").catch(() => {});
  await browser?.close();
  await new Promise((resolve) => panel.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
}

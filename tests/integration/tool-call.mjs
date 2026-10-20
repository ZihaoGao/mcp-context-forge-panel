import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { createPanelServer } from "../../apps/server/server.mjs";
import { readConfig } from "../../apps/server/config.mjs";

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(".cache/browsers");
const { chromium } = await import("@playwright/test");
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const invocations = [];
const upstream = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const data = JSON.parse(text || "{}");
  invocations.push(data);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      echoed: data.query,
      count: data.count,
      enabled: data.enabled,
    }),
  );
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
let browser, cookie, toolId, tokenId;
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
    throw new Error(`${url}: ${response.status}: ${JSON.stringify(data)}`);
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return data;
}
try {
  await api("/_panel/login", "POST", {
    email: credentials.email,
    password: credentials.password,
  });
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
  toolId = created.id;
  assert.ok(toolId);
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
  assert.ok(
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
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "工作台" }).waitFor();
  await page.goto(root + "/app/#tools");
  await page.getByLabel("Filter resources").fill(name);
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
  assert.equal(response.status(), 200);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.notEqual(result.result?.isError, true, JSON.stringify(result));
  assert.deepEqual(invocations, [
    { query: "actual local call", count: 3, enabled: false },
  ]);
  await dialog
    .locator(".result")
    .getByText(/actual local call/)
    .waitFor();
  assert.ok(
    (await dialog.locator(".result").innerText()).includes("actual local call"),
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
  assert.equal(ping.error, undefined);
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
    ],
    boundary:
      "Local controlled REST upstream only; no external MCP/A2A credentials or providers tested",
  };
  await writeFile(
    ".cache/reports/tool-call-real.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (tokenId)
    await api("/v1/tokens/" + encodeURIComponent(tokenId), "DELETE").catch(
      () => {},
    );
  if (toolId)
    await api("/v1/tools/" + encodeURIComponent(toolId), "DELETE").catch(
      () => {},
    );
  if (cookie) await api("/_panel/logout", "POST").catch(() => {});
  await browser?.close();
  await new Promise((resolve) => panel.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
}

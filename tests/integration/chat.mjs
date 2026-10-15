import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createPanelServer } from "../../apps/server/server.mjs";
import { readConfig } from "../../apps/server/config.mjs";
import { createFixtureServices } from "../fixtures/services.mjs";

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve(".cache/browsers");
const { chromium } = await import("@playwright/test");
const fixture = await createFixtureServices();
const origin = "http://127.0.0.1:3001";
const root = origin + "/chatlab";
const panel = createPanelServer(
  readConfig({
    BACKEND_URL: "http://127.0.0.1:4445",
    APP_ROOT_PATH: "/chatlab",
    PUBLIC_ORIGIN: origin,
  }),
);
panel.listen(3001, "127.0.0.1");
await once(panel, "listening");
const browser = await chromium.launch();
let providerId, modelId, cookie;
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
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
  const provider = await api("/v1/llm/providers", "POST", {
    name: "Panel integration fixture " + Date.now(),
    provider_type: "openai",
    api_base: fixture.url + "/v1",
    api_key: "fixture-key",
    default_model: "panel-fixture",
  });
  providerId = provider.id;
  const model = await api("/v1/llm/models", "POST", {
    provider_id: providerId,
    model_id: "panel-fixture",
    model_name: "Panel fixture",
    supports_chat: true,
    supports_streaming: true,
  });
  modelId = model.id;
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("link", { name: "对话调试", exact: true })
    .click();
  await page.getByLabel("Chat model").fill(modelId);
  await page
    .locator(".chat-config input")
    .nth(1)
    .fill(fixture.url + "/mcp");
  await page.getByRole("button", { name: "建立连接", exact: true }).click();
  await page
    .getByRole("button", { name: "断开连接", exact: true })
    .waitFor({ timeout: 45000 });
  await page.getByLabel("Message").fill("Say hello");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .locator(".chat-message.assistant")
    .getByText("Hello from the integration fixture.", { exact: true })
    .waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await page.getByRole("button", { name: "建立连接", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await mkdir(".cache/reports", { recursive: true });
  await page.screenshot({ path: ".cache/reports/chat.png", fullPage: true });
  await writeFile(
    ".cache/reports/chat.json",
    JSON.stringify(
      {
        backend: "v1.0.10",
        commit: "4a4f5d428b42f2cbf0b831e1acce5953202c4311",
        checks: [
          "Real old backend model/provider setup",
          "Browser chat session connect with MCP HTTP fixture",
          "Streaming reply rendered without duplicated final text",
          "Session disconnect",
        ],
        externalServices:
          "Local OpenAI-compatible and MCP HTTP fixtures; no paid provider calls",
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS v1.0.10 browser Chat connect → streamed reply → disconnect",
  );
} finally {
  if (modelId) await api("/v1/llm/models/" + modelId, "DELETE").catch(() => {});
  if (providerId)
    await api("/v1/llm/providers/" + providerId, "DELETE").catch(() => {});
  await api("/_panel/logout", "POST").catch(() => {});
  await browser.close();
  panel.closeAllConnections();
  fixture.server.closeAllConnections();
  await Promise.all([
    new Promise((r) => panel.close(r)),
    new Promise((r) => fixture.server.close(r)),
  ]);
}

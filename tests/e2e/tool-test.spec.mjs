import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", minLength: 2, description: "Search text" },
    count: { type: "integer", minimum: 1, default: 2 },
    mode: { type: "integer", enum: [1, 2] },
    enabled: { type: "boolean" },
    permissions: { type: "string" },
    filter: { $ref: "#/$defs/filter" },
    values: { type: "array", items: { type: "number" } },
  },
  required: ["query", "count", "mode", "enabled", "filter"],
  $defs: {
    filter: {
      type: "object",
      properties: { region: { type: "string", enum: ["eu", "us"] } },
      required: ["region"],
    },
  },
};
const tool = {
  id: "tool-test-id",
  name: "published-test-name",
  originalName: "upstream-original-name",
  displayName: "Test schema tool",
  enabled: true,
  integrationType: "MCP",
  inputSchema: schema,
};
async function login(page) {
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}
async function fixture(
  page,
  { permissions, detailFailure = false, detail = tool } = {},
) {
  const calls = [];
  if (permissions)
    await page.route("**/v1/rbac/my/permissions**", (route) =>
      route.fulfill({ json: permissions }),
    );
  await page.route("**/v1/tools**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tool-test-id"))
      return route.fulfill(
        detailFailure
          ? { status: 503, json: { detail: "schema read unavailable" } }
          : { json: detail },
      );
    return route.fulfill({ json: { tools: [tool], total: 1 } });
  });
  await page.route(/\/rpc\/?$/, async (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: calls.at(-1).id,
        result: {
          content: [{ type: "text", text: "fixture invocation result" }],
        },
      },
    });
  });
  await login(page);
  await page.goto(root + "/app/#tools");
  return calls;
}

for (const width of [1440, 390]) {
  test(`incompatible root array schema blocks tool calls before input at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const calls = await fixture(page, {
      detail: {
        ...tool,
        inputSchema: { type: "array", items: { type: "string" } },
      },
    });
    await page.getByRole("button", { name: "测试调用", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText("顶层参数为对象");
    await expect(
      dialog.getByRole("button", { name: "调用工具", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "添加一项", exact: true }),
    ).toHaveCount(0);
    await dialog.getByText("查看输入 Schema", { exact: true }).click();
    await expect(dialog.locator("details pre")).toContainText(
      '"type": "array"',
    );
    expect(calls).toHaveLength(0);
    const footer = await dialog.locator(".dialog-footer").boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await mkdir(".cache/reports", { recursive: true });
    await page.screenshot({
      path: `.cache/reports/tool-array-root-${width}.png`,
    });
  });
}

test("object array inputs with nested arrays still submit exact types", async ({
  page,
}) => {
  const calls = await fixture(page, {
    detail: {
      ...tool,
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                quantity: { type: "integer", minimum: 1 },
                tags: { type: "array", items: { type: "string" } },
              },
              required: ["quantity", "tags"],
            },
          },
        },
        required: ["items"],
      },
    },
  });
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "添加一项", exact: true }).click();
  await dialog
    .getByLabel("arguments.items[1].quantity", { exact: true })
    .fill("2");
  await dialog
    .getByRole("group", { name: "tags * arguments.items[1].tags", exact: true })
    .getByRole("button", { name: "添加一项", exact: true })
    .click();
  await dialog
    .getByLabel("arguments.items[1].tags[1]", { exact: true })
    .fill("coffee");
  await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
  await expect(dialog.locator(".result")).toContainText(
    "fixture invocation result",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].params.arguments).toEqual({
    items: [{ quantity: 2, tags: ["coffee"] }],
  });
});

for (const width of [1440, 390]) {
  test(`tool test renders schema controls, submits typed arguments and fits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const calls = await fixture(page);
    await page.getByRole("button", { name: "测试调用", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("arguments.count", { exact: true }),
    ).toHaveValue("2");
    await dialog
      .getByRole("button", { name: "编辑 JSON", exact: true })
      .click();
    await dialog
      .getByLabel("arguments JSON", { exact: true })
      .fill('{"broken":');
    await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
    expect(calls).toHaveLength(0);
    await expect(dialog.getByRole("alert")).toContainText("Invalid JSON");
    await dialog
      .getByLabel("arguments JSON", { exact: true })
      .fill('{"count":2,"filter":{}}');
    await dialog
      .getByRole("button", { name: "使用参数表单", exact: true })
      .click();
    await dialog.getByLabel("arguments.query", { exact: true }).fill("hello");
    await dialog
      .getByLabel("arguments.mode", { exact: true })
      .selectOption("2");
    await dialog
      .getByLabel("arguments.enabled", { exact: true })
      .selectOption("false");
    await dialog
      .getByLabel("arguments.permissions", { exact: true })
      .fill("free-form-tool-data");
    await dialog
      .getByLabel("arguments.filter.region", { exact: true })
      .selectOption('"eu"');
    await dialog.getByRole("button", { name: "添加一项", exact: true }).click();
    await dialog.getByLabel("arguments.values[1]", { exact: true }).fill("3.5");
    await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
    await expect(dialog.locator(".result")).toContainText(
      "fixture invocation result",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      jsonrpc: "2.0",
      id: expect.any(String),
      method: "tools/call",
      params: {
        name: tool.name,
        arguments: {
          query: "hello",
          count: 2,
          mode: 2,
          enabled: false,
          permissions: "free-form-tool-data",
          filter: { region: "eu" },
          values: [3.5],
        },
      },
    });
    const box = await dialog.locator(".dialog-footer").boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await mkdir(".cache/reports", { recursive: true });
    await page.screenshot({ path: `.cache/reports/tool-call-${width}.png` });
    expect(errors).toEqual([]);
  });
}

test("tool test validates JSON against schema and shows HTTP, RPC and tool errors without losing inputs", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("arguments.query", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "编辑 JSON", exact: true }).click();
  const editor = dialog.getByLabel("arguments JSON", { exact: true });
  await editor.fill('{"query":"ok","count":0}');
  await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("required");
  expect(calls).toHaveLength(0);
  const valid = JSON.stringify({
    query: "ok",
    count: 1,
    mode: 1,
    enabled: true,
    filter: { region: "us" },
  });
  await editor.fill(valid);
  for (const response of [
    {
      json: {
        jsonrpc: "2.0",
        error: { code: -32602, message: "fixture invalid RPC params" },
        id: 1,
      },
    },
    {
      json: {
        jsonrpc: "2.0",
        result: {
          isError: true,
          content: [{ type: "text", text: "fixture upstream failure" }],
        },
        id: 1,
      },
    },
    { status: 403, json: { detail: "fixture permission denied" } },
  ]) {
    await page.route(/\/rpc\/?$/, (route) => route.fulfill(response));
    await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      response.status
        ? "fixture permission denied"
        : response.json.error
          ? "fixture invalid RPC params"
          : "执行返回错误",
    );
    await expect(editor).toHaveValue(valid);
  }
});

test("tool test stops waiting, preserves arguments and avoids automatic retries", async ({
  page,
}) => {
  const calls = await fixture(page, {
    detail: { ...tool, inputSchema: { type: "object", properties: {} } },
  });
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(/\/rpc\/?$/, async (route) => {
    calls.push(route.request().postDataJSON());
    await pending;
    await route.fulfill({ json: { result: {} } }).catch(() => {});
  });
  try {
    await page.getByRole("button", { name: "测试调用", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("arguments", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "停止等待", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "停止等待", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("可能已在上游执行");
    expect(calls).toHaveLength(1);
  } finally {
    release();
  }
});

test("tool test is hidden without execute permission, and schema read failures block execution", async ({
  page,
}) => {
  await fixture(page, { permissions: ["tools.read"] });
  await expect(page.getByText(tool.name, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "测试调用", exact: true }),
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/v1/rbac/my/permissions**", (route) =>
    route.fulfill({ json: ["tools.read", "tools.execute"] }),
  );
  await page.reload();
  await page.route("**/v1/tools**", (route) =>
    route.fulfill(
      new URL(route.request().url()).pathname.endsWith("/tool-test-id")
        ? { status: 503, json: { detail: "schema read unavailable" } }
        : { json: { tools: [tool], total: 1 } },
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "schema read unavailable",
  );
  await expect(
    dialog.getByRole("button", { name: "调用工具", exact: true }),
  ).toBeDisabled();
});

test("RPC workbench exposes envelope fields, rejects malformed JSON drafts and shows RPC errors", async ({
  page,
}) => {
  await login(page);
  await page.goto(root + "/app/#api");
  await page.getByLabel("Search API", { exact: true }).fill("/rpc");
  await page
    .locator(".api-row")
    .filter({ has: page.getByText("/rpc", { exact: true }) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("jsonrpc", { exact: true })).toHaveValue(
    "2.0",
  );
  await expect(dialog.getByLabel("id", { exact: true })).toHaveValue("1");
  await dialog.getByLabel("method", { exact: true }).fill("tools/call");
  const calls = [];
  await page.route(/\/rpc\/?$/, (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: "1",
        error: { code: -32601, message: "fixture RPC tool missing" },
      },
    });
  });
  await dialog.getByLabel("params", { exact: true }).fill('{"name":');
  await dialog.getByRole("button", { name: "执行", exact: true }).click();
  expect(calls).toHaveLength(0);
  await dialog
    .getByLabel("params", { exact: true })
    .fill('{"name":"test-tool","arguments":{}}');
  await dialog.getByRole("button", { name: "执行", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "fixture RPC tool missing",
  );
  expect(calls).toEqual([
    {
      jsonrpc: "2.0",
      id: "1",
      method: "tools/call",
      params: { name: "test-tool", arguments: {} },
    },
  ]);
  await expect(dialog.locator(".result")).toContainText("-32601");
});

test("related raw Request endpoint has a log-level form instead of declaring no parameters", async ({
  page,
}) => {
  await login(page);
  await page.goto(root + "/app/#api");
  await page
    .getByLabel("Search API", { exact: true })
    .fill("/logging/setLevel");
  await page
    .locator(".api-row")
    .filter({ has: page.getByText("/logging/setLevel", { exact: true }) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("level", { exact: true })).toBeVisible();
  await dialog.getByLabel("level", { exact: true }).selectOption("warning");
  const calls = [];
  await page.route("**/logging/setLevel", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
  await dialog.getByRole("button", { name: "执行", exact: true }).click();
  await expect(dialog.locator(".result")).toContainText("true");
  expect(calls).toEqual([{ level: "warning" }]);
});

test("tool detail opens the same schema test dialog", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: tool.name, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "测试调用", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(
    dialog.getByLabel("arguments.query", { exact: true }),
  ).toBeVisible();
});

test("disabled tools cannot execute and a missing runtime RPC endpoint hides the test action", async ({
  page,
}) => {
  await fixture(page, { detail: { ...tool, enabled: false } });
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("工具已停用");
  await expect(
    dialog.getByRole("button", { name: "调用工具", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const runtime = JSON.parse(
    await readFile("contracts/contextforge/openapi.json", "utf8"),
  );
  delete runtime.paths["/rpc"];
  delete runtime.paths["/rpc/"];
  await page.route("**/openapi.json", (route) =>
    route.fulfill({ json: runtime }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: tool.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "测试调用", exact: true }),
  ).toHaveCount(0);
});

test("tool calls still submit when crypto.randomUUID is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
  });
  const calls = await fixture(page, {
    detail: { ...tool, inputSchema: { type: "object", properties: {} } },
  });
  expect(await page.evaluate(() => typeof window.crypto.randomUUID)).toBe(
    "undefined",
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "测试调用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("arguments", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
  await expect(dialog.locator(".result")).toContainText(
    "fixture invocation result",
  );
  await dialog.getByRole("button", { name: "调用工具", exact: true }).click();
  await expect.poll(() => calls.length).toBe(2);
  await expect(dialog.locator(".result")).toContainText(
    "fixture invocation result",
  );
  expect(calls[0].id).toEqual(expect.any(String));
  expect(calls[0].id.length).toBeGreaterThan(0);
  expect(calls[1].id).not.toBe(calls[0].id);
  expect(calls.map((call) => call.params)).toEqual([
    { name: tool.name, arguments: {} },
    { name: tool.name, arguments: {} },
  ]);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

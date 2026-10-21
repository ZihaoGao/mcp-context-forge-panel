import { test, expect, request } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { restToolExamples } from "../../apps/web/src/tool-workflows.mjs";

const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const gatewayId = "fixture-mcp-gateway";

async function login(page) {
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}

function pathOf(route) {
  return new URL(route.request().url()).pathname;
}

function gatewayRecord(overrides = {}) {
  return {
    id: gatewayId,
    name: "Fixture MCP service",
    url: "https://upstream.example.test/mcp",
    transport: "STREAMABLEHTTP",
    status: "active",
    enabled: true,
    reachable: true,
    lastError: "Fixture discovery warning",
    ...overrides,
  };
}

async function stubGatewayApi(
  page,
  { createStatus = 201, createRecord, detailRecords = [] } = {},
) {
  const creates = [];
  const refreshes = [];
  const created = createRecord || gatewayRecord();
  let detailRead = 0;
  await page.route("**/v1/gateways**", async (route) => {
    const request = route.request();
    const path = pathOf(route);
    if (/\/v1\/gateways\/?$/.test(path) && request.method() === "POST") {
      creates.push(request.postDataJSON());
      if (createStatus >= 400)
        return route.fulfill({
          status: createStatus,
          json: { detail: "fixture upstream unavailable" },
        });
      return route.fulfill({ status: createStatus, json: created });
    }
    if (/\/v1\/gateways\/[^/]+\/tools\/refresh$/.test(path)) {
      refreshes.push(path);
      return route.fulfill({
        json: {
          gatewayId,
          success: true,
          toolsAdded: 1,
          toolsUpdated: 0,
          toolsRemoved: 0,
          validationErrors: [],
        },
      });
    }
    if (/\/v1\/gateways\/?$/.test(path) && request.method() === "GET")
      return route.fulfill({
        json: { gateways: [created], total: 1, nextCursor: null },
      });
    if (/\/v1\/gateways\/[^/]+$/.test(path) && request.method() === "GET") {
      const detail = detailRecords.length
        ? detailRecords[Math.min(detailRead++, detailRecords.length - 1)]
        : created;
      return route.fulfill({ json: detail });
    }
    return route.continue();
  });
  return { creates, refreshes };
}

function toolRecord(id, name, integrationType, sourceGateway = null) {
  return {
    id,
    name,
    originalName: name,
    displayName: name,
    url:
      integrationType === "REST"
        ? "https://api.example.test/orders/lookup"
        : "https://upstream.example.test/mcp",
    description: `${name} fixture`,
    integrationType,
    integration_type: integrationType,
    requestType: integrationType === "MCP" ? "STREAMABLEHTTP" : "POST",
    request_type: integrationType === "MCP" ? "STREAMABLEHTTP" : "POST",
    inputSchema: { type: "object", properties: {} },
    input_schema: { type: "object", properties: {} },
    enabled: true,
    is_active: true,
    visibility: "private",
    gatewayId: sourceGateway,
    gateway_id: sourceGateway,
  };
}

async function stubToolApi(
  page,
  { rows = [], discoveryPages = false, failCursor = "" } = {},
) {
  const writes = [];
  const reads = [];
  await page.route("**/v1/tools**", async (route) => {
    const request = route.request();
    const path = pathOf(route);
    if (/\/v1\/tools\/?$/.test(path) && request.method() === "POST") {
      writes.push(request.postDataJSON());
      return route.fulfill({
        status: 422,
        json: { detail: "Unexpected tool write in this fixture" },
      });
    }
    if (/\/v1\/tools\/?$/.test(path) && request.method() === "GET") {
      const query = new URL(request.url()).searchParams;
      const cursor = query.get("cursor") || "";
      const limit = Number(query.get("limit") || 25);
      reads.push({
        cursor,
        limit,
        gatewayId: query.get("gateway_id") || query.get("gatewayId") || "",
      });
      if (discoveryPages && limit > 25) {
        if (failCursor && cursor === failCursor)
          return route.fulfill({
            status: 503,
            json: { detail: "fixture second page unavailable" },
          });
        if (cursor === "tools-page-two")
          return route.fulfill({
            json: {
              tools: [
                toolRecord(
                  "discovered-tool-id",
                  "fixture-discovered-tool",
                  "MCP",
                  gatewayId,
                ),
              ],
              total: 101,
              nextCursor: null,
            },
          });
        return route.fulfill({
          json: {
            tools: Array.from({ length: 100 }, (_, index) =>
              toolRecord(
                `other-tool-${index}`,
                `other-tool-${index}`,
                "MCP",
                "another-gateway",
              ),
            ),
            total: 101,
            nextCursor: "tools-page-two",
          },
        });
      }

      return route.fulfill({
        json: { tools: rows, total: rows.length, nextCursor: null },
      });
    }
    if (/\/v1\/tools\/[^/]+$/.test(path) && request.method() === "GET") {
      const id = path.split("/").at(-1);
      const row = rows.find((item) => item.id === id);
      if (row) return route.fulfill({ json: row });
      return route.fulfill({
        status: 404,
        json: { detail: "fixture not found" },
      });
    }
    return route.continue();
  });
  return { writes, reads };
}

async function createAdminApiContext() {
  const context = await request.newContext({
    extraHTTPHeaders: {
      Origin: new URL(root).origin,
      "X-Panel-Request": "1",
    },
  });
  const loginResponse = await context.post(root + "/_panel/login", {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(loginResponse.status()).toBe(200);
  return context;
}

for (const width of [1440, 390]) {
  test(`tools connect to MCP and filter discovered tools across pages at ${width}px`, async ({
    page,
  }) => {
    await mkdir(".cache/reports", { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    const tools = await stubToolApi(page, { discoveryPages: true });
    const gateways = await stubGatewayApi(page);
    await login(page);
    await page.goto(root + "/app/#tools");
    await page
      .getByRole("button", { name: /接入 MCP 服务|Connect MCP service/ })
      .click();
    await expect(page).toHaveURL(/#gateways/);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("name", { exact: true })).toBeVisible();
    await dialog
      .getByLabel("name", { exact: true })
      .fill("Fixture MCP service");
    await dialog
      .getByLabel("url", { exact: true })
      .fill("https://upstream.example.test/mcp");
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          /\/v1\/gateways\/?$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: /创建/ }).click(),
    ]);
    expect(created.status()).toBe(201);
    expect(gateways.creates).toHaveLength(1);
    await expect(dialog).toContainText("MCP 服务接入结果");
    await expect(dialog).toContainText("已发现 1 个工具");
    await expect(dialog).toContainText("Fixture discovery warning");
    await page.screenshot({
      path: `.cache/reports/mcp-connection-${width}.png`,
    });
    expect(gateways.refreshes).toEqual([]);
    expect(tools.reads.some((read) => read.cursor === "tools-page-two")).toBe(
      true,
    );
    expect(tools.reads.some((read) => read.gatewayId === gatewayId)).toBe(true);
    const beforeGatewayFilter = tools.reads.length;

    await dialog
      .getByRole("button", { name: /查看发现的工具|View discovered tools/ })
      .click();
    await expect(page).toHaveURL(/#tools\?gateway=fixture-mcp-gateway/);
    await expect(
      page.getByText("fixture-mcp-gateway", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("fixture-discovered-tool", { exact: true }),
    ).toBeVisible();
    expect(
      tools.reads
        .slice(beforeGatewayFilter)
        .some((read) => read.gatewayId === gatewayId),
    ).toBe(true);
    expect(
      tools.reads.filter((read) => read.cursor === "tools-page-two").length,
    ).toBeGreaterThanOrEqual(2);
  });
}

test("pending MCP registration waits for an explicit refresh before discovery", async ({
  page,
}) => {
  const pending = gatewayRecord({ status: "pending", reachable: false });
  const active = gatewayRecord({ status: "active", reachable: true });
  const tools = await stubToolApi(page, { discoveryPages: true });
  const gateways = await stubGatewayApi(page, {
    createStatus: 202,
    createRecord: pending,
    detailRecords: [active],
  });
  await login(page);
  await page.goto(root + "/app/#tools");
  await page
    .getByRole("button", { name: /接入 MCP 服务|Connect MCP service/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("name", { exact: true }).fill(pending.name);
  await dialog
    .getByLabel("url", { exact: true })
    .fill("https://upstream.example.test/mcp");
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/v1\/gateways\/?$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: /创建/ }).click(),
  ]);
  expect(created.status()).toBe(202);
  await expect(dialog).toContainText("等待连接与工具发现");
  await expect(dialog).not.toContainText("已连接上游 MCP 服务");
  await expect(dialog).not.toContainText(/已发现 \d+ 个工具/);
  expect(tools.reads.some((read) => read.gatewayId === gatewayId)).toBe(false);

  const [detailResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/v1\/gateways\/fixture-mcp-gateway$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "GET",
    ),
    dialog.getByRole("button", { name: /刷新发现结果/ }).click(),
  ]);
  expect(detailResponse.status()).toBe(200);
  await expect(dialog).toContainText("已连接上游 MCP 服务");
  await expect(dialog).toContainText("已发现 1 个工具");
  expect(gateways.refreshes).toEqual([]);
  expect(tools.reads.some((read) => read.cursor === "tools-page-two")).toBe(
    true,
  );
  expect(tools.reads.some((read) => read.gatewayId === gatewayId)).toBe(true);
});

test("a failed discovery tools page is reported instead of a zero count", async ({
  page,
}) => {
  const tools = await stubToolApi(page, {
    discoveryPages: true,
    failCursor: "tools-page-two",
  });
  await stubGatewayApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  await page
    .getByRole("button", { name: /接入 MCP 服务|Connect MCP service/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("name", { exact: true }).fill("Page failure fixture");
  await dialog
    .getByLabel("url", { exact: true })
    .fill("https://upstream.example.test/mcp");
  await dialog.getByRole("button", { name: /创建/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("读取发现结果失败");
  await expect(dialog.getByRole("alert")).toContainText(
    "fixture second page unavailable",
  );
  await expect(dialog).not.toContainText(/已发现 \d+ 个工具/);
  expect(tools.reads.some((read) => read.cursor === "tools-page-two")).toBe(
    true,
  );
  expect(tools.reads.some((read) => read.gatewayId === gatewayId)).toBe(true);
});

test("failed MCP connection keeps the gateway form and entered values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubToolApi(page);
  await stubGatewayApi(page, { createStatus: 503 });
  await login(page);
  await page.goto(root + "/app/#tools");
  await page
    .getByRole("button", { name: /接入 MCP 服务|Connect MCP service/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("name", { exact: true }).fill("Failed fixture");
  await dialog
    .getByLabel("url", { exact: true })
    .fill("https://broken.example.test/mcp");
  await dialog.getByRole("button", { name: /创建/ }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "fixture upstream unavailable",
  );
  await expect(dialog.getByLabel("name", { exact: true })).toHaveValue(
    "Failed fixture",
  );
  await expect(dialog.getByLabel("url", { exact: true })).toHaveValue(
    "https://broken.example.test/mcp",
  );
});

test("MCP shortcut is hidden when gateway creation permission is missing", async ({
  page,
}) => {
  await page.route("**/v1/rbac/my/permissions**", (route) =>
    route.fulfill({ json: ["tools.read", "tools.create", "gateways.read"] }),
  );
  await stubToolApi(page);
  await stubGatewayApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  await expect(
    page.getByRole("button", { name: /接入 MCP 服务|Connect MCP service/ }),
  ).toHaveCount(0);
});

test("MCP shortcut can create with gateways.create and tools.read only", async ({
  page,
}) => {
  await page.route("**/v1/rbac/my/permissions**", (route) =>
    route.fulfill({ json: ["tools.read", "gateways.create"] }),
  );
  await stubToolApi(page);
  const gateways = await stubGatewayApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  const shortcut = page.getByRole("button", {
    name: /接入 MCP 服务|Connect MCP service/,
  });
  await expect(shortcut).toBeVisible();
  await shortcut.click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("name", { exact: true })
    .fill("Create permission fixture");
  await dialog
    .getByLabel("url", { exact: true })
    .fill("https://upstream.example.test/mcp");
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/v1\/gateways\/?$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: /创建/ }).click(),
  ]);
  expect(created.status()).toBe(201);
  expect(gateways.creates).toHaveLength(1);
  await expect(
    dialog.getByRole("button", { name: /刷新发现结果/ }),
  ).toHaveCount(0);
});

test("tool transfer separates REST definitions from snapshots and blocks MCP/A2A imports", async ({
  page,
}) => {
  const rows = [
    toolRecord("rest-fixture", "local-rest-tool", "REST"),
    toolRecord("mcp-fixture", "gateway-mcp-tool", "MCP", "origin-gateway"),
    toolRecord("a2a-fixture", "agent-a2a-tool", "A2A"),
  ];
  rows[0].url =
    "https://fixture-url-user:fixture-url-password@api.example.test/orders/lookup";
  rows[0].auth = {
    username: "fixture-auth-user",
    password: "fixture-auth-password",
    token: "fixture-auth-token",
  };
  const tools = await stubToolApi(page, { rows });
  await stubGatewayApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  await expect(
    page.getByRole("button", {
      name: /REST 工具导入 \/ 导出|REST tool import \/ export/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /REST 工具导入 \/ 导出|REST tool import \/ export/,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(/REST.*导入.*导出|REST.*import.*export/i);

  const [templateDownload] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", {
        name: /下载 REST 示例模板|Download REST example template/,
      })
      .click(),
  ]);
  const templateBuffer = await readFile(await templateDownload.path());
  const template = JSON.parse(templateBuffer.toString("utf8"));
  expect(template.records.map((item) => item.name)).toEqual([
    "search_products",
    "create_order",
    "update_order_status",
  ]);
  expect(template.records).toHaveLength(3);
  expect(template.examples.map((item) => item.id)).toEqual(
    restToolExamples.map((item) => item.id),
  );
  for (const example of template.examples) {
    expect(Object.hasOwn(example, "tool")).toBe(false);
    expect(example.arguments).toEqual(
      restToolExamples.find((item) => item.id === example.id).arguments,
    );
  }

  const templateTools = Object.fromEntries(
    template.records.map((tool) => [tool.name, tool]),
  );
  const authType = (tool) => tool.auth?.authType ?? tool.auth_type;
  expect(templateTools.search_products.request_type).toBe("GET");
  expect(templateTools.search_products.url).toContain("/products");
  for (const query of ["keyword", "page", "page_size", "sort"])
    expect(templateTools.search_products.inputSchema.properties).toHaveProperty(
      query,
    );
  expect(authType(templateTools.search_products)).toBe("authheaders");
  expect(templateTools.create_order.request_type).toBe("POST");
  expect(templateTools.create_order.url).toContain(
    "/customers/{customer_id}/orders",
  );
  expect(authType(templateTools.create_order)).toBe("bearer");
  expect(templateTools.update_order_status.request_type).toBe("PATCH");
  expect(templateTools.update_order_status.url).toContain("/orders/{order_id}");
  expect(authType(templateTools.update_order_status)).toBe("basic");

  await dialog.locator("input[type=file]").setInputFiles({
    name: "rest-examples.json",
    mimeType: "application/json",
    buffer: templateBuffer,
  });
  await expect(dialog.locator("tbody tr")).toHaveCount(3);
  expect(tools.writes).toEqual([]);

  const [definitionDownload] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", { name: /^导出 REST 定义：已选 \/ 当前页/ })
      .click(),
  ]);
  const definitions = JSON.parse(
    await readFile(await definitionDownload.path(), "utf8"),
  );
  expect(definitions.kind).toBe("create");
  expect(definitions.records.map((item) => item.name)).toEqual([
    "local-rest-tool",
  ]);
  const definitionText = JSON.stringify(definitions);
  for (const secret of [
    "fixture-url-user",
    "fixture-url-password",
    "fixture-auth-user",
    "fixture-auth-password",
    "fixture-auth-token",
  ])
    expect(definitionText).not.toContain(secret);
  for (const record of definitions.records) {
    expect(Object.hasOwn(record, "auth")).toBe(false);
    expect(Object.hasOwn(record, "auth_headers")).toBe(false);
    expect(Object.hasOwn(record, "auth_token")).toBe(false);
    expect(Object.hasOwn(record, "auth_username")).toBe(false);
    expect(Object.hasOwn(record, "auth_password")).toBe(false);
  }
  await expect(dialog).toContainText(/跳过.*2|2.*跳过/);

  const [snapshotDownload] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", {
        name: /^导出工具清单快照：已选 \/ 当前页/,
      })
      .click(),
  ]);
  const snapshot = JSON.parse(
    await readFile(await snapshotDownload.path(), "utf8"),
  );
  expect(snapshot.kind).toBe("snapshot");
  expect(snapshot.records.map((item) => item.integration_type).sort()).toEqual([
    "A2A",
    "MCP",
    "REST",
  ]);
  const snapshotText = JSON.stringify(snapshot);
  for (const secret of [
    "fixture-url-user",
    "fixture-url-password",
    "fixture-auth-user",
    "fixture-auth-password",
    "fixture-auth-token",
  ])
    expect(snapshotText).not.toContain(secret);
  await dialog.locator("input[type=file]").setInputFiles({
    name: "tool-inventory-snapshot.json",
    mimeType: "application/json",
    buffer: await readFile(await snapshotDownload.path()),
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "只读快照不能作为创建配置导入",
  );
  expect(tools.writes).toEqual([]);

  const invalid = [
    {
      name: "invalid-mcp",
      integration_type: "MCP",
      request_type: "STREAMABLEHTTP",
      url: "https://upstream.example.test/mcp",
      gateway_id: "origin-gateway",
    },
    {
      name: "invalid-a2a",
      integration_type: "A2A",
      request_type: "POST",
      url: "https://agent.example.test/a2a",
    },
    {
      name: "invalid-linked-rest",
      integration_type: "REST",
      request_type: "POST",
      url: "https://api.example.test/linked",
      gateway_id: "origin-gateway",
    },
  ];
  await dialog.locator("input[type=file]").setInputFiles({
    name: "invalid-tool-rows.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "contextforge-panel",
        version: 1,
        resource: "tools",
        kind: "create",
        records: invalid,
      }),
    ),
  });
  await expect(dialog.locator("tbody tr")).toHaveCount(3);
  await expect(dialog).toContainText(/MCP|A2A|网关/);
  const confirm = dialog.getByRole("button", { name: /确认.*导入|Import/ });
  await expect(confirm).toBeDisabled();
  expect(tools.writes).toEqual([]);
});

test("REST import preview blocks array root schemas and accepts array properties after correction", async ({
  page,
}) => {
  const tools = await stubToolApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  await page
    .getByRole("button", { name: "REST 工具导入 / 导出", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const row = structuredClone(restToolExamples[1].tool);
  row.inputSchema = { type: "array", items: { type: "object" } };
  async function preview() {
    await dialog.locator("input[type=file]").setInputFiles({
      name: "array-schema.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "contextforge-panel",
          version: 1,
          resource: "tools",
          kind: "create",
          records: [row],
        }),
      ),
    });
  }
  await preview();
  await expect(dialog.locator("tbody tr")).toContainText("顶层参数为对象");
  const confirm = dialog.getByRole("button", { name: /确认.*导入|Import/ });
  await dialog.locator(".check-label input").check();
  await expect(confirm).toBeDisabled();
  expect(tools.writes).toHaveLength(0);
  row.inputSchema = restToolExamples[1].tool.inputSchema;
  await preview();
  await expect(dialog).not.toContainText("顶层参数为对象");
  await dialog.locator(".check-label input").check();
  await expect(confirm).toBeEnabled();
  expect(tools.writes).toHaveLength(0);
});

test("REST examples stay readable in English at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubToolApi(page);
  await login(page);
  await page.goto(root + "/app/#tools");
  await page.getByLabel("Change language").click();
  await page
    .getByRole("button", { name: /REST tool import \/ export/ })
    .click();

  const dialog = page.getByRole("dialog");
  const instructions = dialog.locator("details").first();
  await expect(instructions.locator("summary").first()).toHaveText(
    "How to fill in the REST template",
  );
  await instructions.locator("summary").first().click();
  const examples = instructions.locator("details");
  await expect(examples).toHaveCount(3);

  for (const example of restToolExamples) {
    const details = examples.filter({ hasText: example.title.en });
    await expect(details).toHaveCount(1);
    await details.locator("summary").click();
    await expect(details).toContainText(example.purpose.en);
    await expect(details).toContainText(example.replace.en);
    await expect(details).toContainText(example.tool.name);
    for (const key of Object.keys(example.arguments))
      await expect(details).toContainText(key);
  }

  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: innerWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
});

for (const width of [1440, 390]) {
  test(`REST transfer dialog fits and keeps its footer visible at ${width}px`, async ({
    page,
  }) => {
    await mkdir(".cache/reports", { recursive: true });
    await page.setViewportSize({ width, height: 844 });
    await stubToolApi(page);
    await login(page);
    await page.goto(root + "/app/#tools");
    await page
      .getByRole("button", {
        name: /REST 工具导入 \/ 导出|REST tool import \/ export/,
      })
      .click();
    const dialog = page.getByRole("dialog");
    const name = `layout-tool-${width}-${randomUUID().slice(0, 8)}`;
    await dialog.locator("input[type=file]").setInputFiles({
      name: "valid-rest-tool.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "contextforge-panel",
          version: 1,
          resource: "tools",
          kind: "create",
          records: [
            {
              name,
              description: "Layout fixture",
              integration_type: "REST",
              request_type: "POST",
              url: "https://api.example.test/orders/lookup",
              inputSchema: { type: "object", properties: {} },
              visibility: "private",
            },
          ],
        }),
      ),
    });
    await expect(dialog.locator("tbody tr")).toHaveCount(1);
    await expect(dialog.locator(".dialog-footer")).toBeVisible();
    await dialog.locator(".dialog-body").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    const footerBox = await dialog.locator(".dialog-footer").boundingBox();
    expect(footerBox).not.toBeNull();
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(footerBox.y).toBeGreaterThanOrEqual(0);
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: `.cache/reports/tool-workflows-${width}.png`,
    });
  });
}

test("REST definitions import, confirm, export, rename and re-import through the real API", async ({
  page,
}) => {
  const api = await createAdminApiContext();
  const createdIds = [];
  const originalName = `e2e-rest-${randomUUID().slice(0, 8)}`;
  const renamedName = `${originalName}-copy`;
  const record = (name) => ({
    name,
    description: "REST definition transfer fixture",
    integration_type: "REST",
    request_type: "POST",
    url: "https://example.com/orders/lookup",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
    visibility: "private",
  });
  const envelope = (tool) => ({
    format: "contextforge-panel",
    version: 1,
    resource: "tools",
    kind: "create",
    records: [tool],
  });
  const upload = async (dialog, filename, data) => {
    await dialog.locator("input[type=file]").setInputFiles({
      name: filename,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await expect(dialog.locator("tbody tr")).toHaveCount(1);
  };
  const importCurrentPreview = async (dialog, expectedName) => {
    await dialog.locator(".check-label input").check();
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          /\/v1\/tools\/?$/.test(new URL(candidate.url()).pathname) &&
          candidate.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "确认导入", exact: true }).click(),
    ]);
    const responseText = await response.text();
    const requestBody = response.request().postDataJSON();
    expect([200, 201], JSON.stringify({ requestBody, responseText })).toContain(
      response.status(),
    );
    expect(requestBody.tool.name).toBe(expectedName);
    const result = JSON.parse(responseText);
    const id = result.id || result.tool?.id;
    expect(id).toBeTruthy();
    createdIds.push(id);
    await expect(dialog.locator(".batch-results")).toContainText("成功");
    return id;
  };
  try {
    await login(page);
    await page.goto(root + "/app/#tools");
    await page
      .getByRole("button", {
        name: /REST 工具导入 \/ 导出|REST tool import \/ export/,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await upload(
      dialog,
      "rest-definition.json",
      envelope(record(originalName)),
    );
    const originalId = await importCurrentPreview(dialog, originalName);
    const originalResponse = await api.get(
      root + "/v1/tools/" + encodeURIComponent(originalId),
    );
    expect(originalResponse.status()).toBe(200);
    const original = await originalResponse.json();
    expect(original.name).toBe(originalName);
    expect(original.integration_type || original.integrationType).toBe("REST");

    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByLabel("Filter resources").fill(originalName);
    await expect(page.getByLabel(`Select ${originalName}`)).toBeVisible();
    await page.getByLabel(`Select ${originalName}`).check();
    await page
      .getByRole("button", {
        name: /REST 工具导入 \/ 导出|REST tool import \/ export/,
      })
      .click();
    const exportDialog = page.getByRole("dialog");

    const [selectedDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportDialog
        .getByRole("button", {
          name: /^导出 REST 定义：已选 \/ 当前页/,
        })
        .click(),
    ]);
    const selectedExport = JSON.parse(
      await readFile(await selectedDownload.path(), "utf8"),
    );
    expect(selectedExport.records.map((item) => item.name)).toEqual([
      originalName,
    ]);

    const [matchedDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportDialog
        .getByRole("button", { name: /^导出 REST 定义：全部匹配项/ })
        .click(),
    ]);
    const matchedExport = JSON.parse(
      await readFile(await matchedDownload.path(), "utf8"),
    );
    expect(matchedExport.records.map((item) => item.name)).toEqual([
      originalName,
    ]);

    const renamed = {
      ...matchedExport,
      records: matchedExport.records.map((item) => ({
        ...item,
        name: renamedName,
      })),
    };
    await upload(exportDialog, "renamed-rest-definition.json", renamed);
    const renamedId = await importCurrentPreview(exportDialog, renamedName);
    const renamedResponse = await api.get(
      root + "/v1/tools/" + encodeURIComponent(renamedId),
    );
    expect(renamedResponse.status()).toBe(200);
    const reimported = await renamedResponse.json();
    expect(reimported.name).toBe(renamedName);
    expect(reimported.integration_type || reimported.integrationType).toBe(
      "REST",
    );
  } finally {
    await Promise.allSettled(
      createdIds.map((id) => api.delete(root + "/v1/tools/" + id)),
    );
    await api.post(root + "/_panel/logout");
    await api.dispose();
  }
});

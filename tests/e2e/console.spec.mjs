import { test, expect, request } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fixturePassword } from "../fixtures/identity.mjs";
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const origin = new URL(root).origin;
const run = randomUUID().slice(0, 8);
let email;
let password;
let admin;
const servers = [];
const roles = [];
test.beforeAll(async () => {
  email = `browser-user-${randomUUID().slice(0, 8)}@example.com`;
  password = fixturePassword();
  admin = await request.newContext({
    extraHTTPHeaders: { Origin: origin, "X-Panel-Request": "1" },
  });
  const login = await admin.post(root + "/_panel/login", {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(login.status()).toBe(200);
  const create = await admin.post(root + "/v1/auth/email/admin/users", {
    data: {
      email,
      password,
      full_name: "Browser Test User",
      is_admin: false,
      password_change_required: false,
    },
  });
  expect(create.status()).toBe(201);
  await mkdir(".cache/reports", { recursive: true });
});
test.afterAll(async () => {
  if (admin) {
    for (const id of servers) await admin.delete(root + "/v1/servers/" + id);
    for (const id of roles) {
      await admin.delete(
        root +
          "/v1/rbac/users/" +
          encodeURIComponent(email) +
          "/roles/" +
          id +
          "?scope=global",
      );
      await admin.delete(root + "/v1/rbac/roles/" + id);
    }
    await admin.delete(
      root + "/v1/auth/email/admin/users/" + encodeURIComponent(email),
    );
    await admin.post(root + "/_panel/logout");
    await admin.dispose();
  }
});
async function login(page, user = credentials) {
  await page.goto("./");
  await page.getByLabel("邮箱地址", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}

test("login distinguishes an incorrect origin from invalid credentials and root opens the console", async ({
  page,
}) => {
  await page.goto(new URL("/", origin).href);
  await expect(page).toHaveURL(root + "/app/");
  await page
    .getByLabel("邮箱地址", { exact: true })
    .fill("invalid-user@example.com");
  await page
    .getByLabel("密码", { exact: true })
    .fill("invalid-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("登录凭据无效");
  const alternate = new URL(root + "/app/");
  alternate.hostname =
    alternate.hostname === "localhost" ? "127.0.0.1" : "localhost";
  await page.goto(alternate.href);
  await expect(
    page.getByRole("link", { name: root + "/app/", exact: true }),
  ).toHaveAttribute("href", root + "/app/");
  await page
    .getByLabel("邮箱地址", { exact: true })
    .fill("invalid-user@example.com");
  await page
    .getByLabel("密码", { exact: true })
    .fill("invalid-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "请使用登录页" }),
  ).toContainText("访问地址与部署配置不一致");
});

test("mobile resource forms keep the header and complete actions visible while only the body scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const route of ["gateways", "tools", "tokens"]) {
    await page.goto(root + "/app/#" + route);
    await page
      .getByRole("button", {
        name:
          route === "tokens"
            ? "创建 API Key"
            : route === "tools"
              ? "创建 REST 工具"
              : "新建",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    if (route === "tokens")
      await dialog
        .getByLabel("授权方式", { exact: true })
        .selectOption("custom");
    const body = dialog.locator(".dialog-body");
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const geometry = await dialog.evaluate((node) => ({
      outerScrollable: node.scrollHeight > node.clientHeight + 1,
      overflow: getComputedStyle(node).overflowY,
      footer: node
        .querySelector(".dialog-footer")
        .getBoundingClientRect()
        .toJSON(),
      header: node
        .querySelector(".dialog-header")
        .getBoundingClientRect()
        .toJSON(),
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(geometry.outerScrollable).toBe(false);
    expect(geometry.overflow).toBe("hidden");
    expect(geometry.header.top).toBeGreaterThanOrEqual(0);
    expect(geometry.footer.bottom).toBeLessThanOrEqual(844);
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
    for (const button of await dialog.locator(".dialog-footer button").all()) {
      const box = await button.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: `.cache/reports/p1-mobile-${route}.png` });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page.goto(root + "/app/#api");
  await page.getByLabel("Search API", { exact: true }).fill("POST /v1/tools");
  await page
    .locator(".api-row")
    .filter({ has: page.locator("code").filter({ hasText: /^\/v1\/tools$/ }) })
    .click();
  const apiDialog = page.getByRole("dialog");
  await apiDialog.locator(".dialog-body").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(
    await apiDialog.evaluate(
      (node) => node.scrollHeight <= node.clientHeight + 1,
    ),
  ).toBe(true);
  for (const button of await apiDialog.locator(".dialog-footer button").all()) {
    const box = await button.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: ".cache/reports/p1-mobile-api.png" });
  await apiDialog.getByRole("button", { name: "关闭", exact: true }).click();
});

test("tool details prioritize purpose and ownership with grouped configuration and direct edit", async ({
  page,
}) => {
  const name = "p1-tool-" + run;
  const create = await admin.post(root + "/v1/tools", {
    data: {
      tool: {
        name,
        description: "P1 detail workflow fixture",
        integration_type: "REST",
        request_type: "POST",
        url: "https://example.com/panel-fixture",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
        visibility: "private",
      },
    },
  });
  expect(create.status()).toBe(200);
  const tool = await create.json();
  try {
    await login(page);
    await page.goto(root + "/app/#tools");
    await page.getByLabel("Filter resources").fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".tool-overview")).toContainText(
      "P1 detail workflow fixture",
    );
    await expect(dialog.locator(".tool-overview")).toContainText("所有者");
    await expect(dialog.locator(".tool-overview")).toContainText("已启用");
    await expect(
      dialog
        .locator("details")
        .filter({ has: page.getByText("输入输出", { exact: true }) }),
    ).not.toHaveAttribute("open", "");
    await dialog.getByText("输入输出", { exact: true }).click();
    await expect(dialog.locator(".tool-details")).toContainText("message");
    await expect(
      dialog.locator("details").filter({ hasText: "查看原始数据" }),
    ).not.toHaveAttribute("open", "");
    await page.screenshot({ path: ".cache/reports/p1-tool-details.png" });
    await dialog.getByRole("button", { name: "编辑工具", exact: true }).click();
    await expect(dialog.getByLabel("name", { exact: true })).toHaveValue(name);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  } finally {
    await admin.delete(root + "/v1/tools/" + tool.id);
  }
});

test("connection guide copies selected client configurations and performs a real MCP handshake", async ({
  page,
  context,
}) => {
  const created = await admin.post(root + "/v1/servers", {
    data: { server: { name: "p1-connect-" + run, visibility: "private" } },
  });
  expect(created.status()).toBe(201);
  const server = await created.json();
  servers.push(server.id);
  const keyResponse = await admin.post(root + "/v1/tokens", {
    data: {
      name: "p1-connect-" + run,
      expires_in_days: 1,
      scope: {
        server_id: server.id,
        permissions: ["servers.read", "tools.read"],
      },
    },
  });
  expect(keyResponse.status()).toBe(201);
  const key = await keyResponse.json();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page);
    await page.goto(root + "/app/#connections");
    const mcp = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "MCP · Streamable HTTP",
        exact: true,
      }),
    });
    await expect(
      mcp.getByRole("button", { name: "复制完整配置" }),
    ).toBeDisabled();
    await mcp.getByLabel("server_id", { exact: true }).selectOption(server.id);
    await mcp.getByLabel("MCP API Key", { exact: true }).fill(key.access_token);
    await mcp
      .getByLabel("客户端配置格式", { exact: true })
      .selectOption("vscode");
    await mcp.getByRole("button", { name: "复制完整配置" }).click();
    const copied = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(copied.servers.contextforge.url).toBe(
      root + `/servers/${server.id}/mcp`,
    );
    expect(
      copied.servers.contextforge.headers.Authorization ===
        "Bearer " + key.access_token,
    ).toBe(true);
    expect(await mcp.locator("pre").textContent()).not.toContain(
      key.access_token,
    );
    await mcp.getByRole("button", { name: "检查连接" }).click();
    await expect(mcp.getByRole("status")).toContainText("MCP 初始化握手成功", {
      timeout: 25000,
    });
    await page.screenshot({ path: ".cache/reports/p1-connections.png" });
    await mcp
      .getByLabel("MCP API Key", { exact: true })
      .fill("invalid-fixture-key");
    await mcp.getByRole("button", { name: "检查连接" }).click();
    await expect(mcp.getByRole("status")).toContainText("MCP 握手失败", {
      timeout: 25000,
    });
    const llm = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "LLM · OpenAI compatible",
        exact: true,
      }),
    });
    await expect(llm.getByLabel("LLM API 前缀", { exact: true })).toHaveValue(
      "/llm/v1",
    );
    await llm.getByLabel("模型", { exact: true }).fill("fixture-model");
    await llm
      .getByLabel("LLM API Key", { exact: true })
      .fill("invalid-fixture-key");
    await llm.getByRole("button", { name: "复制完整配置" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      root + "/llm/v1/chat/completions",
    );
    await llm.getByRole("button", { name: "检查连接" }).click();
    await expect(llm.getByRole("status")).toContainText("401", {
      timeout: 25000,
    });
    await expect(
      page.getByRole("heading", { level: 1, name: "连接指南" }),
    ).toBeVisible();
    await page.getByLabel("Change language").click();
    await expect(
      mcp.getByRole("button", { name: "Copy configuration", exact: true }),
    ).toBeVisible();
    await expect(
      mcp.getByLabel("Client configuration format", { exact: true }),
    ).toBeVisible();

    const secondResponse = await admin.post(root + "/v1/servers", {
      data: { server: { name: "p1-switch-" + run, visibility: "private" } },
    });
    expect(secondResponse.status()).toBe(201);
    const second = await secondResponse.json();
    servers.push(second.id);
    await page.goto(root + "/app/#servers");
    await page
      .getByRole("row")
      .filter({ hasText: "p1-connect-" + run })
      .getByLabel("Connection", { exact: true })
      .click();
    const connectionPanel = page.locator(".connection-result");
    await connectionPanel
      .getByLabel("MCP API Key", { exact: true })
      .fill("invalid-fixture-key");
    await expect(connectionPanel.locator("pre")).toContainText(server.id);
    await connectionPanel
      .getByRole("button", { name: "Close connection", exact: true })
      .click();
    await page
      .getByRole("row")
      .filter({ hasText: "p1-switch-" + run })
      .getByLabel("Connection", { exact: true })
      .click();
    await expect(
      connectionPanel.getByLabel("server_id", { exact: true }),
    ).toHaveValue(second.id);
    await expect(
      connectionPanel.getByLabel("MCP API Key", { exact: true }),
    ).toHaveValue("");
    await connectionPanel
      .getByLabel("MCP API Key", { exact: true })
      .fill("invalid-fixture-key");
    await expect(connectionPanel.locator("pre")).toContainText(second.id);
    await expect(connectionPanel.locator("pre")).not.toContainText(server.id);
  } finally {
    await admin.delete(root + "/v1/tokens/" + key.token.id);
  }
});
test("admin sees workspace, role management and permission catalog without runtime errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.screenshot({
    path: ".cache/reports/dashboard.png",
    fullPage: true,
  });
  await page.locator("nav").getByRole("link", { name: "角色与权限" }).click();
  await expect(
    page.getByRole("heading", { name: "访问控制", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "权限目录", exact: true }).click();
  await expect(page.locator(".permission-catalog")).toContainText("tools");
  await page.getByRole("button", { name: "用户角色", exact: true }).click();
  await page.getByLabel("User email").fill(email);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.locator(".assignment-list")).toContainText("viewer");
  await page.screenshot({ path: ".cache/reports/rbac.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "角色与权限" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("ordinary user creates a key, copies the creation response and revokes it through batch management", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, { email, password });
  await expect(
    page.locator("nav").getByRole("link", { name: "角色与权限" }),
  ).toHaveCount(0);
  await page
    .locator("nav")
    .getByRole("link", { name: /我的 API Key/ })
    .click();
  await page.getByRole("button", { name: "创建 API Key", exact: true }).click();
  await page.getByLabel("name", { exact: true }).fill(`browser-key-${run}`);
  await page.getByLabel("expires_in_days", { exact: true }).fill("1");
  await expect(page.locator(".permission-summary")).toContainText(
    "继承账户 RBAC 权限",
  );
  await page.getByLabel("授权方式", { exact: true }).selectOption("custom");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建 API Key", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "自定义权限至少需要选择一项",
  );
  await page.getByLabel("筛选权限选项").fill("tools");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /全选匹配项/ })
    .click();
  await expect(
    page.locator(".permission-picker input[type=checkbox]").first(),
  ).toBeChecked();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /取消匹配项/ })
    .click();
  await expect(
    page.locator(".permission-picker input[type=checkbox]").first(),
  ).not.toBeChecked();
  await page.getByLabel("授权方式", { exact: true }).selectOption("inherit");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建 API Key", exact: true })
    .click();
  await expect(page.locator(".key-delivery code")).toContainText("ey");
  await page.screenshot({
    path: ".cache/reports/key-created.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator("table")).toContainText(`browser-key-${run}`);
  await page.getByLabel(`Select browser-key-${run}`, { exact: true }).check();
  await page.getByRole("button", { name: "删除 / 撤销", exact: true }).click();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.locator(".batch-results")).toContainText("成功");
  expect(errors).toEqual([]);
});
test("mobile navigation, runtime prefix and English language preference survive reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, { email, password });
  await page.getByLabel("Open navigation").click();
  await page
    .locator("nav")
    .getByRole("link", { name: /我的 API Key/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "我的 API Key" }),
  ).toBeVisible();
  await page.getByLabel("Change language").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "My API keys" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "My API keys" }),
  ).toBeVisible();
  await page.screenshot({ path: ".cache/reports/mobile.png", fullPage: true });
  expect(page.url()).toContain("/forge/app/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("server form and cross-page bulk disable and delete operate on frozen targets", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page
    .locator("nav")
    .getByRole("link", { name: "虚拟服务器", exact: true })
    .click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("name", { exact: true }).fill("ui-created-" + run);
  await expect(page.getByLabel("visibility", { exact: true })).toHaveValue(
    "private",
  );
  await expect(
    page.getByLabel("visibility", { exact: true }).locator("option"),
  ).toHaveText([
    "—",
    "private · 仅自己",
    "team · 所属团队",
    "public · 所有获准用户",
  ]);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url() === root + "/v1/servers" && r.request().method() === "POST",
    ),
    page
      .getByRole("dialog")
      .getByRole("button", { name: "创建虚拟服务器", exact: true })
      .click(),
  ]);
  expect(response.status()).toBe(201);
  await expect(page.locator(".resource-result")).toContainText("操作成功");
  const created = await response.json();
  servers.push(created.id);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const prefix = "bulk-fixture-" + run;
  const bulkTargets = [];
  for (let i = 0; i < 28; i++) {
    const response = await admin.post(root + "/v1/servers", {
      data: { server: { name: prefix + "-" + i, visibility: "public" } },
    });
    expect(response.status()).toBe(201);
    const id = (await response.json()).id;
    servers.push(id);
    bulkTargets.push(id);
  }
  await page.getByLabel("Refresh", { exact: true }).click();
  await page.getByLabel("Filter resources").fill(prefix);
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByRole("button", { name: "选择跨页全部匹配项", exact: true })
    .click();
  await expect(page.locator(".bulk-bar>strong")).toHaveText("已选择 28 项");
  await page.getByRole("button", { name: "批量修改", exact: true }).click();
  await page
    .locator(".batch-panel")
    .getByRole("checkbox", { name: "description", exact: true })
    .check();
  await page
    .locator(".batch-panel")
    .getByRole("textbox", { name: "description", exact: true })
    .fill("temporary description");
  await page
    .locator(".batch-panel")
    .getByRole("textbox", { name: "description", exact: true })
    .fill("");
  await expect(
    page
      .locator(".batch-panel")
      .getByRole("checkbox", { name: "description", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.locator(".batch-results>div")).toHaveCount(28);
  await expect(page.locator(".batch-results")).not.toContainText("失败");
  await page.getByLabel("Close batch").click();
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByRole("button", { name: "选择跨页全部匹配项", exact: true })
    .click();
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.locator(".batch-results>div")).toHaveCount(28);
  await expect(page.locator(".batch-results")).not.toContainText("失败");
  await page.getByLabel("Close batch").click();
  await expect(page.locator("tbody tr").first()).toContainText("已停用");
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByRole("button", { name: "选择跨页全部匹配项", exact: true })
    .click();
  await expect(page.locator(".bulk-bar>strong")).toHaveText("已选择 28 项");
  await page.getByRole("button", { name: "删除 / 撤销", exact: true }).click();
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(page.locator(".batch-results>div")).toHaveCount(28);
  for (const id of bulkTargets)
    expect((await admin.get(root + "/v1/servers/" + id)).status()).toBe(404);
});
test("password recovery deep link survives refresh and preserves asset base", async ({
  page,
}) => {
  await page.goto("./reset-password/example-invalid-token");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("token", { exact: true })).toHaveValue(
    "example-invalid-token",
  );
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.locator("base").getAttribute("href")).toBe("/forge/app/");
});

test("new role appears immediately in scoped assignment choices and can be revoked without re-entering IDs", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("nav")
    .getByRole("link", { name: "角色与权限", exact: true })
    .click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("name", { exact: true }).fill("ux-role-" + run);
  await dialog.getByLabel("scope", { exact: true }).selectOption("global");
  await dialog.getByLabel("筛选权限选项").fill("tools.read");
  await dialog
    .locator(".permission-choices")
    .getByRole("checkbox")
    .first()
    .check();
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url() === root + "/v1/rbac/roles" && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "创建角色", exact: true }).click(),
  ]);
  expect(created.ok()).toBe(true);
  const role = await created.json();
  roles.push(role.id);
  await expect(dialog.locator(".resource-result")).toContainText("操作成功");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByLabel("User email").fill(email);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.locator(".assignment-list")).toContainText("viewer");
  await page.getByRole("button", { name: "分配角色", exact: true }).click();
  await expect(
    dialog.getByLabel("role_id", { exact: true }).locator("option"),
  ).toContainText(["ux-role-" + run]);
  await dialog.getByLabel("role_id", { exact: true }).selectOption(role.id);
  await dialog.getByRole("button", { name: "分配角色", exact: true }).click();
  await expect(dialog.locator(".resource-result")).toContainText("操作成功");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const row = page
    .locator(".assignment-list>div")
    .filter({ hasText: "ux-role-" + run });
  await expect(row).toBeVisible();
  await row.getByLabel("Revoke role").click();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "撤销角色分配", exact: true })
    .click();
  await expect(dialog.locator(".resource-result")).toContainText("操作成功");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("resource details open directly, edits load complete values and imports preview before creating", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page
    .locator("nav")
    .getByRole("link", { name: "虚拟服务器", exact: true })
    .click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.getByLabel("name", { exact: true }).fill("ux-flow-" + run);
  await page.getByLabel("visibility", { exact: true }).selectOption("team");
  await dialog
    .getByRole("button", { name: "创建虚拟服务器", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("所属团队");
  await page.getByLabel("visibility", { exact: true }).selectOption("private");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url() === root + "/v1/servers" && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "创建虚拟服务器", exact: true }).click(),
  ]);
  const created = await response.json();
  servers.push(created.id);
  await expect(dialog.locator(".resource-result")).toContainText("操作成功");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByLabel("Filter resources").fill("ux-flow-" + run);
  await page
    .getByRole("button", { name: "ux-flow-" + run, exact: true })
    .click();
  await expect(dialog.locator(".record-details").first()).toContainText(
    "ux-flow-" + run,
  );
  await expect(dialog.getByLabel("server_id", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "执行", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(dialog.getByLabel("name", { exact: true })).toHaveValue(
    "ux-flow-" + run,
  );
  await expect(dialog.getByLabel("visibility", { exact: true })).toHaveValue(
    "private",
  );
  await dialog
    .getByLabel("description", { exact: true })
    .fill("edited through resource workflow");
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.locator(".resource-result")).toContainText("操作成功");
  expect(
    (await (await admin.get(root + "/v1/servers/" + created.id)).json())
      .description,
  ).toBe("edited through resource workflow");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "导入 / 导出", exact: true }).click();
  const transfer = page.locator(".transfer-panel");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    transfer.getByRole("button", { name: /导出已选/ }).click(),
  ]);
  const path = await download.path();
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.records[0].description).toBe(
    "edited through resource workflow",
  );
  expect(exported.records[0].id).toBeUndefined();
  await transfer.locator("input[type=file]").setInputFiles({
    name: "servers.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...exported,
        records: exported.records.map((v) => ({
          ...v,
          name: "imported-" + run,
        })),
      }),
    ),
  });
  await expect(transfer.locator("tbody")).toContainText("可创建");
  await transfer.getByRole("checkbox").check();
  const [imported] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url() === root + "/v1/servers" && r.request().method() === "POST",
    ),
    transfer.getByRole("button", { name: "确认导入", exact: true }).click(),
  ]);
  expect(imported.status()).toBe(201);
  servers.push((await imported.json()).id);
  await expect(transfer.locator(".batch-results")).toContainText("成功");
  expect(errors).toEqual([]);
});

test("governance overviews are distinct from all actions and settings validate headers before saving", async ({
  page,
}) => {
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (
      r.status() >= 400 &&
      /\/api\/logs|\/v1\/observability|\/v1\/admin\/config/.test(r.url())
    )
      failedRequests.push(r.status() + " " + new URL(r.url()).pathname);
  });
  await login(page);
  for (const name of ["日志与审计", "可观测性", "系统设置"]) {
    await page.locator("nav").getByRole("link", { name, exact: true }).click();
    await expect(page.locator(".governance-page")).toBeVisible();
    await expect(page.locator(".api-row")).toHaveCount(0);
    await page.getByRole("button", { name: /全部操作/ }).click();
    await expect(page.locator(".api-row").first()).toBeVisible();
    await page.getByRole("button", { name: "资源列表", exact: true }).click();
    await expect(page.locator(".governance-page")).toBeVisible();
    await page.screenshot({
      path:
        ".cache/reports/" +
        (name === "系统设置"
          ? "settings"
          : name === "日志与审计"
            ? "logs"
            : "observability") +
        ".png",
      fullPage: true,
    });
    if (name === "日志与审计") {
      await page
        .getByLabel("开始时间", { exact: true })
        .fill("2026-10-15T18:00");
      await page
        .getByLabel("结束时间", { exact: true })
        .fill("2026-10-14T18:00");
      await page.getByRole("button", { name: "检索", exact: true }).click();
      await expect(page.locator(".governance-search-panel")).toContainText(
        "开始时间",
      );
      await expect(
        page.locator(".governance-search-panel .alert.error"),
      ).toBeVisible();
    }
  }
  await page
    .getByRole("textbox", { name: /允许透传的请求头名称/ })
    .fill("invalid header name");
  await page.getByRole("button", { name: "预览变更", exact: true }).click();
  await expect(page.locator(".governance-page .alert.error")).toContainText(
    "Header",
  );
  await expect(
    page.getByRole("button", { name: "应用", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "原生配置备份与迁移", exact: true })
    .click();
  const transfer = page.getByRole("dialog", {
    name: "原生配置备份与迁移",
    exact: true,
  });
  await transfer.locator("input[type=file]").setInputFiles({
    name: "native.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: "2025-03-26",
        exported_at: new Date().toISOString(),
        entities: { servers: [{ name: "native-dry-" + run }] },
      }),
    ),
  });
  const [dry] = await Promise.all([
    page.waitForResponse(
      (r) => r.url() === root + "/v1/import" && r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "后端预检查（不修改资源）", exact: true })
      .click(),
  ]);
  expect(dry.status()).toBe(200);
  expect(dry.request().postDataJSON().dry_run).toBe(true);
  await expect(transfer.locator(".governance-preview")).toContainText(
    "completed",
  );
  await expect(
    page.getByRole("button", { name: "执行配置导入", exact: true }),
  ).toBeDisabled();
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("row menus escape clipping, slow endpoints render as rows, and log filters align at responsive widths", async ({
  page,
}) => {
  const name = "layout-menu-" + run;
  const created = await admin.post(root + "/v1/servers", {
    data: { server: { name, visibility: "private" } },
  });
  expect(created.status()).toBe(201);
  servers.push((await created.json()).id);
  await login(page);
  await page
    .locator("nav")
    .getByRole("link", { name: "虚拟服务器", exact: true })
    .click();
  await page.getByLabel("Filter resources").fill(name);
  const trigger = page.getByLabel("更多操作", { exact: true });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "资源操作" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(
    true,
  );
  const last = menu.getByRole("menuitem").last();
  await last.scrollIntoViewIfNeeded();
  expect(
    await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return el === hit || el.contains(hit);
    }),
  ).toBe(true);
  await page.screenshot({ path: ".cache/reports/row-menu.png" });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "删除虚拟服务器", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await trigger.click();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(menu).toHaveCount(0);

  const endpoint = "POST /servers/" + "a".repeat(180) + "/mcp";
  await page.route("**/v1/observability/stats?*", (route) =>
    route.fulfill({
      json: {
        time_window_hours: 24,
        total_traces: 28,
        success_count: 28,
        error_count: 0,
        error_rate: 0,
        avg_duration_ms: 56.96,
        slowest_endpoints: [
          { name: endpoint, avg_duration_ms: 321.5, count: 12 },
        ],
      },
    }),
  );
  await page
    .locator("nav")
    .getByRole("link", { name: "可观测性", exact: true })
    .click();
  const slow = page.locator(".slowest-endpoints");
  await expect(slow.locator("tbody tr")).toHaveCount(1);
  await expect(slow.locator("tbody")).toContainText(endpoint);
  await expect(slow.locator("tbody")).toContainText("321.5");
  await expect(
    page.locator(".governance-stats .governance-stat-card"),
  ).toHaveCount(6);
  await expect(page.locator(".governance-stats")).not.toContainText(
    "slowest_endpoints",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".cache/reports/slow-endpoints.png" });

  await page
    .locator("nav")
    .getByRole("link", { name: "日志与审计", exact: true })
    .click();
  const grid = page.locator(".logs-filter-grid");
  for (const width of [1440, 960, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390)
      await expect
        .poll(() =>
          page
            .locator(".sidebar")
            .evaluate((el) => el.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(1);
    const geometry = await grid.evaluate((el) => ({
      columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
      boxes: [
        ...el.querySelectorAll(".log-search-text .search-field,.field > input"),
      ].map((input) => {
        const r = input.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, height: r.height };
      }),
    }));
    expect(geometry.columns).toBe(width === 1440 ? 4 : width === 960 ? 2 : 1);
    expect(geometry.boxes.every((r) => Math.abs(r.height - 42) < 1)).toBe(true);
    expect(geometry.boxes.every((r) => r.x >= 0 && r.right <= width)).toBe(
      true,
    );
    if (width === 1440) {
      expect(geometry.boxes[0].right - geometry.boxes[0].x).toBeGreaterThan(
        (geometry.boxes[1].right - geometry.boxes[1].x) * 1.9,
      );
      expect(Math.abs(geometry.boxes[0].y - geometry.boxes[1].y)).toBeLessThan(
        1,
      );
      expect(Math.abs(geometry.boxes[1].y - geometry.boxes[2].y)).toBeLessThan(
        1,
      );
      expect(
        Math.max(...geometry.boxes.slice(3).map((r) => r.y)) -
          Math.min(...geometry.boxes.slice(3).map((r) => r.y)),
      ).toBeLessThan(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator(".governance-search-panel")
      .screenshot({ path: ".cache/reports/log-filters-" + width + ".png" });
  }
});

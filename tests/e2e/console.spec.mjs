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
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(page.locator(".result")).toContainText("access_token");
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
  await page.getByRole("button", { name: "执行", exact: true }).click();
  await expect(page.locator(".result pre")).toContainText("ui-created-" + run);
  const created = JSON.parse(await page.locator(".result pre").innerText());
  servers.push(created.id);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const prefix = "bulk-fixture-" + run;
  for (let i = 0; i < 28; i++) {
    const response = await admin.post(root + "/v1/servers", {
      data: { server: { name: prefix + "-" + i, visibility: "public" } },
    });
    expect(response.status()).toBe(201);
    servers.push((await response.json()).id);
  }
  await page.getByLabel("Refresh", { exact: true }).click();
  await page.getByLabel("Filter resources").fill(prefix);
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByRole("button", { name: "选择跨页全部匹配项", exact: true })
    .click();
  await expect(page.locator(".bulk-bar>strong")).toHaveText("已选择 28 项");
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
  for (const id of servers.slice(1))
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

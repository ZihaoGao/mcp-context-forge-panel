import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const teamId = "fixture-tool-team";
const tool = {
  id: "fixture-auth-tool",
  name: "fixture-auth-tool",
  description: "Fixture tool",
  url: "https://example.com/lookup",
  integrationType: "REST",
  requestType: "POST",
  visibility: "public",
  enabled: true,
  inputSchema: { type: "object", properties: {} },
  teamId,
  team: { name: "Assigned team" },
  auth: { authType: "bearer", token: "masked", authValue: "masked" },
};
async function fixture(page, overrides = {}) {
  const writes = [];
  const record = { ...tool, ...overrides };
  await page.route("**/v1/teams/**", (route) =>
    route.fulfill({
      json: {
        teams: [
          { id: teamId, name: "Assigned team" },
          { id: "other-team", name: "Other team" },
        ],
        total: 2,
      },
    }),
  );
  await page.route("**/v1/tools**", (route) => {
    const req = route.request();
    if (["PUT", "POST"].includes(req.method())) {
      writes.push({ method: req.method(), body: req.postDataJSON() });
      return route.fulfill({ json: record });
    }
    return route.fulfill({
      json: new URL(req.url()).pathname.endsWith("/" + tool.id)
        ? record
        : { tools: [record], total: 1 },
    });
  });
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
  await page.goto(root + "/app/#tools");
  return writes;
}

for (const mode of ["create", "edit"]) {
  test(`tool ${mode} flags incompatible array input before saving and recovers after correction`, async ({
    page,
  }) => {
    const writes = await fixture(page);
    await page
      .getByRole("button", {
        name: mode === "create" ? "创建 REST 工具" : "编辑",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    if (mode === "create") {
      await dialog.getByLabel("name", { exact: true }).fill("array-input-tool");
      await dialog
        .getByLabel("url", { exact: true })
        .fill("https://example.com/lookup");
    }
    const input = dialog.getByLabel("inputSchema", { exact: true });
    await input.fill(
      JSON.stringify({ type: "array", items: { type: "string" } }),
    );
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("alert")).toContainText("顶层参数为对象");
    const save = dialog.getByRole("button", {
      name: mode === "create" ? "创建REST 工具" : "保存修改",
      exact: true,
    });
    await save.click();
    expect(writes).toHaveLength(0);
    const corrected = {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" } } },
    };
    await input.fill(JSON.stringify(corrected));
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await save.click();
    await expect(dialog).toContainText("操作成功");
    expect(writes).toHaveLength(1);
    expect((writes[0].body.tool || writes[0].body).inputSchema).toEqual(
      corrected,
    );
  });
}

for (const width of [1440, 390]) {
  test(`team-visible tool edits retain immutable team and omit stored credentials at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const writes = await fixture(page);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Tool team", { exact: true })).toHaveValue(
      "Assigned team",
    );
    await expect(
      dialog.getByLabel("Tool team", { exact: true }),
    ).not.toBeEditable();
    await expect(dialog).toContainText("当前认证方式");
    await expect(dialog.getByLabel("authType", { exact: true })).toHaveValue(
      "",
    );
    await expect(dialog.getByLabel("token", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("visibility", { exact: true }).selectOption("team");
    await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(dialog).toContainText("操作成功");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.visibility).toBe("team");
    for (const name of [
      "teamId",
      "team_id",
      "auth",
      "auth_type",
      "auth_token",
      "authHeaders",
      "auth_headers",
    ])
      expect(writes[0].body[name]).toBeUndefined();
  });
}

test("tools without a team cannot choose an unsupported team assignment in edit", async ({
  page,
}) => {
  await fixture(page, { teamId: null, team: null });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Tool team", { exact: true })).toHaveValue(
    "未分配团队",
  );
  await expect(
    dialog
      .getByLabel("visibility", { exact: true })
      .locator('option[value="team"]'),
  ).toHaveAttribute("disabled", "");
  await expect(dialog).toContainText("请在创建工具时选择团队");
});

for (const type of ["basic", "bearer", "authheaders"]) {
  test(`REST tool creation submits canonical ${type} authentication fields`, async ({
    page,
  }) => {
    const writes = await fixture(page);
    const selectedTeam = type === "basic" ? "other-team" : teamId;
    if (type === "basic")
      await page.getByLabel("Team context").selectOption(teamId);
    await page
      .getByRole("button", { name: "创建 REST 工具", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("name", { exact: true }).fill("new-auth-tool");
    await dialog
      .getByLabel("url", { exact: true })
      .fill("https://example.com/lookup");
    await dialog.getByLabel("visibility", { exact: true }).selectOption("team");
    await dialog
      .getByLabel("team_id", { exact: true })
      .selectOption(selectedTeam);
    await dialog.getByLabel("authType", { exact: true }).selectOption(type);
    await dialog
      .getByRole("button", { name: "创建REST 工具", exact: true })
      .click();
    expect(writes).toHaveLength(0);
    const value = randomUUID();
    if (type === "basic") {
      await dialog.getByLabel("username", { exact: true }).fill("fixture-user");
      await dialog.getByLabel("password", { exact: true }).fill(value);
    } else if (type === "bearer")
      await dialog.getByLabel("token", { exact: true }).fill(value);
    else {
      await dialog
        .getByLabel("authHeaderKey", { exact: true })
        .fill("X-Api-Key");
      await dialog.getByLabel("authHeaderValue", { exact: true }).fill(value);
    }
    await dialog
      .getByRole("button", { name: "创建REST 工具", exact: true })
      .click();
    await expect(dialog).toContainText("操作成功");
    expect(writes).toHaveLength(1);
    const body = writes[0].body;
    expect(body.team_id).toBe(selectedTeam);
    expect(body.tool.auth_type).toBe(type);
    expect(body.tool.auth).toBeUndefined();
    expect(
      type === "basic"
        ? body.tool.auth_password === value
        : type === "bearer"
          ? body.tool.auth_token === value
          : body.tool.auth_headers?.[0]?.value === value,
    ).toBe(true);
  });
}

test("changing authentication clears old input and explicit none removes authentication", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("authType", { exact: true })).toBeVisible();
  await dialog.getByLabel("authType", { exact: true }).selectOption("bearer");
  await dialog.getByLabel("token", { exact: true }).fill(randomUUID());
  await dialog.getByLabel("authType", { exact: true }).selectOption("basic");
  await expect(dialog.getByLabel("token", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("username", { exact: true })).toHaveValue("");
  await dialog.getByLabel("authType", { exact: true }).selectOption("none");
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toContainText("操作成功");
  expect(writes[0].body.auth).toEqual({ authType: "none", authValue: "" });
  expect(writes[0].body.auth_token).toBeUndefined();
});

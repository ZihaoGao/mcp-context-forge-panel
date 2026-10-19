import { test, expect, request } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const ids = {
  server: randomUUID(),
  tool: randomUUID(),
  hidden: randomUUID(),
  resource: randomUUID(),
  prompt: randomUUID(),
  agent: randomUUID(),
};
async function login(page) {
  await page.goto("./");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}

test("team menu labels, locale and member removal agree with the selected operation", async ({
  page,
}) => {
  const writes = [];
  await page.route("**/v1/teams/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "DELETE") {
      writes.push(url.pathname);
      return route.fulfill({ json: { message: "removed" } });
    }
    return route.fulfill({
      json: {
        teams: [{ id: "menu-team", name: "Menu team", visibility: "private" }],
        total: 1,
      },
    });
  });
  await login(page);
  await page.goto(root + "/app/#teams");
  await page.getByLabel("更多操作", { exact: true }).click();
  const menu = page.getByRole("menu");
  const expected = [
    "查看成员",
    "添加成员",
    "修改成员角色",
    "移除成员",
    "查看邀请",
    "发送团队邀请",
    "退出团队",
    "查看加入申请",
    "批准加入申请",
    "拒绝加入申请",
    "删除团队",
  ];
  for (const name of expected)
    await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(
      1,
    );
  const labels = await menu.getByRole("menuitem").allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
  await page.getByLabel("Change language").click();
  await page.getByLabel("More actions", { exact: true }).click();
  for (const name of [
    "View members",
    "Add member",
    "Change member role",
    "Remove member",
    "View invitations",
    "Send team invitation",
    "Leave team",
    "View join requests",
    "Approve join request",
    "Reject join request",
    "Delete team",
  ])
    await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(
      1,
    );
  expect((await menu.textContent()).match(/[\u3400-\u9fff]/g)).toBeNull();
  await menu
    .getByRole("menuitem", { name: "Remove member", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Remove member", exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("user_email", { exact: true })
    .fill("member@example.com");
  await expect(dialog).toContainText("member@example.com");
  await dialog
    .getByRole("checkbox", { name: "I confirm the target and impact" })
    .check();
  await dialog
    .getByRole("button", { name: "Remove member", exact: true })
    .click();
  await expect(dialog).toContainText("Saved successfully");
  expect(writes).toEqual([
    "/forge/v1/teams/menu-team/members/member%40example.com",
  ]);
});

for (const width of [1440, 390]) {
  test(`server association IDs, filtering and language at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const record = {
      id: ids.server,
      name: "Association server",
      visibility: "private",
      associatedTools: ["Friendly tool", "Hidden tool"],
      associatedToolIds: [ids.tool, ids.hidden],
      associatedResources: [ids.resource],
      associatedPrompts: [ids.prompt],
      associatedA2aAgents: [ids.agent],
    };
    const writes = [];
    const tools = Array.from({ length: 100 }, (_, i) => ({
      id: randomUUID(),
      name: `Other tool ${i}`,
    }));
    await page.route("**/v1/servers**", async (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        writes.push(req.postDataJSON());
        return route.fulfill({ json: record });
      }
      return route.fulfill({
        json: new URL(req.url()).pathname.endsWith(ids.server)
          ? record
          : { servers: [record], nextCursor: null },
      });
    });
    const toolQueries = [];
    await page.route("**/v1/tools?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      toolQueries.push(params.toString());
      return route.fulfill({
        json: params.has("cursor")
          ? {
              tools: [
                {
                  id: ids.tool,
                  name: "Friendly tool",
                  description: "Searchable purpose",
                  gatewaySlug: "Upstream A",
                },
              ],
              nextCursor: null,
            }
          : { tools, nextCursor: "tools-page-two" },
      });
    });
    for (const [path, key, id, name] of [
      ["resources", "resources", ids.resource, "Readable resource"],
      ["prompts", "prompts", ids.prompt, "Reusable prompt"],
      ["a2a", "agents", ids.agent, "Helpful agent"],
    ])
      await page.route(`**/v1/${path}?*`, (route) =>
        route.fulfill({ json: { [key]: [{ id, name }], nextCursor: null } }),
      );
    await login(page);
    await page.goto(root + "/app/#servers");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const group = dialog.getByRole("group", {
      name: "提供的工具",
      exact: true,
    });
    await expect(
      group.getByRole("checkbox", {
        name: `Friendly tool · ${ids.tool}`,
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      group.getByRole("checkbox", { name: ids.hidden, exact: true }),
    ).toBeChecked();
    await expect(group).toContainText("当前目录中不可见");
    expect(toolQueries.filter((q) => q.includes("cursor="))).toHaveLength(1);
    expect(toolQueries.every((q) => !q.includes("offset="))).toBe(true);
    for (const name of ["提供的资源", "提供的提示词", "提供的智能体"])
      await expect(
        dialog
          .getByRole("group", { name, exact: true })
          .getByRole("checkbox")
          .first(),
      ).toBeChecked();
    await group.getByRole("textbox").fill(" Searchable purpose ");
    await expect(
      group.getByRole("checkbox", {
        name: `Friendly tool · ${ids.tool}`,
        exact: true,
      }),
    ).toBeChecked();
    await group
      .getByRole("button", { name: "取消匹配项", exact: true })
      .click();
    await expect(
      group.getByRole("checkbox", { name: ids.hidden, exact: true }),
    ).toBeChecked();
    // A language update rerenders the existing form without remounting or losing selections.
    await page
      .getByLabel("Change language")
      .evaluate((button) => button.click());
    const englishGroup = dialog.getByRole("group", {
      name: "Provided tools",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", { name: "Edit virtual server", exact: true }),
    ).toBeVisible();
    await expect(englishGroup.getByRole("textbox")).toHaveValue(
      " Searchable purpose ",
    );
    await expect(
      englishGroup.getByRole("checkbox", { name: ids.hidden, exact: true }),
    ).toBeChecked();
    await englishGroup
      .getByRole("button", { name: "Select matching (1)", exact: true })
      .click();
    await englishGroup
      .getByRole("button", { name: "Clear", exact: true })
      .click();
    await englishGroup
      .getByRole("button", { name: "Select matching (1)", exact: true })
      .click();
    await englishGroup.getByRole("combobox").selectOption("selected");
    await expect(englishGroup.getByRole("checkbox")).toHaveCount(1);
    await mkdir(".cache/reports", { recursive: true });
    await dialog.screenshot({
      path: `.cache/reports/association-picker-${width}.png`,
    });
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(dialog).toContainText("Saved successfully");
    expect(writes).toHaveLength(1);
    expect(writes[0].associatedTools).toEqual([ids.tool]);
    for (const key of [
      "associatedResources",
      "associatedPrompts",
      "associatedA2aAgents",
    ])
      expect(writes[0]).not.toHaveProperty(key);
    expect(JSON.stringify(writes[0])).not.toContain("Friendly tool");
  });
}

test("failed association pagination retains existing IDs and supports explicit clearing", async ({
  page,
}) => {
  const writes = [];
  await page.route("**/v1/servers**", (route) => {
    const record = {
      id: ids.server,
      name: "Failure server",
      associatedTools: ["Friendly tool"],
      associatedToolIds: [ids.tool],
    };
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: record });
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith(ids.server)
        ? record
        : { servers: [record] },
    });
  });
  await page.route("**/v1/tools?*", (route) =>
    new URL(route.request().url()).searchParams.has("cursor")
      ? route.fulfill({ status: 403, json: { detail: "denied second page" } })
      : route.fulfill({
          json: {
            tools: [{ id: ids.tool, name: "Friendly tool" }],
            nextCursor: "denied",
          },
        }),
  );
  await login(page);
  await page.goto(root + "/app/#servers");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const group = dialog.getByRole("group", { name: "提供的工具", exact: true });
  await expect(group.getByRole("alert")).toContainText("已有选择已保留");
  await expect(
    group.getByRole("checkbox", { name: ids.tool, exact: true }),
  ).toBeChecked();
  await expect(
    group.getByRole("button", { name: /全选匹配项/ }),
  ).toBeDisabled();
  await group.getByRole("button", { name: "清空", exact: true }).click();
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog).toContainText("操作成功");
  expect(writes[0].associatedTools).toEqual([]);
});

test("real v1.0.11 server association edit saves IDs and clears relationships", async ({
  page,
}) => {
  const api = await request.newContext({
    extraHTTPHeaders: { Origin: new URL(root).origin, "X-Panel-Request": "1" },
  });
  let serverId, toolId;
  try {
    expect(
      (
        await api.post(root + "/_panel/login", {
          data: { email: credentials.email, password: credentials.password },
        })
      ).ok(),
    ).toBe(true);
    const name = "association-real-" + randomUUID().slice(0, 8);
    const createdTool = await api.post(root + "/v1/tools", {
      data: {
        tool: {
          name,
          description: "Association edit verification",
          url: "https://example.com/association",
          integration_type: "REST",
          request_type: "GET",
          inputSchema: { type: "object", properties: {} },
          visibility: "private",
        },
      },
    });
    expect(createdTool.ok()).toBe(true);
    toolId = (await createdTool.json()).id;
    const createdServer = await api.post(root + "/v1/servers", {
      data: {
        server: { name, visibility: "private", associated_tools: [toolId] },
      },
    });
    expect(createdServer.ok()).toBe(true);
    serverId = (await createdServer.json()).id;
    await login(page);
    await page.goto(root + "/app/#servers");
    await page.getByLabel("Filter resources").fill(name);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const group = dialog.getByRole("group", {
      name: "提供的工具",
      exact: true,
    });
    await expect(
      group.getByRole("checkbox", { name: `${name} · ${toolId}`, exact: true }),
    ).toBeChecked();
    await group.getByRole("button", { name: "清空", exact: true }).click();
    const [cleared] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url() === root + "/v1/servers/" + serverId &&
          r.request().method() === "PUT",
      ),
      dialog.getByRole("button", { name: "保存修改", exact: true }).click(),
    ]);
    expect(cleared.ok()).toBe(true);
    expect(cleared.request().postDataJSON().associatedTools).toEqual([]);
    expect(
      (await (await api.get(root + "/v1/servers/" + serverId)).json())
        .associatedToolIds,
    ).toEqual([]);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await group.getByRole("textbox").fill(name);
    await group
      .getByRole("checkbox", { name: `${name} · ${toolId}`, exact: true })
      .check();
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url() === root + "/v1/servers/" + serverId &&
          r.request().method() === "PUT",
      ),
      dialog.getByRole("button", { name: "保存修改", exact: true }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    expect(saved.request().postDataJSON().associatedTools).toEqual([toolId]);
    expect(
      (await (await api.get(root + "/v1/servers/" + serverId)).json())
        .associatedToolIds,
    ).toEqual([toolId]);
  } finally {
    if (serverId) await api.delete(root + "/v1/servers/" + serverId);
    if (toolId) await api.delete(root + "/v1/tools/" + toolId);
    await api.post(root + "/_panel/logout");
    await api.dispose();
  }
});

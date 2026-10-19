import { test, expect, request } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
const run = randomUUID().slice(0, 8);
const serverIds = [];
let admin, teamId;

for (const width of [1440, 390]) {
  test(`governance pagination and dialogs at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    const traces = Array.from({ length: 120 }, (_, i) => ({
      trace_id: `paging-trace-${i}`,
      name: `Operation ${i}`,
      status: "ok",
      start_time: "2026-10-16T10:00:00Z",
      duration_ms: i,
    }));
    const traceRequests = [];
    let spanRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/v1/observability/spans?")) spanRequests++;
    });
    await page.route("**/v1/observability/traces?*", (route) => {
      const params = new URL(route.request().url()).searchParams;
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      traceRequests.push({ offset, limit, status: params.get("status") });
      if (params.get("status") === "error")
        return route.fulfill({
          status: 403,
          json: { detail: "pagination fixture denied" },
        });
      return route.fulfill({
        json:
          params.get("status") === "empty"
            ? []
            : traces.slice(offset, offset + limit),
      });
    });
    await page.route("**/v1/observability/traces/paging-trace-*", (route) =>
      route.fulfill({
        json: {
          ...traces[100],
          spans: Array.from({ length: 125 }, (_, i) => ({
            span_id: `span-${i}`,
            name: `Span ${i}`,
            events: [{ name: "retained event" }],
          })),
        },
      }),
    );
    await login(page);
    await page.goto(root + "/app/#observability");
    const explorer = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Trace 检索", exact: true }),
    });
    await expect(explorer.locator("tbody tr")).toHaveCount(20);
    await explorer.getByLabel("每页条数").selectOption("100");
    await expect(explorer.locator("tbody tr")).toHaveCount(100);
    await explorer.getByRole("button", { name: "下一页" }).click();
    await expect(explorer.locator("tbody tr")).toHaveCount(20);
    expect(traceRequests.at(-1)).toMatchObject({ offset: 100, limit: 101 });
    await expect(
      explorer.getByRole("button", { name: "下一页" }),
    ).toBeDisabled();
    const trigger = explorer.getByRole("button", {
      name: "paging-trace-100",
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("tbody tr")).toHaveCount(20);
    await dialog.getByRole("button", { name: "下一页" }).click();
    await expect(dialog.locator("tbody tr").first()).toContainText("Span 20");
    await dialog.getByLabel("每页条数").selectOption("100");
    await expect(dialog.locator("tbody tr")).toHaveCount(100);
    await dialog.getByRole("button", { name: "下一页" }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(25);
    await expect(dialog.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(spanRequests).toBe(0);
    await expect(dialog.locator("details pre")).toContainText("retained event");
    const bounds = await dialog.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    await dialog.screenshot({
      path: `.cache/reports/pagination-trace-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore),
    ).toBeLessThan(5);
    await expect(explorer).toContainText("第 2 页");
    await explorer.getByLabel("每页条数").selectOption("20");
    await expect(explorer).toContainText("第 1 页");
    await explorer.getByRole("button", { name: "下一页" }).click();
    await expect(explorer).toContainText("第 2 页");
    await explorer.getByLabel("状态", { exact: true }).fill("empty");
    await explorer.getByRole("button", { name: "应用筛选" }).click();
    await expect(explorer).toContainText("暂无记录");
    await expect(explorer).toContainText("第 1 页");
    await expect(
      explorer.getByRole("button", { name: "下一页" }),
    ).toBeDisabled();
    await explorer.getByLabel("状态", { exact: true }).fill("error");
    await explorer.getByRole("button", { name: "应用筛选" }).click();
    await expect(explorer.getByRole("alert")).toContainText(
      "pagination fixture denied",
    );

    const logRequests = [];
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      message: `Log ${i}`,
      action: `Audit ${i}`,
      event_type: `Security ${i}`,
      correlation_id: `correlation-${i}`,
    }));
    await page.route("**/api/logs/search", (route) => {
      const body = route.request().postDataJSON();
      logRequests.push(body);
      return route.fulfill({
        json: {
          results: rows.slice(body.offset, body.offset + body.limit),
          total: rows.length,
        },
      });
    });
    const requests = { "audit-trails": [], "security-events": [] };
    for (const kind of Object.keys(requests)) {
      await page.route(`**/api/logs/${kind}?*`, (route) => {
        const params = new URL(route.request().url()).searchParams;
        const offset = Number(params.get("offset")),
          limit = Number(params.get("limit"));
        requests[kind].push({ offset, limit });
        return route.fulfill({ json: rows.slice(offset, offset + limit) });
      });
    }
    await page.route("**/api/logs/trace/*", (route) =>
      route.fulfill({ json: { logs: [{ message: "Correlation fixture" }] } }),
    );
    await page.goto(root + "/app/#logs");
    const logs = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "日志检索", exact: true }),
    });
    await expect(logs.locator("tbody tr")).toHaveCount(20);
    await logs.getByLabel("每页条数").selectOption("100");
    await expect(logs.locator("tbody tr")).toHaveCount(100);
    await logs.getByRole("button", { name: "下一页" }).click();
    await expect(logs.locator("tbody tr").first()).toContainText("Log 100");
    expect(logRequests.at(-1)).toMatchObject({ offset: 100, limit: 100 });
    await expect(logs.getByRole("button", { name: "下一页" })).toBeDisabled();
    await logs
      .getByRole("button", { name: "correlation-100", exact: true })
      .click();
    await expect(dialog).toContainText("Correlation fixture");
    await dialog.getByRole("button", { name: "关闭" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(logs).toContainText("第 2 / 2 页");
    await logs.getByRole("button", { name: "检索", exact: true }).click();
    await expect(logs).toContainText("第 1 / 2 页");
    for (const [kind, heading] of [
      ["audit-trails", "审计轨迹"],
      ["security-events", "安全事件"],
    ]) {
      const panel = page.locator("section.panel").filter({
        has: page.getByRole("heading", { name: heading, exact: true }),
      });
      await expect(panel.locator("tbody tr")).toHaveCount(20);
      await panel.getByLabel("每页条数").selectOption("100");
      await expect(panel.locator("tbody tr")).toHaveCount(100);
      await panel.getByRole("button", { name: "下一页" }).click();
      await expect(panel.locator("tbody tr")).toHaveCount(20);
      expect(requests[kind].at(-1)).toEqual({ offset: 100, limit: 101 });
      await expect(
        panel.getByRole("button", { name: "下一页" }),
      ).toBeDisabled();
      await panel.getByRole("button", { name: "上一页" }).click();
      await expect(panel.locator("tbody tr")).toHaveCount(100);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test.beforeAll(async () => {
  admin = await request.newContext({
    extraHTTPHeaders: { Origin: new URL(root).origin, "X-Panel-Request": "1" },
  });
  expect(
    (
      await admin.post(root + "/_panel/login", {
        data: { email: credentials.email, password: credentials.password },
      })
    ).status(),
  ).toBe(200);
});
test.afterAll(async () => {
  if (!admin) return;
  for (const id of serverIds) await admin.delete(root + "/v1/servers/" + id);
  if (teamId) await admin.delete(root + "/v1/teams/" + teamId);
  await admin.post(root + "/_panel/logout");
  await admin.dispose();
});
async function login(page) {
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}

test("resource search spans real cursor pages, combines filters and resets selection", async ({
  page,
}) => {
  test.setTimeout(120000);
  const prefix = "p2-search-" + run;
  for (let i = 0; i < 105; i++) {
    const response = await admin.post(root + "/v1/servers", {
      data: {
        server: {
          name: `${prefix}-${String(i).padStart(3, "0")}`,
          description:
            i === 0 ? "Unique cross page needle " + run : "search fixture",
          visibility: i % 2 ? "public" : "private",
        },
      },
    });
    expect(response.status()).toBe(201);
    serverIds.push((await response.json()).id);
  }
  expect(
    (
      await admin.post(
        root + `/v1/servers/${serverIds[0]}/state?activate=false`,
      )
    ).status(),
  ).toBe(200);
  const team = await admin.post(root + "/v1/teams/", {
    data: { name: "p2-team-" + run, visibility: "private" },
  });
  expect(team.status()).toBe(201);
  teamId = (await team.json()).id;
  const teamServer = await admin.post(root + "/v1/servers", {
    data: {
      server: { name: "p2-team-server-" + run, visibility: "team" },
      team_id: teamId,
    },
  });
  expect(teamServer.status()).toBe(201);
  serverIds.push((await teamServer.json()).id);
  await login(page);
  await page.goto(root + "/app/#servers");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const firstPageNames = await page
    .locator("tbody .name-button")
    .allTextContents();
  const absentName = Array.from(
    { length: 105 },
    (_, i) => `${prefix}-${String(i).padStart(3, "0")}`,
  ).find((name) => !firstPageNames.includes(name));
  const visited = [];
  page.on("request", (r) => {
    if (
      r.url().includes("/v1/servers?") &&
      new URL(r.url()).searchParams.get("limit") === "100"
    )
      visited.push(r.url());
  });
  await page.getByLabel("Filter resources").fill(absentName);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText(absentName);
  expect(visited.some((url) => new URL(url).searchParams.has("cursor"))).toBe(
    true,
  );
  await page
    .getByLabel("Filter resources")
    .fill("UNIQUE CROSS PAGE NEEDLE " + run);
  await expect(page.locator("tbody")).toContainText(prefix + "-000");
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByLabel("Resource status", { exact: true })
    .selectOption("disabled");
  await expect(page.locator(".bulk-bar")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByLabel("Resource visibility", { exact: true })
    .selectOption("private");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByLabel("Resource visibility", { exact: true })
    .selectOption("public");
  await expect(
    page.getByRole("heading", { name: "没有匹配的资源", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByLabel("Filter resources").fill(prefix);
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByLabel("Next page", { exact: true }).click();
  await expect(page.locator(".table-footer")).toContainText("第 2 页");
  await page
    .getByLabel("Resource status", { exact: true })
    .selectOption("disabled");
  await expect(page.locator(".table-footer")).toContainText("第 1 页");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByLabel("Resource team", { exact: true }).selectOption(teamId);
  await expect(page.getByLabel("Team context", { exact: true })).toHaveValue(
    teamId,
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("p2-team-server-" + run);
  await page.screenshot({ path: ".cache/reports/p2-team-filter.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((node) => node.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator(".resource-grid .resource-card")).toHaveCount(1);
  expect(
    await page
      .locator(".resource-grid")
      .evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(1);
  await expect(
    page
      .locator(".resource-card")
      .getByRole("button", { name: "编辑", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".cache/reports/p2-mobile-cards.png" });
});

test("a failed search page never appears as a complete empty result or batch target", async ({
  page,
}) => {
  await page.route("**/v1/servers?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("limit") !== "100") return route.continue();
    if (params.has("cursor"))
      return route.fulfill({
        status: 503,
        json: { detail: "fixture next page unavailable" },
      });
    return route.fulfill({
      json: {
        data: [{ id: "fixture-first", name: "fixture-first" }],
        nextCursor: "fixture-next",
      },
    });
  });
  await login(page);
  await page.goto(root + "/app/#servers");
  await page.getByLabel("Filter resources").fill("fixture");
  await expect(page.getByRole("alert")).toContainText(
    "fixture next page unavailable",
  );
  await expect(
    page.getByText("查找未完成，请重试后再选择结果。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "没有匹配的资源", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".bulk-bar")).toHaveCount(0);
});

test("observability formats trace identifiers, latency and timezone with aligned metric cards", async ({
  page,
  context,
}) => {
  const traceId = "p2-trace-" + run;
  const spanId = "p2-span-" + run;
  const trace = {
    trace_id: traceId,
    name: "Fixture operation",
    start_time: "2026-10-16T10:00:00.123456",
    duration_ms: 52.519000000000005,
    status: "ok",
    http_method: "POST",
    user_email: "fixture@example.com",
  };
  await page.route("**/v1/observability/traces?*", (route) =>
    route.fulfill({ json: [trace] }),
  );
  await page.route(`**/v1/observability/traces/${traceId}`, (route) =>
    route.fulfill({
      json: {
        ...trace,
        spans: [
          {
            span_id: spanId,
            trace_id: traceId,
            name: "Fixture span name",
            start_time: trace.start_time,
            duration_ms: 0,
            status: "ok",
          },
        ],
      },
    }),
  );
  const buckets = ["2026-10-16T10:00:00+00:00", "2026-10-16T11:00:00+00:00"];
  await page.route("**/v1/observability/metrics/timeseries?*", (route) =>
    route.fulfill({
      json: {
        buckets,
        values: [12, 0],
        success_count: [10, 0],
        error_count: [2, 0],
      },
    }),
  );
  await page.route("**/v1/observability/metrics/percentiles?*", (route) =>
    route.fulfill({
      json: {
        buckets,
        p50: [10.111111111, null],
        p95: [52.519000000000005, null],
        p99: [104.001, null],
      },
    }),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page);
  await page.goto(root + "/app/#observability");
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: traceId, exact: true }) });
  await expect(row).toContainText("52.52 ms");
  await expect(row).not.toContainText("52.519000000000005");
  await expect(row.locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-16T10:00:00.123Z",
  );
  await expect(row.locator("time")).toContainText(/GMT|UTC/);
  await expect(page.locator(".governance-timezone")).toContainText("UTC");
  await row
    .getByRole("button", { name: "复制 Trace ID " + traceId, exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    traceId,
  );
  await row.getByRole("button", { name: traceId, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Fixture span name");
  await expect(page.getByRole("dialog")).toContainText("0 ms");
  await expect(page.getByRole("dialog").locator("details")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".percentile-cards")).toContainText("52.52 ms");
  await expect(page.locator(".percentile-cards")).toContainText("P99");
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();
  await page.getByText(/按时间桶查看请求数/).click();
  const counts = page
    .locator(".metric-buckets")
    .filter({ hasText: "按时间桶查看请求数" });
  await expect(counts.locator("tbody tr")).toHaveCount(2);
  await expect(
    counts.locator("tbody tr").first().locator("td").nth(1),
  ).toHaveText("12");
  await expect(
    counts.locator("tbody tr").last().locator("td").nth(1),
  ).toHaveText("0");
  await page.getByText(/按时间桶查看延迟/).click();
  const latency = page
    .locator(".metric-buckets")
    .filter({ hasText: "按时间桶查看延迟" });
  await expect(
    latency.locator("tbody tr").last().locator("td").nth(1),
  ).toHaveText("—");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".cache/reports/p2-observability.png",
    fullPage: true,
  });
});

test("system configuration permission does not grant access to strict metrics endpoints", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/v1/rbac/my/permissions*", (route) =>
    route.fulfill({ json: ["admin.system_config"] }),
  );
  await page.route("**/v1/observability/metrics/**", (route) => {
    calls++;
    return route.fulfill({ status: 403, json: { detail: "fixture denied" } });
  });
  await login(page);
  await page.goto(root + "/app/#observability");
  await expect(
    page.getByText("延迟分位数未启用，或当前账户无权查看。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".percentile-cards")).not.toContainText("0 ms");
  expect(calls).toBe(0);
  await page.goto(root + "/app/#catalog");
  await expect(
    page.getByLabel("Resource visibility", { exact: true }),
  ).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const credentials = JSON.parse(
  await readFile(".cache/test-credentials.json", "utf8"),
);
const root = process.env.E2E_API_URL || "http://127.0.0.1:3000/forge";
async function login(page) {
  await page.goto(root + "/app/");
  await page.getByLabel("邮箱地址", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "工作台" }),
  ).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`resource export progress, failure and retry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const rows = Array.from({ length: 101 }, (_, i) => ({
      id: `export-${i}`,
      name: `Export ${i}`,
      visibility: "private",
    }));
    let scanning = false,
      fail = true,
      releaseScan,
      releaseDetail;
    const scanBarrier = new Promise((resolve) => {
      releaseScan = resolve;
    });
    let detailBarrier = new Promise((resolve) => {
      releaseDetail = resolve;
    });
    await page.route("**/v1/servers?*", async (route) => {
      const q = new URL(route.request().url()).searchParams;
      const offset = Number(q.get("cursor") || 0),
        limit = Number(q.get("limit") || 25);
      if (scanning && offset === 100) await scanBarrier;
      await route.fulfill({
        json: {
          data: rows.slice(offset, offset + limit),
          total: rows.length,
          nextCursor:
            offset + limit < rows.length ? String(offset + limit) : null,
        },
      });
    });
    await page.route("**/v1/servers/export-*", async (route) => {
      const row = rows.find((r) => route.request().url().endsWith(`/${r.id}`));
      if (row.id === "export-1") {
        await detailBarrier;
        if (fail)
          return route.fulfill({
            status: 403,
            json: { detail: "fixture export denied" },
          });
      }
      await route.fulfill({ json: row });
    });
    await login(page);
    await page.goto(root + "/app/#servers");
    await page
      .getByRole("button", { name: "导入 / 导出", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    let downloads = 0;
    page.on("download", () => downloads++);
    await dialog.getByRole("button", { name: /^导出已选/ }).click();
    const progress = dialog.getByRole("progressbar", { name: "资源导出进度" });
    await expect(progress).toHaveAttribute("value", "1");
    await expect(progress).toHaveAttribute("max", "25");
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releaseDetail();
    await expect(dialog.getByRole("alert")).toContainText(
      "fixture export denied",
    );
    await expect(dialog.locator(".export-progress")).toContainText(
      "导出失败 · 已完成 1 / 25",
    );
    expect(downloads).toBe(0);
    fail = false;
    scanning = true;
    detailBarrier = new Promise((resolve) => {
      releaseDetail = resolve;
    });
    await dialog
      .getByRole("button", { name: "导出全部匹配项", exact: true })
      .click();
    await expect(dialog.locator(".export-progress")).toContainText(
      "已扫描 100 项",
    );
    await expect(progress).not.toHaveAttribute("value");
    releaseScan();
    await expect(progress).toHaveAttribute("value", "1");
    await expect(progress).toHaveAttribute("max", "101");
    const download = page.waitForEvent("download");
    releaseDetail();
    await download;
    await expect(dialog.locator(".export-progress")).toContainText("导出完成");
    await expect(progress).toHaveAttribute("value", "101");
    await expect(dialog).toContainText("已生成导出文件，包含 101 项");
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`resource workflow dialogs and cross-page tags at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const rows = Array.from({ length: 101 }, (_, i) => ({
      id: `fixture-${i}`,
      name: `Resource ${i}`,
      description: "Workflow fixture",
      is_active: true,
      visibility: "private",
      tags:
        i === 100
          ? [
              "Production",
              { id: "region-id", label: "Europe" },
              "alpha",
              "hidden-label",
              "long-tag-".repeat(16),
            ]
          : [],
    }));
    const requests = [];
    await page.route("**/v1/servers?*", (route) => {
      const q = new URL(route.request().url()).searchParams;
      const offset = Number(q.get("cursor") || 0),
        limit = Number(q.get("limit") || 25);
      requests.push({ offset, limit });
      return route.fulfill({
        json: {
          data: rows.slice(offset, offset + limit),
          total: rows.length,
          nextCursor:
            offset + limit < rows.length ? String(offset + limit) : null,
        },
      });
    });
    await login(page);
    await page.goto(root + "/app/#servers");
    await page.getByLabel("Filter resources").fill("region-id");
    const tags = page.getByLabel("标签", { exact: true });
    await expect(tags).toContainText("Production");
    await expect(tags).toContainText("Europe");
    expect(requests.some((r) => r.limit === 100 && r.offset === 100)).toBe(
      true,
    );
    await tags.getByRole("button", { name: "展开其余 2 个标签" }).click();
    await expect(tags).toContainText("hidden-label");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Filter resources").fill(" HIDDEN-LABEL ");
    await expect(tags).toContainText("Production");

    const opener = page.getByRole("button", {
      name: "导入 / 导出",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByLabel("Filter resources")).toHaveValue(
      " HIDDEN-LABEL ",
    );
    await opener.click();
    await dialog.locator("input[type=file]").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.locator("input[type=file]").setInputFiles({
      name: "servers.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify([
          { name: "new-ok", visibility: "private" },
          { name: "new-failed", visibility: "private" },
        ]),
      ),
    });
    await expect(dialog.locator("tbody tr")).toHaveCount(2);
    await dialog.getByRole("checkbox").check();
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const writes = [];
    await page.route("**/v1/servers", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const name = route.request().postDataJSON().server.name;
      writes.push(name);
      await barrier;
      return route.fulfill({
        status: name === "new-ok" ? 201 : 403,
        json:
          name === "new-ok"
            ? { id: "mock-created" }
            : { detail: "fixture import denied" },
      });
    });
    await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.locator(".batch-results")).toContainText(
      "fixture import denied",
    );
    await expect(dialog.locator(".batch-results")).toContainText("成功");
    await dialog.getByRole("button", { name: "仅重新预览失败项" }).click();
    await expect(dialog.locator("tbody tr")).toHaveCount(1);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(dialog.locator(".batch-results")).toContainText(
      "fixture import denied",
    );
    expect(writes.filter((v) => v === "new-ok")).toHaveLength(1);
    expect(writes.filter((v) => v === "new-failed")).toHaveLength(2);
    await dialog.locator(".dialog-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    for (const selector of [".dialog-header", ".dialog-footer"]) {
      const box = await dialog.locator(selector).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(845);
    }
    await dialog.screenshot({ path: `.cache/reports/workflow-${width}.png` });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(tags).toContainText("Production");
  });
}

test("history snapshots open from the toolbar and remain local", async ({
  page,
}) => {
  await login(page);
  for (const kind of ["logs", "observability"]) {
    await page.goto(root + "/app/#" + kind);
    const opener = page.getByRole("button", {
      name: "查询快照：导入 / 导出",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: "查询快照 · 导入与导出",
      exact: true,
    });
    const writes = [];
    const collect = (r) => {
      if (r.method() !== "GET") writes.push(r.url());
    };
    page.on("request", collect);
    await dialog.locator("input[type=file]").setInputFiles({
      name: "snapshot.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "contextforge-panel-history",
          version: 1,
          resource: kind,
          data: { logs: [{ message: "local-only-fixture" }] },
        }),
      ),
    });
    await expect(dialog).toContainText("本地快照（未写入后端）");
    await expect(dialog).toContainText("local-only-fixture");
    expect(writes).toEqual([]);
    page.off("request", collect);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

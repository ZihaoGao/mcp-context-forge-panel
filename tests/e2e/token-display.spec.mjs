import { test, expect } from "@playwright/test";

const appUrl = process.env.E2E_URL || "http://127.0.0.1:3000/forge/app/";
const prefix = new URL(appUrl).pathname
  .replace(/\/app\/?$/, "")
  .replace(/\/$/, "");

const tokenId = "fake-token-revoked";
const fallbackTokenId = "fake-token-fallback-one";
const repeatedFallbackTokenId = "fake-token-fallback-two";
const unscopedTokenId = "fake-token-unscoped";
const loadedTeamId = "fake-team-loaded";
const deniedTeamId = "fake-team-denied";
const knownServerId = "fake-server-known";
const missingServerId = "fake-server-missing";

const records = [
  {
    id: tokenId,
    name: "revoked-list-name",
    description: "list description",
    is_active: true,
    is_revoked: true,
    revoked_at: "2026-10-19T10:00:00Z",
    revoked_by: "fixture-admin",
    revocation_reason: "fixture revocation reason",
    team_id: loadedTeamId,
    server_id: knownServerId,
  },
  {
    id: fallbackTokenId,
    name: "fallback-token-one",
    is_active: true,
    is_revoked: false,
    team_id: deniedTeamId,
    server_id: missingServerId,
  },
  {
    id: repeatedFallbackTokenId,
    name: "fallback-token-two",
    is_active: true,
    is_revoked: false,
    team_id: deniedTeamId,
    server_id: missingServerId,
  },
  {
    id: unscopedTokenId,
    name: "unscoped-token",
    is_active: true,
    is_revoked: false,
  },
];

const readOperation = (permission) => ({
  responses: { 200: { description: "OK" } },
  "x-panel-permission": permission,
});

const contract = {
  openapi: "3.1.0",
  info: { title: "Token display fixture", version: "1.0.11" },
  paths: {
    "/v1/tokens": { get: readOperation("tokens.read") },
    "/v1/tokens/{token_id}": {
      get: {
        ...readOperation("tokens.read"),
        parameters: [
          {
            name: "token_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
    },
    "/v1/teams/{team_id}": {
      get: {
        ...readOperation("teams.read"),
        parameters: [
          {
            name: "team_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
    },
    "/v1/servers/{server_id}": {
      get: {
        ...readOperation("servers.read"),
        parameters: [
          {
            name: "server_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
    },
  },
};

test("API key status and scope stay clear across table, grid, details, and languages", async ({
  page,
}) => {
  let scopeReadAllowed = true;
  const requests = {
    loadedTeam: 0,
    deniedTeam: 0,
    knownServer: 0,
    missingServer: 0,
  };

  await page.addInitScript(() => {
    if (!localStorage.getItem("panel-language"))
      localStorage.setItem("panel-language", "zh");
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith(`${prefix}/`)) return route.continue();
    const path = url.pathname.slice(prefix.length);
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/v1/auth/email/me")
      return json({
        id: "fake-user",
        email: "token-display@example.test",
        full_name: "Token Display Fixture",
        is_admin: false,
      });
    if (path === "/_panel/session") return json({ mode: "interactive" });
    if (path === "/v1/rbac/my/permissions")
      return json(
        scopeReadAllowed
          ? ["tokens.*", "teams.read", "servers.read"]
          : ["tokens.*"],
      );
    if (path === "/v1/teams/")
      return json({
        teams: [{ id: loadedTeamId, name: "Loaded Team Alpha" }],
      });
    if (path === "/app/contract.json" || path === "/openapi.json")
      return json(contract);
    if (path === "/v1/tokens" && request.method() === "GET")
      return json({ tokens: records, total: records.length });
    if (path === `/v1/tokens/${tokenId}` && request.method() === "GET")
      return json({
        ...records[0],
        name: "detail-name-from-get",
        description: "fresh detail description",
        is_active: true,
        is_revoked: false,
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
      });
    if (path === `/v1/tokens/${fallbackTokenId}` && request.method() === "GET")
      return json(records[1]);
    if (
      path === `/v1/tokens/${repeatedFallbackTokenId}` &&
      request.method() === "GET"
    )
      return json(records[2]);
    if (path === `/v1/tokens/${unscopedTokenId}` && request.method() === "GET")
      return json(records[3]);
    if (path === `/v1/teams/${loadedTeamId}`) {
      requests.loadedTeam++;
      return json({ id: loadedTeamId, name: "Unexpected extra team read" });
    }
    if (path === `/v1/teams/${deniedTeamId}`) {
      requests.deniedTeam++;
      return json({ detail: "Forbidden" }, 403);
    }
    if (path === `/v1/servers/${knownServerId}`) {
      requests.knownServer++;
      return json({ id: knownServerId, name: "Server Zebra" });
    }
    if (path === `/v1/servers/${missingServerId}`) {
      requests.missingServer++;
      return json({ detail: "Not found" }, 404);
    }
    return route.continue();
  });

  await page.goto(new URL("#tokens", appUrl).href);
  await expect(
    page.getByRole("heading", { level: 1, name: "我的 API Key" }),
  ).toBeVisible();

  const revokedRow = page
    .locator("table tbody tr")
    .filter({ hasText: "revoked-list-name" });
  const revokedBadge = revokedRow.getByText("已撤销", { exact: true });
  await expect(revokedBadge).toBeVisible();
  await expect(revokedBadge).toHaveClass(/danger/);
  await expect(revokedRow.locator(".token-scope")).toContainText(
    "团队: Loaded Team Alpha",
  );
  await expect(revokedRow.locator(".token-scope")).toContainText(
    "服务器: Server Zebra",
  );

  await page.getByLabel("Resource status").selectOption("enabled");
  await expect(
    page.locator("table tbody tr").filter({ hasText: "revoked-list-name" }),
  ).toHaveCount(0);
  await page.getByLabel("Resource status").selectOption("");

  await page.getByRole("button", { name: "Toggle layout" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const revokedCard = page
    .locator(".resource-card")
    .filter({ hasText: "revoked-list-name" });
  const cardBadge = revokedCard.getByText("已撤销", { exact: true });
  await expect(cardBadge).toBeVisible();
  await expect(cardBadge).toHaveClass(/danger/);
  await expect(revokedCard.locator(".token-scope")).toContainText(
    "团队: Loaded Team Alpha",
  );
  await expect(revokedCard.locator(".token-scope")).toContainText(
    "服务器: Server Zebra",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const noScopeCard = page
    .locator(".resource-card")
    .filter({ hasText: "unscoped-token" });
  await expect(noScopeCard.locator(".token-scope")).toContainText("未指定团队");
  await expect(noScopeCard.locator(".token-scope")).toContainText(
    "未限定服务器",
  );

  await revokedCard.getByRole("button", { name: "查看详情" }).click();
  const detail = page.locator("dialog");
  const tokenDetails = detail.locator(".token-details");
  await expect(tokenDetails.locator("h3")).toHaveText("detail-name-from-get");
  await expect(tokenDetails.getByText("已撤销", { exact: true })).toHaveClass(
    /danger/,
  );
  await expect(tokenDetails).toContainText("fixture-admin");
  await expect(tokenDetails).toContainText("fixture revocation reason");
  await expect(tokenDetails.locator(".token-scope")).toContainText(
    "团队: Loaded Team Alpha",
  );
  await expect(tokenDetails.locator(".token-scope")).toContainText(
    "服务器: Server Zebra",
  );
  await detail
    .getByText("查看原始数据（敏感字段已隐藏）", { exact: true })
    .click();
  const raw = detail.locator("pre");
  await expect(raw).toContainText('"is_revoked": false');
  await expect(raw).toContainText('"revoked_by": null');
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByLabel("Change language").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "My API keys" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".resource-card")
      .filter({ hasText: "revoked-list-name" })
      .getByText("Revoked", { exact: true }),
  ).toBeVisible();
  const fallbackCard = page
    .locator(".resource-card")
    .filter({ hasText: "fallback-token-one" });
  const fallbackScope = fallbackCard.locator(".token-scope");
  await expect(fallbackScope).toContainText("Team: Name unavailable");
  await expect(fallbackScope).toContainText("Server: Name unavailable");
  await expect(fallbackScope.locator(`[title$="${deniedTeamId}"]`)).toHaveText(
    "Team: Name unavailable",
  );
  await expect(
    fallbackScope.locator(`[title$="${missingServerId}"]`),
  ).toHaveText("Server: Name unavailable");
  await expect(
    page
      .locator(".resource-card")
      .filter({ hasText: "fallback-token-two" })
      .locator(".token-scope"),
  ).toContainText("Team: Name unavailable");
  expect(requests.loadedTeam).toBe(0);
  expect(requests.deniedTeam).toBe(1);
  expect(requests.knownServer).toBe(1);
  expect(requests.missingServer).toBe(1);

  await fallbackCard.getByRole("button", { name: "Details" }).click();
  const fallbackDetails = page.locator("dialog .token-details");
  await expect(fallbackDetails.locator(".token-scope")).toContainText(
    "Team: Name unavailable",
  );
  await expect(fallbackDetails.locator(".token-scope")).toContainText(
    "Server: Name unavailable",
  );
  await expect(
    fallbackDetails.locator(`.token-scope [title$="${deniedTeamId}"]`),
  ).toHaveText("Team: Name unavailable");
  await expect(
    fallbackDetails.locator(`.token-scope [title$="${missingServerId}"]`),
  ).toHaveText("Server: Name unavailable");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  scopeReadAllowed = false;
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "My API keys" }),
  ).toBeVisible();
  const noPermissionCard = page
    .locator("table tbody tr")
    .filter({ hasText: "fallback-token-one" });
  await expect(noPermissionCard.locator(".token-scope")).toContainText(
    "Team: Name unavailable",
  );
  await expect(noPermissionCard.locator(".token-scope")).toContainText(
    "Server: Name unavailable",
  );
  expect(requests.deniedTeam).toBe(1);
  expect(requests.missingServer).toBe(1);
});

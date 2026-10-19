import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resourceActionName } from "../../apps/web/src/resource-actions.mjs";
import {
  readField,
  portableRecord,
  validateValue,
} from "../../apps/web/src/resource-model.mjs";
import { canonicalField } from "../../apps/web/src/resource-copy.mjs";
import {
  loadAssociationOptions,
  filterAssociationOptions,
} from "../../apps/web/src/association-model.mjs";

const spec = JSON.parse(
  fs.readFileSync(
    new URL("../../contracts/contextforge/web-contract.json", import.meta.url),
  ),
);

test("team menu labels distinguish the contract methods and nested targets in both languages", () => {
  const cases = [
    ["GET", "/members", "查看成员", "View members"],
    ["POST", "/members", "添加成员", "Add member"],
    ["PUT", "/members/{user_email}", "修改成员角色", "Change member role"],
    ["DELETE", "/members/{user_email}", "移除成员", "Remove member"],
    ["GET", "/invitations", "查看邀请", "View invitations"],
    ["POST", "/invitations", "发送团队邀请", "Send team invitation"],
    ["DELETE", "/leave", "退出团队", "Leave team"],
    ["POST", "/join", "申请加入团队", "Request to join team"],
    ["GET", "/join-requests", "查看加入申请", "View join requests"],
    [
      "POST",
      "/join-requests/{request_id}/approve",
      "批准加入申请",
      "Approve join request",
    ],
    [
      "DELETE",
      "/join-requests/{request_id}",
      "拒绝加入申请",
      "Reject join request",
    ],
    ["DELETE", "", "删除团队", "Delete team"],
  ];
  for (const [method, suffix, zh, en] of cases) {
    const path = "/v1/teams/{team_id}" + suffix;
    assert.ok(
      spec.paths[path]?.[method.toLowerCase()],
      `${method} ${path} exists in v1.0.11`,
    );
    assert.equal(resourceActionName({ method, path }, "团队"), zh);
    assert.equal(
      resourceActionName({ method, path: path + "/" }, "team", true),
      en,
    );
  }
  assert.equal(new Set(cases.map((row) => row[2])).size, cases.length);
  assert.equal(new Set(cases.map((row) => row[3])).size, cases.length);
  assert.match(
    resourceActionName(
      { method: "DELETE", path: "/v1/teams/{id}/unknown/{id}" },
      "团队",
    ),
    /^执行操作 · DELETE/,
  );
});

test("server create and update association aliases read IDs, retain empty arrays and export IDs", () => {
  const record = {
    name: "server",
    associatedTools: ["display name"],
    associatedToolIds: ["tool-uuid"],
    associatedResources: ["resource-uuid"],
    associatedPrompts: ["prompt-uuid"],
    associatedA2aAgents: ["agent-uuid"],
  };
  const expected = {
    associated_tools: ["tool-uuid"],
    associated_resources: ["resource-uuid"],
    associated_prompts: ["prompt-uuid"],
    associated_a2a_agents: ["agent-uuid"],
  };
  for (const schemaName of ["ServerCreate", "ServerUpdate"]) {
    for (const key of Object.keys(
      spec.components.schemas[schemaName].properties,
    ).filter((key) => key.startsWith("associated"))) {
      assert.deepEqual(readField(record, key), expected[canonicalField(key)]);
      assert.deepEqual(
        readField({ ...record, associatedToolIds: [] }, key),
        canonicalField(key) === "associated_tools"
          ? []
          : expected[canonicalField(key)],
      );
    }
  }
  assert.deepEqual(
    portableRecord(record, { $ref: "#/components/schemas/ServerUpdate" }, spec)
      .associatedTools,
    ["tool-uuid"],
  );
  assert.throws(
    () => readField({ associatedTools: ["display name"] }, "associatedTools"),
    /Missing associated tool IDs/,
  );
  assert.deepEqual(
    validateValue(
      { associatedTools: [] },
      { $ref: "#/components/schemas/ServerUpdate" },
      spec,
    ),
    [],
  );
  assert.ok(
    validateValue(
      { associatedTools: "name" },
      { $ref: "#/components/schemas/ServerUpdate" },
      spec,
      "",
      true,
    ).every((message) => !/[\u3400-\u9fff]/.test(message)),
  );
});

test("association catalogs follow only declared pagination and reject incomplete scans", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({
    id: `tool-${i}`,
    name: `Tool ${i}`,
  }));
  const urls = [];
  const rows = await loadAssociationOptions(
    "associatedTools",
    spec,
    async (url) => {
      urls.push(url);
      const params = new URL(url, "http://local").searchParams;
      assert.equal(params.has("offset"), false);
      return params.has("cursor")
        ? { tools: [{ id: "tool-100", name: "Last tool" }], nextCursor: null }
        : { tools: first, nextCursor: "next" };
    },
  );
  assert.equal(rows.length, 101);
  assert.equal(urls.length, 2);
  assert.equal(
    new URL(urls[1], "http://local").searchParams.get("cursor"),
    "next",
  );
  await assert.rejects(
    loadAssociationOptions("associated_tools", spec, async () => ({
      tools: first,
      nextCursor: "repeat",
    })),
    /Pagination made no progress|Repeated pagination cursor/,
  );
  await assert.rejects(
    loadAssociationOptions("associated_tools", spec, async (url) => {
      if (url.includes("cursor=")) throw new Error("denied page");
      return { tools: first, nextCursor: "next" };
    }),
    /denied page/,
  );
  await assert.rejects(
    loadAssociationOptions("associated_tools", spec, async (url) => ({
      tools: first,
      nextCursor: url.includes("cursor=") ? null : "last",
    })),
    /Pagination made no progress/,
  );
  const options = [
    {
      id: "a",
      name: "Duplicate",
      description: "Find Me",
      gatewaySlug: "gateway",
    },
    { id: "b", name: "Duplicate" },
  ];
  assert.deepEqual(
    filterAssociationOptions(
      options,
      ["a", "missing"],
      " find me ",
      "selected",
    ).map((v) => v.id),
    ["a"],
  );
  assert.deepEqual(
    filterAssociationOptions(options, ["a"], "duplicate", "unselected").map(
      (v) => v.id,
    ),
    ["b"],
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classify,
  operations,
  resolveSchema,
  initialValue,
  runBatch,
  mergeContracts,
} from "../../packages/api-client/contract.mjs";
const spec = JSON.parse(
  await readFile("contracts/contextforge/openapi.json", "utf8"),
);
test("feature-gated operations remain visible but unavailable when absent from live schema", () => {
  const merged = mergeContracts(
    {
      paths: { "/optional": { post: { summary: "Optional" } } },
      components: { schemas: { A: { type: "object" } } },
    },
    {
      paths: { "/live": { get: { summary: "Live" } } },
      components: { schemas: { B: { type: "string" } } },
    },
  );
  assert.equal(merged.paths["/optional"].post["x-panel-available"], false);
  assert.equal(merged.paths["/live"].get["x-panel-available"], true);
  assert.ok(merged.components.schemas.A);
  assert.ok(merged.components.schemas.B);
});
test("source-backed raw Request handlers get request-body forms and RPC defaults", () => {
  const contract = mergeContracts(
    {
      paths: {
        "/rpc": { post: { summary: "RPC" } },
        "/v1/admin/servers": { post: { summary: "Admin form" } },
        "/empty-post": { post: { summary: "No body" } },
      },
      components: { schemas: {} },
    },
    null,
  );
  const rpc = contract.paths["/rpc"].post;
  const rpcBody = rpc.requestBody.content["application/json"].schema;
  assert.deepEqual(rpcBody.required, ["jsonrpc", "method"]);
  assert.equal(rpc["x-panel-all-fields"], true);
  assert.equal(rpc["x-panel-request-body-completeness"], "verified-fields");
  assert.equal(rpcBody.properties.id.default, "1");
  assert.deepEqual(rpcBody.properties.params.default, {});
  assert.deepEqual(
    initialValue(
      rpc.requestBody.content["application/json"].schema,
      contract,
      false,
    ),
    { jsonrpc: "2.0", id: "1", method: "", params: {} },
  );
  assert.equal(
    contract.paths["/v1/admin/servers"].post.requestBody.content[
      "application/x-www-form-urlencoded"
    ].schema.additionalProperties,
    true,
  );
  assert.equal(
    contract.paths["/v1/admin/servers"].post[
      "x-panel-request-body-completeness"
    ],
    "opaque",
  );
  assert.equal(contract.paths["/empty-post"].post.requestBody, undefined);
});
test("live contract merging retains supplemented Request bodies for live routes", () => {
  const merged = mergeContracts(
    {
      paths: { "/rpc": { post: { summary: "RPC" } } },
      components: { schemas: {} },
    },
    {
      paths: { "/rpc": { post: { summary: "Live RPC" } } },
      components: { schemas: {} },
    },
  );
  const operation = merged.paths["/rpc"].post;
  assert.equal(operation["x-panel-available"], true);
  assert.ok(operation.requestBody.content["application/json"]);
  assert.equal(operation["x-panel-all-fields"], true);
});
test("verified raw Request schemas match v1.0.11 accepted fields and defaults", () => {
  const contract = mergeContracts(spec, null);
  const schemaAt = (path) =>
    contract.paths[path].post.requestBody.content["application/json"].schema;

  for (const path of ["/v1/protocol/initialize", "/initialize"]) {
    const initialize = schemaAt(path);
    assert.deepEqual(initialize.required, ["protocolVersion"]);
    assert.equal(initialize.properties.method, undefined);
    assert.equal(initialize.properties.jsonrpc, undefined);
    assert.deepEqual(initialize.properties.capabilities.default, {});
  }
  assert.deepEqual(schemaAt("/logging/setLevel").properties.level.enum, [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ]);

  const generate = schemaAt("/v1/admin/tools/generate-schemas-from-openapi");
  assert.equal(generate.properties.openapi_url.default, "");
  assert.equal(generate.properties.openapi_url.format, undefined);

  const selectiveExport = schemaAt("/v1/admin/export/selective");
  assert.equal(selectiveExport.required, undefined);
  assert.deepEqual(selectiveExport.properties.entity_selections.default, {});

  const importConfiguration = schemaAt("/v1/admin/import/configuration");
  assert.deepEqual(importConfiguration.required, ["import_data"]);
  assert.deepEqual(importConfiguration.properties.conflict_strategy.enum, [
    "skip",
    "update",
    "rename",
    "fail",
  ]);

  const llmTest = schemaAt("/v1/admin/llm/test");
  assert.equal(llmTest.required, undefined);
  assert.equal(llmTest.properties.test_type.default, "models");

  const a2aTest = contract.paths["/v1/admin/a2a/{agent_id}/test"].post;
  assert.equal(a2aTest.requestBody.required, true);
  assert.equal(
    a2aTest.requestBody.content["application/json"].schema.required,
    undefined,
  );

  const appBridge =
    contract.paths["/appbridge/sessions/{app_session_id}/rpc"].post;
  const appBridgeSchema =
    appBridge.requestBody.content["application/json"].schema;
  assert.ok(appBridgeSchema.properties.mcpSessionId);
  assert.ok(appBridgeSchema.properties.serverId);
  assert.ok(
    appBridge.parameters.some(
      (parameter) =>
        parameter.in === "header" &&
        parameter.name === "x-contextforge-server-id",
    ),
  );
});
test("all canonical operations have a classification and no deprecated operation is executable", () => {
  const all = operations(spec);
  assert.ok(all.length > 300);
  for (const op of all) {
    assert.ok(
      ["business", "protocol", "excluded"].includes(op.classification.kind),
    );
    if (op.deprecated) assert.equal(op.classification.kind, "excluded");
  }
  assert.equal(classify("/v1/rbac/roles", {}).kind, "business");
  assert.equal(classify("/_internal/mcp/rpc", {}).kind, "excluded");
  assert.equal(classify("/oauth/callback", {}).kind, "protocol");
});
test("resolves nullable references and constructs required request values", () => {
  const s = resolveSchema(
    {
      anyOf: [
        { $ref: "#/components/schemas/TokenScopeRequest" },
        { type: "null" },
      ],
    },
    spec,
  );
  assert.ok(s.properties.server_id);
  const initial = initialValue(
    { $ref: "#/components/schemas/TokenCreateRequest" },
    spec,
  );
  assert.deepEqual(initial, { name: "" });
});
test("batch limits concurrency, preserves partial failure, and retries only failed items", async () => {
  let running = 0,
    max = 0;
  const calls = [];
  const result = await runBatch(
    [1, 2, 3, 4, 5],
    async (item) => {
      calls.push(item);
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      if (item === 3) throw new Error("denied");
    },
    { concurrency: 2 },
  );
  assert.equal(max, 2);
  assert.equal(result.filter((r) => r.ok).length, 4);
  assert.equal(result.find((r) => !r.ok).error, "denied");
  const retries = [];
  await runBatch(
    result.filter((r) => !r.ok).map((r) => r.item),
    async (item) => retries.push(item),
  );
  assert.deepEqual(retries, [3]);
});
test("cancelled batch never starts new requests", async () => {
  const control = new AbortController();
  let count = 0;
  await runBatch(
    [1, 2, 3],
    async () => {
      count++;
      control.abort();
    },
    { concurrency: 1, signal: control.signal },
  );
  assert.equal(count, 1);
});

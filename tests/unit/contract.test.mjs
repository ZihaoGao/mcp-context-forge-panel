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

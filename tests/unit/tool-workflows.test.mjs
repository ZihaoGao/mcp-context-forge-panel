import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  restToolExamples,
  restToolProblems,
  isLocalRestTool,
} from "../../apps/web/src/tool-workflows.mjs";
import { toolWriteBody } from "../../apps/web/src/tool-auth.mjs";
import {
  inputValidator,
  inputDefaults,
} from "../../apps/web/src/tool-test.mjs";
import {
  resourceBody,
  portableRecord,
  validateValue,
  safeDisplay,
} from "../../apps/web/src/resource-model.mjs";
import {
  matchesResource,
  loadResourcePages,
  listPath,
} from "../../apps/web/src/list-model.mjs";

const spec = JSON.parse(
  fs.readFileSync(
    new URL("../../contracts/contextforge/web-contract.json", import.meta.url),
  ),
);
const { root, schema, wrapper } = resourceBody(
  spec.paths["/v1/tools"].post.requestBody.content["application/json"].schema,
  spec,
);
const restToolTemplate = restToolExamples[1].tool;

test("REST creation and import reject array root inputs without restricting array outputs or fields", () => {
  for (const key of ["inputSchema", "input_schema"]) {
    const row = { ...restToolTemplate };
    delete row.inputSchema;
    row[key] = { type: "array", items: { type: "object" } };
    assert.ok(
      restToolProblems(row).some((problem) => /inputSchema/.test(problem)),
    );
  }
  assert.deepEqual(restToolProblems(restToolExamples[0].tool), []);
  assert.deepEqual(restToolProblems(restToolTemplate), []);
});

test("REST examples are valid ToolCreate records with valid invocation arguments", () => {
  assert.deepEqual(
    restToolExamples.map((example) => example.id),
    ["search_products", "create_order", "update_order_status"],
  );

  for (const example of restToolExamples) {
    assert.deepEqual(
      validateValue(
        wrapper ? { [wrapper]: example.tool } : example.tool,
        root,
        spec,
      ),
      [],
      `${example.id} must satisfy the /v1/tools ToolCreate schema`,
    );
    assert.deepEqual(restToolProblems(example.tool), [], example.id);
    assert.deepEqual(
      inputValidator(example.tool.inputSchema).errors(example.arguments),
      [],
      `${example.id} arguments must satisfy inputSchema`,
    );
  }

  const update = restToolExamples.find(
    (example) => example.id === "update_order_status",
  );
  const noteSchema = update.tool.inputSchema.properties.note;
  assert.equal(update.tool.inputSchema.required.includes("note"), false);
  assert.equal(noteSchema.default, undefined);
  const omittedNote = { ...update.arguments };
  delete omittedNote.note;
  assert.deepEqual(
    inputValidator(update.tool.inputSchema).errors(omittedNote),
    [],
  );
  assert.equal(
    Object.hasOwn(inputDefaults(update.tool.inputSchema), "note"),
    false,
  );
});

test("REST example credentials map to backend auth fields and stay out of portable exports", () => {
  for (const example of restToolExamples) {
    const { tool } = example;
    const written = toolWriteBody(tool);
    const auth = tool.auth;
    assert.equal(written.auth_type, auth.authType, example.id);
    assert.equal(Object.hasOwn(written, "auth"), false, example.id);

    if (auth.authType === "authheaders") {
      const expectedHeaders = auth.authHeaders?.length
        ? auth.authHeaders.map(({ key, value }) => ({ key: key.trim(), value }))
        : [{ key: auth.authHeaderKey.trim(), value: auth.authHeaderValue }];
      assert.deepEqual(written.auth_headers, expectedHeaders, example.id);
    } else if (auth.authType === "bearer") {
      assert.equal(written.auth_token, auth.token, example.id);
    } else if (auth.authType === "basic") {
      assert.equal(written.auth_username, auth.username, example.id);
      assert.equal(written.auth_password, auth.password, example.id);
    }

    const portable = portableRecord(tool, schema, spec);
    const serialized = JSON.stringify(portable);
    assert.equal(Object.hasOwn(portable, "auth"), false, example.id);
    for (const key of [
      "auth_headers",
      "auth_token",
      "auth_username",
      "auth_password",
    ])
      assert.equal(
        Object.hasOwn(portable, key),
        false,
        `${example.id}: ${key}`,
      );
    for (const value of [
      auth.authHeaderValue,
      auth.authHeaders?.[0]?.value,
      auth.token,
      auth.username,
      auth.password,
    ]) {
      if (value) assert.equal(serialized.includes(value), false, example.id);
    }
  }
});

test("REST example remains a valid creation payload with a meaningful HTTP input", () => {
  assert.deepEqual(
    validateValue(
      wrapper ? { [wrapper]: restToolTemplate } : restToolTemplate,
      root,
      spec,
    ),
    [],
  );
  assert.deepEqual(restToolProblems(restToolTemplate), []);
  assert.equal(restToolTemplate.inputSchema.required[0], "customer_id");
  assert.equal(restToolTemplate.integration_type, "REST");
  assert.equal(restToolTemplate.request_type, "POST");
});

test("service-managed exports are rejected even when their fields satisfy the create schema", () => {
  const rows = [
    { ...restToolTemplate, integration_type: "MCP", gateway_id: "source" },
    { ...restToolTemplate, integration_type: "A2A", allow_auto: true },
    { ...restToolTemplate, gateway_id: "source" },
    {
      ...restToolTemplate,
      integration_type: undefined,
      integrationType: "MCP",
      gatewayId: "source",
    },
    { ...restToolTemplate, grpcServiceId: "grpc-source" },
  ];
  for (const row of rows) {
    assert.equal(isLocalRestTool(row), false);
    assert.ok(restToolProblems(row).some((v) => v.includes("本地 REST")));
  }
  const exported = portableRecord(rows[0], schema, spec);
  assert.equal(exported.integration_type, "MCP");
  assert.ok(restToolProblems(exported).length);
  assert.deepEqual(
    restToolProblems({ ...restToolTemplate, gateway_id: null }),
    [],
  );
});

test("REST preview rejects transport methods and malformed endpoints without throwing", () => {
  for (const url of [null, 7, {}, " "]) {
    assert.ok(
      restToolProblems({ ...restToolTemplate, url }).some((v) =>
        v.includes("URL"),
      ),
    );
  }
  for (const request_type of ["SSE", "STREAMABLEHTTP", "STDIO"]) {
    assert.ok(
      restToolProblems({ ...restToolTemplate, request_type }, true).some((v) =>
        v.includes("HTTP"),
      ),
    );
  }
  assert.deepEqual(
    restToolProblems({ name: "legacy", url: "https://api.example.com/lookup" }),
    [],
  );
});

test("gateway filters match exact IDs across field aliases and compose with other filters", () => {
  const row = {
    id: "tool-1",
    name: "Order lookup",
    gatewayId: "upstream-1",
    visibility: "private",
    enabled: true,
  };
  assert.equal(matchesResource(row, { gateway: "upstream-1" }), true);
  assert.equal(
    matchesResource({ ...row, gateway_id: "other" }, { gateway: "upstream-1" }),
    false,
  );
  assert.equal(matchesResource(row, { gateway: "upstream" }), false);
  assert.equal(
    matchesResource(row, {
      gateway: "upstream-1",
      search: " ORDER ",
      state: "enabled",
      visibility: "private",
    }),
    true,
  );
  assert.equal(
    matchesResource(row, { gateway: "upstream-1", state: "disabled" }),
    false,
  );
  assert.equal(
    matchesResource(
      { id: "local", name: "upstream-1" },
      { gateway: "upstream-1" },
    ),
    false,
  );
});

test("gateway-scoped scans apply the declared backend filter to every page", async () => {
  const operation = { ...spec.paths["/v1/tools"].get, path: "/v1/tools" };
  const paths = [];
  const rows = await loadResourcePages(
    operation,
    async (path) => {
      paths.push(path);
      const query = new URL(path, "https://example.com").searchParams;
      assert.equal(query.get("gateway_id"), "gateway / 1");
      return query.get("cursor")
        ? { tools: [{ id: "two" }], total: 2 }
        : { tools: [{ id: "one" }], total: 2, nextCursor: "second" };
    },
    { gateway: "gateway / 1" },
  );
  assert.equal(paths.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(
    listPath({ path: "/v1/tools", parameters: [] }, { gateway: "one" }),
    "/v1/tools",
  );
});

test("REST definitions and inventory displays exclude the entire authentication object", () => {
  const full = {
    ...restToolTemplate,
    auth: {
      auth_type: "basic",
      username: "synthetic-auth-user",
      password: "synthetic-auth-password",
    },
    username: "public-metadata",
  };
  const portable = portableRecord(full, schema, spec);
  assert.equal(portable.auth, undefined);
  assert.equal(safeDisplay(full).auth, "••••••");
  assert.equal(safeDisplay(full).username, "public-metadata");
  assert.equal(JSON.stringify(portable).includes("synthetic-auth-user"), false);
  assert.equal(
    JSON.stringify(safeDisplay(full)).includes("synthetic-auth-user"),
    false,
  );
});

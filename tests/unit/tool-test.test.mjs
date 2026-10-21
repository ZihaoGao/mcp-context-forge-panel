import test from "node:test";
import assert from "node:assert/strict";
import {
  toolSchema,
  inputSchema,
  inputDefaults,
  inputValidator,
  inputCompatibilityError,
  toolCall,
  toolCallId,
  toolCallError,
} from "../../apps/web/src/tool-test.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    count: { type: "integer", minimum: 1, default: 2 },
    mode: { type: "integer", enum: [1, 2] },
    permissions: { type: "string" },
    visibility: { type: "string" },
    auth_type: { type: "string" },
    filter: { $ref: "#/$defs/filter" },
    values: { type: "array", items: { type: "number" }, minItems: 1 },
    nullable: { type: ["string", "null"] },
  },
  required: ["count", "mode", "filter"],
  $defs: {
    filter: {
      type: "object",
      properties: { enabled: { type: "boolean", default: false } },
      required: ["enabled"],
    },
  },
};

test("tool input compatibility rejects root type conflicts including refs and alternatives", () => {
  const array = { type: "array", items: { type: "string" } };
  for (const input of [
    array,
    { type: ["array", "null"] },
    { type: "string" },
    { $ref: "#/$defs/args", $defs: { args: array } },
    { allOf: [{ $ref: "#/$defs/args" }], $defs: { args: array } },
    { anyOf: [array, { type: "null" }] },
    { oneOf: [array, { type: "number" }] },
    { type: "object", $ref: "#/$defs/args", $defs: { args: array } },
  ]) {
    assert.match(inputCompatibilityError(input), /顶层参数为对象/);
    assert.match(inputCompatibilityError(input, true), /top-level object/);
  }
});

test("tool input compatibility preserves object arrays, unions and unconstrained schemas", () => {
  for (const input of [
    undefined,
    {},
    schema,
    { type: "object", properties: { items: { type: "array" } } },
    { type: ["array", "object"] },
    { anyOf: [{ type: "array" }, { type: "object" }] },
    {
      oneOf: [{ type: "array" }, { properties: { items: { type: "array" } } }],
    },
    { $ref: "#/$defs/args", $defs: { args: { type: "object" } } },
    { $ref: "#/$defs/a~1b~0", $defs: { "a/b~": { type: "object" } } },
    { $ref: "#/$defs/loop", $defs: { loop: { $ref: "#/$defs/loop" } } },
    { $ref: "https://example.test/schema" },
  ])
    assert.equal(inputCompatibilityError(input), "");
});

test("input compatibility follows legacy ref sibling semantics without ignoring modern constraints", () => {
  const referencedObject = {
    $ref: "#/definitions/args",
    type: "array",
    allOf: [{ type: "string" }],
    definitions: { args: { type: "object" } },
  };
  for (const draft of ["04", "06", "07"]) {
    const input = {
      ...referencedObject,
      $schema: `http://json-schema.org/draft-${draft}/schema#`,
    };
    assert.equal(inputCompatibilityError(input), "");
    assert.ok(
      inputCompatibilityError({
        ...input,
        type: "object",
        definitions: { args: { type: "array" } },
      }),
    );
  }
  assert.ok(inputCompatibilityError(referencedObject));
});

test("tool schemas use local definitions and defaults without resource heuristics", () => {
  assert.equal(toolSchema({ input_schema: schema }), schema);
  assert.deepEqual(
    inputSchema(schema.properties.filter, schema),
    schema.$defs.filter,
  );
  assert.deepEqual(inputDefaults(schema), {
    count: 2,
    filter: { enabled: false },
  });
  assert.throws(() => toolSchema({}), /inputSchema/);
  assert.throws(() => toolSchema({ inputSchema: "{}" }), /inputSchema/);
  const validate = inputValidator(schema);
  assert.equal(validate.warning, "");
  assert.deepEqual(
    validate.errors({
      count: 1,
      mode: 2,
      filter: { enabled: false },
      permissions: "free",
      visibility: "custom",
      auth_type: "custom",
      nullable: null,
    }),
    [],
  );
});

test("tool input validation checks nested types, numeric enums, refs, arrays, unions and extra fields", () => {
  const validate = inputValidator(schema);
  for (const args of [
    {},
    { count: 0, mode: 1, filter: { enabled: false } },
    { count: 1.5, mode: 1, filter: { enabled: false } },
    { count: 1, mode: "1", filter: { enabled: false } },
    { count: 1, mode: 1, filter: { enabled: "false" } },
    { count: 1, mode: 1, filter: {}, values: [] },
    { count: 1, mode: 1, filter: { enabled: true }, values: ["2"] },
    { count: 1, mode: 1, filter: { enabled: true }, extra: true },
  ])
    assert.ok(validate.errors(args).length, JSON.stringify(args));
  assert.deepEqual(
    inputValidator({
      oneOf: [{ type: "integer" }, { type: "string", minLength: 2 }],
    }).errors("ok"),
    [],
  );
  assert.ok(
    inputValidator({
      oneOf: [{ type: "integer" }, { type: "string", minLength: 2 }],
    }).errors(true).length,
  );
  assert.deepEqual(
    inputValidator({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "integer" }],
    }).errors([2]),
    [],
  );
});

test("calls use the published invocation name and keep exact argument types", () => {
  const args = { count: 2, active: false, nested: { values: [1] } };
  assert.deepEqual(
    toolCall(
      { name: "gateway-tool", originalName: "upstream-tool" },
      args,
      "request-id",
    ),
    {
      jsonrpc: "2.0",
      id: "request-id",
      method: "tools/call",
      params: { name: "gateway-tool", arguments: args },
    },
  );
  for (const args of [null, [], "{}", 2])
    assert.throws(() => toolCall({ name: "tool" }, args, 1));
  assert.throws(() => toolCall({}, {}, 1));
  assert.match(
    toolCallError({ error: { code: -32602, message: "Invalid params" } }),
    /Invalid params/,
  );
  assert.match(
    toolCallError({ result: { isError: true, content: [] } }),
    /execution error/,
  );
  assert.equal(toolCallError({ result: { content: [] } }), "");
});

test("request IDs work with or without Web Crypto and remain distinct at the same timestamp", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else delete globalThis.crypto;
  });
  const nativeCrypto = {
    randomUUID() {
      assert.equal(this, nativeCrypto);
      return "native-request-id";
    },
  };
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: nativeCrypto,
  });
  assert.equal(toolCallId(), "native-request-id");
  t.mock.method(Date, "now", () => 1234567890);
  t.mock.method(Math, "random", () => 0.5);
  const ids = [];
  for (const crypto of [{}, undefined]) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: crypto,
    });
    for (let index = 0; index < 100; index++) ids.push(toolCallId());
  }
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});

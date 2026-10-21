import { Validator } from "@cfworker/json-schema";

/** Tool schemas are standalone JSON Schema, never panel resource schemas. */
export function toolSchema(tool) {
  const schema = tool.inputSchema ?? tool.input_schema;
  if (schema === undefined || schema === null)
    throw new Error("工具未返回 inputSchema / Tool did not return inputSchema");
  if (typeof schema !== "object" || Array.isArray(schema))
    throw new Error("工具 inputSchema 无效 / Invalid tool inputSchema");
  return schema;
}

function inputReference(ref, root) {
  return ref
    .slice(2)
    .split("/")
    .reduce(
      (value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
}

export function inputSchema(schema, root, seen = new Set()) {
  if (!schema || typeof schema !== "object") return {};
  if (!schema.$ref) return schema;
  if (!schema.$ref.startsWith("#/") || seen.has(schema.$ref)) return schema;
  const ref = schema.$ref;
  const target = inputReference(ref, root);
  if (!target) return schema;
  const { $ref, ...rest } = schema;
  return { ...inputSchema(target, root, new Set([...seen, ref])), ...rest };
}

/** Reject known root-type conflicts; this is not full schema satisfiability validation. */
export function inputCompatibilityError(root, en = false) {
  const ignoresRefSiblings = /draft-0[467]/.test(root?.$schema || "");
  function allowsObject(schema, seen = new Set()) {
    if (schema === false) return false;
    if (!schema || typeof schema !== "object" || seen.has(schema)) return true;
    const visited = new Set([...seen, schema]);
    if (ignoresRefSiblings && typeof schema.$ref === "string")
      return schema.$ref.startsWith("#/")
        ? allowsObject(inputReference(schema.$ref, root), visited)
        : true;
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (schema.type !== undefined && !types.includes("object")) return false;
    if (
      typeof schema.$ref === "string" &&
      schema.$ref.startsWith("#/") &&
      !allowsObject(inputReference(schema.$ref, root), visited)
    )
      return false;
    if (
      Array.isArray(schema.allOf) &&
      schema.allOf.some((child) => !allowsObject(child, visited))
    )
      return false;
    for (const key of ["anyOf", "oneOf"])
      if (
        Array.isArray(schema[key]) &&
        schema[key].length &&
        !schema[key].some((child) => allowsObject(child, visited))
      )
        return false;
    return true;
  }
  if (allowsObject(root)) return "";
  return en
    ? "inputSchema: Tool calls require a top-level object. Define arrays as object properties and match the upstream tool contract."
    : "inputSchema：工具调用要求顶层参数为对象。请将数组定义为对象字段，并与上游工具约定保持一致。";
}

export function inputDefaults(original, root = original, depth = 0) {
  const schema = inputSchema(original, root);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (depth > 8) return undefined;
  if (schema.type === "object" || schema.properties) {
    const entries = Object.entries(schema.properties || {}).flatMap(
      ([key, child]) => {
        const resolved = inputSchema(child, root);
        if (
          resolved.default === undefined &&
          resolved.const === undefined &&
          !schema.required?.includes(key)
        )
          return [];
        const value = inputDefaults(child, root, depth + 1);
        return value === undefined ? [] : [[key, value]];
      },
    );
    return Object.fromEntries(entries);
  }
  if (schema.type === "array") return [];
  return undefined;
}

export function inputValidator(schema) {
  try {
    const version = schema.$schema || "";
    const draft = /draft-04/.test(version)
      ? "4"
      : /draft-07/.test(version)
        ? "7"
        : /2019-09/.test(version)
          ? "2019-09"
          : "2020-12";
    const validator = new Validator(schema, draft, false);
    return {
      warning: "",
      errors(value) {
        const result = validator.validate(value);
        if (result.valid) return [];
        return result.errors.map(
          (error) => `${error.instanceLocation || "/"}: ${error.error}`,
        );
      },
    };
  } catch {
    return {
      warning:
        "此 Schema 含本地校验器不支持的定义，完整校验由后端执行。 / This schema requires backend validation.",
      errors: () => [],
    };
  }
}

let fallbackRequestSequence = 0;

/** Correlation IDs are not credentials and need no secure-context API. */
export function toolCallId() {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function")
    return browserCrypto.randomUUID();
  fallbackRequestSequence += 1;
  return `tool-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function toolCall(tool, args, id) {
  if (!tool.name || typeof tool.name !== "string")
    throw new Error("工具缺少调用名称 / Missing tool invocation name");
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error(
      "工具参数必须是 JSON 对象 / Tool arguments must be a JSON object",
    );
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: tool.name, arguments: args },
  };
}

export function toolCallError(response) {
  if (response?.error)
    return `${response.error.code ?? "RPC"}: ${response.error.message || JSON.stringify(response.error)}`;
  if (response?.result?.isError)
    return "工具执行返回错误 / Tool returned an execution error";
  return "";
}

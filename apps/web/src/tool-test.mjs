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

export function inputSchema(schema, root, seen = new Set()) {
  if (!schema || typeof schema !== "object") return {};
  if (!schema.$ref) return schema;
  if (!schema.$ref.startsWith("#/") || seen.has(schema.$ref)) return schema;
  const ref = schema.$ref;
  const target = ref
    .slice(2)
    .split("/")
    .reduce(
      (value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
  if (!target) return schema;
  const { $ref, ...rest } = schema;
  return { ...inputSchema(target, root, new Set([...seen, ref])), ...rest };
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

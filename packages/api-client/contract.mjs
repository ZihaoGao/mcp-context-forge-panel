export const METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
];
export function mergeContracts(baseline, live) {
  if (!live) return baseline;
  const paths = {};
  for (const [path, item] of Object.entries({
    ...baseline.paths,
    ...live.paths,
  })) {
    paths[path] = Object.fromEntries(
      Object.entries({ ...baseline.paths?.[path], ...item }).map(
        ([method, op]) => [
          method,
          METHODS.includes(method)
            ? {
                ...baseline.paths?.[path]?.[method],
                ...op,
                "x-panel-available": !!live.paths?.[path]?.[method],
              }
            : op,
        ],
      ),
    );
  }
  return {
    ...baseline,
    ...live,
    paths,
    components: {
      ...baseline.components,
      ...live.components,
      schemas: { ...baseline.components?.schemas, ...live.components?.schemas },
    },
  };
}
export function resolveSchema(schema, spec) {
  if (!schema) return {};
  if (schema.$ref)
    return resolveSchema(
      spec.components?.schemas?.[schema.$ref.split("/").pop()],
      spec,
    );
  if (schema.anyOf || schema.oneOf)
    return {
      ...schema,
      ...resolveSchema(
        (schema.anyOf || schema.oneOf).find((s) => s.type !== "null"),
        spec,
      ),
    };
  if (schema.allOf)
    return schema.allOf.reduce((out, part) => {
      const s = resolveSchema(part, spec);
      return {
        ...out,
        ...s,
        properties: { ...out.properties, ...s.properties },
        required: [...(out.required || []), ...(s.required || [])],
      };
    }, schema);
  return schema;
}
export function classify(path, operation) {
  if (operation.deprecated)
    return { kind: "excluded", reason: "Deprecated / 已废弃" };
  if (path.includes("/_internal/"))
    return {
      kind: "excluded",
      reason: "Internal service contract / 内部服务接口",
    };
  if (
    /^\/(health|ready|metrics)(\/|$)/.test(path) ||
    /\/health(\/|$)/.test(path)
  )
    return { kind: "excluded", reason: "Health / 健康探测" };
  const contents = Object.values(operation.responses || {}).flatMap((r) =>
    Object.keys(r.content || {}),
  );
  if (contents.includes("text/html") && !contents.includes("application/json"))
    return {
      kind: "excluded",
      reason: "Original UI rendering / 原前端渲染接口",
    };
  if (
    path.startsWith("/oauth/") ||
    path.startsWith("/vault/authorize/") ||
    path.includes("/.well-known/") ||
    /^\/(mcp|sse|message|rpc|initialize|ping|notifications)(\/|$)/.test(path) ||
    path.startsWith("/v1/protocol/")
  )
    return { kind: "protocol", reason: "Protocol / 协议与连接调试" };
  return { kind: "business", reason: "Schema action / 业务操作" };
}
export function operations(spec) {
  return Object.entries(spec.paths || {}).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => ({
      ...item[method],
      path,
      method: method.toUpperCase(),
      parameters: [
        ...(item.parameters || []),
        ...(item[method].parameters || []),
      ],
      classification: classify(path, item[method]),
    })),
  );
}
export function initialValue(schema, spec, requiredOnly = true, depth = 0) {
  const s = resolveSchema(schema, spec);
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (depth > 5) return null;
  if (s.type === "object" || s.properties)
    return Object.fromEntries(
      Object.entries(s.properties || {})
        .filter(
          ([key, p]) =>
            !p.readOnly && (!requiredOnly || s.required?.includes(key)),
        )
        .map(([key, value]) => [
          key,
          initialValue(value, spec, requiredOnly, depth + 1),
        ]),
    );
  if (s.type === "array") return [];
  if (s.type === "boolean") return false;
  if (["number", "integer"].includes(s.type)) return s.minimum ?? 0;
  return "";
}
export function listItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of [
    "data",
    "items",
    "tokens",
    "teams",
    "users",
    "roles",
    "servers",
    "tools",
    "resources",
    "prompts",
    "gateways",
    "agents",
    "providers",
    "models",
    "results",
    "members",
    "invitations",
    "plugins",
    "services",
  ])
    if (Array.isArray(value[key])) return value[key];
  return [];
}
export function recordId(item) {
  return item.id ?? item.email ?? item.uri ?? item.name;
}
export async function runBatch(
  items,
  action,
  { concurrency = 3, onResult = (_result) => {}, signal } = {},
) {
  let cursor = 0;
  const results = [];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length && !signal?.aborted) {
        const item = items[cursor++];
        let result;
        try {
          await action(item);
          result = { item, ok: true };
        } catch (error) {
          result = { item, ok: false, error: error.message };
        }
        results.push(result);
        onResult(result);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

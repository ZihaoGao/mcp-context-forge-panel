export const METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
];

const jsonObject = (title, description) => ({
  type: "object",
  title,
  description,
  additionalProperties: true,
});

const jsonBody = (schema, description) => ({
  required: true,
  description,
  content: { "application/json": { schema } },
});

const opaqueJsonBody = (source, description) => ({
  requestBody: jsonBody(
    jsonObject("JSON body", description),
    "The v1.0.11 handler parses this JSON body directly from Request.",
  ),
  source,
  completeness: "opaque",
});

const opaqueFormBody = (source) => ({
  requestBody: {
    required: false,
    description:
      "The v1.0.11 handler reads URL-encoded form fields directly from Request. Field names are not declared in OpenAPI; enter the fields as a JSON object.",
    content: {
      "application/x-www-form-urlencoded": {
        schema: jsonObject(
          "Form fields",
          "Opaque form fields consumed by the backend handler.",
        ),
      },
    },
  },
  source,
  completeness: "opaque",
});

const rpcRequestSchema = (method, title = "JSON-RPC Request") => ({
  type: "object",
  title,
  additionalProperties: true,
  properties: {
    jsonrpc: {
      type: "string",
      enum: ["2.0"],
      default: "2.0",
      description: "JSON-RPC protocol version.",
    },
    id: {
      anyOf: [{ type: "string" }, { type: "integer" }],
      default: "1",
      minLength: 1,
      description:
        "Request identifier. The backend also accepts integer identifiers.",
    },
    method: {
      type: "string",
      ...(method ? { enum: [method], default: method } : { minLength: 1 }),
      description: "JSON-RPC method to invoke.",
    },
    params: {
      ...jsonObject("Parameters", "Method-specific JSON parameters."),
      default: {},
    },
  },
  required: ["jsonrpc", "method"],
});

const initializeRequestSchema = {
  type: "object",
  title: "Initialize Request",
  additionalProperties: true,
  properties: {
    protocolVersion: {
      type: "string",
      minLength: 1,
      description:
        "Required protocol version; the handler also accepts protocol_version.",
    },
    capabilities: {
      ...jsonObject(
        "Client Capabilities",
        "Capabilities supported by the client.",
      ),
      default: {},
    },
  },
  required: ["protocolVersion"],
};

const appBridgeRpcRequestSchema = rpcRequestSchema(
  undefined,
  "MCP App JSON-RPC Request",
);
appBridgeRpcRequestSchema.properties.mcpSessionId = {
  type: "string",
  description:
    "MCP session identifier; alternatively pass mcp-session-id or x-mcp-session-id.",
};
appBridgeRpcRequestSchema.properties.serverId = {
  type: "string",
  description:
    "Optional server identifier; alternatively pass x-contextforge-server-id.",
};

// FastAPI does not emit requestBody for handlers that read Request directly.
// These v1.0.11 source-backed supplements keep the workbench honest about body
// media types and give known JSON-RPC shapes first-class fields. Opaque JSON and
// form handlers still get an editor; POST alone is never treated as body proof.
const requestBodySupplements = {
  "/rpc": {
    post: {
      requestBody: jsonBody(
        rpcRequestSchema(),
        "JSON-RPC 2.0 request consumed by mcpgateway/main.py:11422.",
      ),
      source:
        "mcpgateway/main.py:8120,11422 (Request.body; JSON-RPC validation)",
    },
  },
  "/rpc/": {
    post: {
      requestBody: jsonBody(
        rpcRequestSchema(),
        "JSON-RPC 2.0 request consumed by mcpgateway/main.py:11422.",
      ),
      source:
        "mcpgateway/main.py:8120,11422 (Request.body; JSON-RPC validation)",
    },
  },
  "/v1/protocol/initialize": {
    post: {
      requestBody: jsonBody(
        initializeRequestSchema,
        "Initialize body consumed by mcpgateway/main.py:4006 and session_registry.py:2116.",
      ),
      source: "mcpgateway/main.py:4006 (_read_request_json)",
    },
  },
  "/initialize": {
    post: {
      requestBody: jsonBody(
        initializeRequestSchema,
        "Initialize body consumed by mcpgateway/main.py:4006 and session_registry.py:2116.",
      ),
      source: "mcpgateway/main.py:4006 (_read_request_json)",
    },
  },
  "/v1/protocol/ping": {
    post: {
      requestBody: jsonBody(
        rpcRequestSchema("ping", "Ping Request"),
        "JSON-RPC ping request consumed by mcpgateway/main.py:4038.",
      ),
      source: "mcpgateway/main.py:4038 (_read_request_json)",
    },
  },
  "/v1/protocol/notifications": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "JSON-RPC Notification",
          additionalProperties: true,
          properties: {
            jsonrpc: { type: "string", enum: ["2.0"], default: "2.0" },
            method: {
              type: "string",
              enum: [
                "notifications/initialized",
                "notifications/cancelled",
                "notifications/message",
              ],
            },
            params: jsonObject("Parameters", "Notification parameters."),
          },
          required: ["jsonrpc", "method"],
        },
        "JSON-RPC notification consumed by mcpgateway/main.py:4066.",
      ),
      source: "mcpgateway/main.py:4066 (_read_request_json)",
    },
  },
  "/notifications": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "JSON-RPC Notification",
          additionalProperties: true,
          properties: {
            jsonrpc: { type: "string", enum: ["2.0"], default: "2.0" },
            method: {
              type: "string",
              enum: [
                "notifications/initialized",
                "notifications/cancelled",
                "notifications/message",
              ],
            },
            params: jsonObject("Parameters", "Notification parameters."),
          },
          required: ["jsonrpc", "method"],
        },
        "JSON-RPC notification consumed by mcpgateway/main.py:4066.",
      ),
      source: "mcpgateway/main.py:4066 (_read_request_json)",
    },
  },
  "/v1/protocol/completion/complete": opaqueJsonBody(
    "mcpgateway/main.py:4101",
    "Completion request body. The handler passes the parsed JSON object to the completion service.",
  ),
  "/v1/protocol/sampling/createMessage": opaqueJsonBody(
    "mcpgateway/main.py:4126",
    "Sampling request body. The handler passes the parsed JSON object to the sampling service.",
  ),
  "/v1/servers/{server_id}/message": opaqueJsonBody(
    "mcpgateway/main.py:4712",
    "JSON message delivered to an existing MCP session. The session_id query parameter is also required.",
  ),
  "/v1/virtual-servers/{server_id}/message": opaqueJsonBody(
    "mcpgateway/main.py:4712",
    "JSON message delivered to an existing MCP session. The session_id query parameter is also required.",
  ),
  "/appbridge/sessions": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "MCP App Session Request",
          additionalProperties: true,
          properties: {
            resourceUri: {
              type: "string",
              minLength: 1,
              pattern: "^ui://",
              description: "URI of the MCP App resource.",
            },
            serverId: {
              type: "string",
              description:
                "Server identifier; alternatively pass x-contextforge-server-id.",
            },
            mcpSessionId: {
              type: "string",
              description:
                "MCP session identifier; alternatively pass mcp-session-id.",
            },
          },
          required: ["resourceUri"],
        },
        "Create a session for an authorized MCP App resource.",
      ),
      parameters: [
        {
          name: "mcp-session-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description:
            "MCP session identifier (or provide mcpSessionId in the body).",
        },
        {
          name: "x-mcp-session-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "Alternative MCP session identifier header.",
        },
        {
          name: "x-contextforge-server-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "Server identifier (or provide serverId in the body).",
        },
      ],
      source: "mcpgateway/main.py:10678 (_read_request_json via Request.body)",
    },
  },
  "/appbridge/sessions/{app_session_id}/rpc": {
    post: {
      requestBody: jsonBody(
        appBridgeRpcRequestSchema,
        "JSON-RPC request consumed by mcpgateway/main.py:10908.",
      ),
      parameters: [
        {
          name: "mcp-session-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description:
            "MCP session identifier (or provide mcpSessionId in the request body).",
        },
        {
          name: "x-mcp-session-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description: "Alternative MCP session identifier header.",
        },
        {
          name: "x-contextforge-server-id",
          in: "header",
          required: false,
          schema: { type: "string" },
          description:
            "Optional server identifier used to verify the bound app session.",
        },
      ],
      source: "mcpgateway/main.py:10908 (_read_request_json via Request.body)",
    },
  },
  "/message": opaqueJsonBody(
    "mcpgateway/main.py:12283",
    "JSON-RPC message to broadcast to the MCP session_id query parameter.",
  ),
  "/logging/setLevel": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Set Log Level Request",
          properties: {
            level: {
              type: "string",
              enum: [
                "debug",
                "info",
                "notice",
                "warning",
                "error",
                "critical",
                "alert",
                "emergency",
              ],
            },
          },
          required: ["level"],
        },
        "Set the runtime log level.",
      ),
      source: "mcpgateway/main.py:12330 (_read_request_json)",
    },
  },
  "/v1/admin/tools/generate-schemas-from-openapi": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Generate Tool Schemas Request",
          properties: {
            url: { type: "string", format: "uri", minLength: 1 },
            request_type: { type: "string", default: "GET" },
            openapi_url: {
              type: "string",
              default: "",
              description:
                "Optional direct OpenAPI URL; blank enables discovery.",
            },
          },
          required: ["url"],
        },
        "Generate tool schemas from a target API and its OpenAPI document.",
      ),
      source: "mcpgateway/admin.py:12400 (_read_request_json)",
    },
  },
  "/v1/tools/generate-schemas-from-openapi": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Generate Tool Schemas Request",
          properties: {
            url: { type: "string", format: "uri", minLength: 1 },
            request_type: { type: "string", default: "GET" },
            openapi_url: {
              type: "string",
              default: "",
              description:
                "Optional direct OpenAPI URL; blank enables discovery.",
            },
          },
          required: ["url"],
        },
        "Generate tool schemas from a target API and its OpenAPI document.",
      ),
      source: "mcpgateway/admin.py:12400 (_read_request_json)",
    },
  },
  "/v1/admin/gateways/discover-oauth": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "OAuth Discovery Request",
          properties: {
            issuer: { type: "string", format: "uri", minLength: 1 },
          },
          required: ["issuer"],
        },
        "Discover OAuth/OIDC metadata for an issuer URL.",
      ),
      source: "mcpgateway/admin.py:12656 (Request.json)",
    },
  },
  "/v1/admin/export/selective": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Selective Export Request",
          properties: {
            entity_selections: {
              ...jsonObject(
                "Entity selections",
                "Entity IDs to export by type.",
              ),
              default: {},
            },
            include_dependencies: { type: "boolean", default: true },
          },
        },
        "Export selected entities and optionally their dependencies.",
      ),
      source: "mcpgateway/admin.py:15953 (_read_request_json)",
    },
  },
  "/v1/admin/import/preview": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Import Preview Request",
          properties: {
            data: jsonObject("Import data", "Configuration import document."),
          },
          required: ["data"],
        },
        "Preview a configuration import document.",
      ),
      source: "mcpgateway/admin.py:16022 (_read_request_json)",
    },
  },
  "/v1/admin/import/configuration": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "Configuration Import Request",
          properties: {
            import_data: jsonObject(
              "Import data",
              "Configuration import document.",
            ),
            conflict_strategy: {
              type: "string",
              enum: ["skip", "update", "rename", "fail"],
              default: "update",
            },
            dry_run: { type: "boolean", default: false },
            rekey_secret: { type: "string" },
            selected_entities: jsonObject(
              "Selected entities",
              "Optional entity selection.",
            ),
          },
          required: ["import_data"],
        },
        "Import configuration data with conflict and selection options.",
      ),
      source: "mcpgateway/admin.py:16081 (_read_request_json)",
    },
  },
  "/v1/admin/a2a/{agent_id}/test": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "A2A Agent Test Request",
          properties: { query: { type: "string" } },
        },
        "Optional query sent to the A2A agent test operation.",
      ),
      source: "mcpgateway/admin.py:16824 (_read_request_json)",
    },
  },
  "/v1/admin/llm/test": {
    post: {
      requestBody: jsonBody(
        {
          type: "object",
          title: "LLM Test Request",
          properties: {
            test_type: {
              type: "string",
              enum: ["models", "chat"],
              default: "models",
            },
            model_id: { type: "string" },
            message: {
              type: "string",
              default: "Hello! Please respond with a short greeting.",
            },
            max_tokens: { type: "integer", default: 100, minimum: 1 },
          },
        },
        "Run an administrator LLM connectivity test.",
      ),
      source: "mcpgateway/routers/llm_admin_router.py:497 (Request.body)",
    },
  },
  "/v1/admin/tools/import": {
    post: {
      requestBody: {
        required: true,
        description:
          "Bulk tool import accepts a JSON array or URL-encoded form fields; the form handler may also accept a file upload.",
        content: {
          "application/json": {
            schema: {
              type: "array",
              title: "Tools to Import",
              items: { $ref: "#/components/schemas/ToolCreate" },
            },
          },
          "application/x-www-form-urlencoded": {
            schema: jsonObject(
              "Import Form Fields",
              "Opaque form fields accepted by the importer.",
            ),
          },
        },
      },
      source: "mcpgateway/admin.py:15147 (Request.body and Request.form)",
    },
  },
  "/v1/admin/tools/import/": {
    post: {
      requestBody: {
        required: true,
        description:
          "Bulk tool import accepts a JSON array or URL-encoded form fields; the form handler may also accept a file upload.",
        content: {
          "application/json": {
            schema: {
              type: "array",
              title: "Tools to Import",
              items: { $ref: "#/components/schemas/ToolCreate" },
            },
          },
          "application/x-www-form-urlencoded": {
            schema: jsonObject(
              "Import Form Fields",
              "Opaque form fields accepted by the importer.",
            ),
          },
        },
      },
      source: "mcpgateway/admin.py:15147 (Request.body and Request.form)",
    },
  },
};

const rawFormPathEvidence = {
  "/v1/admin/servers": 3118,
  "/v1/admin/servers/{server_id}/edit": 3265,
  "/v1/admin/servers/{server_id}/state": 3424,
  "/v1/admin/servers/{server_id}/delete": 3480,
  "/v1/admin/gateways/{gateway_id}/state": 3697,
  "/v1/admin/login": 4520,
  "/v1/admin/forgot-password": 4725,
  "/v1/admin/reset-password/{token}": 4804,
  "/v1/admin/change-password-required": 5202,
  "/v1/admin/teams": 6089,
  "/v1/admin/teams/{team_id}/update": 6610,
  "/v1/admin/teams/{team_id}/add-member": 6822,
  "/v1/admin/teams/{team_id}/update-member-role": 7042,
  "/v1/admin/teams/{team_id}/remove-member": 7118,
  "/v1/admin/teams/{team_id}/join-request": 7268,
  "/v1/admin/users": 8222,
  "/v1/admin/users/{user_email}/update": 8446,
  "/v1/admin/tools": 12078,
  "/v1/admin/tools/": 12078,
  "/v1/admin/tools/{tool_id}/edit": 12240,
  "/v1/admin/tools/{tool_id}/edit/": 12240,
  "/v1/admin/tools/{tool_id}/delete": 12515,
  "/v1/admin/tools/{tool_id}/state": 12562,
  "/v1/admin/gateways/{gateway_id}/edit": 13168,
  "/v1/admin/gateways/{gateway_id}/delete": 13355,
  "/v1/admin/resources": 13504,
  "/v1/admin/resources/{resource_id}/edit": 13634,
  "/v1/admin/resources/{resource_id}/delete": 13766,
  "/v1/admin/resources/{resource_id}/state": 13818,
  "/v1/admin/prompts": 13913,
  "/v1/admin/prompts/{prompt_id}/edit": 14029,
  "/v1/admin/prompts/{prompt_id}/delete": 14159,
  "/v1/admin/prompts/{prompt_id}/state": 14205,
  "/v1/admin/roots": 14431,
  "/v1/admin/a2a": 16313,
  "/v1/admin/a2a/{agent_id}/edit": 16493,
  "/v1/admin/a2a/{agent_id}/state": 16719,
  "/v1/admin/a2a/{agent_id}/delete": 16773,
  "/v1/admin/a2a/plugin-bindings": 17587,
};
for (const [path, line] of Object.entries(rawFormPathEvidence)) {
  const source = `mcpgateway/admin.py:${line} (Request.form)`;
  requestBodySupplements[path] = { post: opaqueFormBody(source) };
}

export function supplementRequestBodies(spec) {
  if (!spec || typeof spec !== "object") return spec;
  const paths = { ...(spec.paths || {}) };
  let changed = false;
  for (const [path, entry] of Object.entries(requestBodySupplements)) {
    const pathItem = paths[path];
    if (!pathItem) continue;
    const methodItem = pathItem.post;
    if (!methodItem) continue;
    const supplement = entry.post || entry;
    const operation = { ...methodItem };
    if (!operation.requestBody) operation.requestBody = supplement.requestBody;
    if (supplement.parameters) {
      const parameters = [...(operation.parameters || [])];
      for (const parameter of supplement.parameters)
        if (
          !parameters.some(
            (item) => item.in === parameter.in && item.name === parameter.name,
          )
        )
          parameters.push(parameter);
      operation.parameters = parameters;
    }
    operation["x-panel-request-body-source"] = supplement.source;
    operation["x-panel-request-body-completeness"] =
      supplement.completeness || "verified-fields";
    operation["x-panel-all-fields"] = true;
    paths[path] = { ...pathItem, post: operation };
    changed = true;
  }
  return changed ? { ...spec, paths } : spec;
}

export function mergeContracts(baseline, live) {
  baseline = supplementRequestBodies(baseline);
  if (!live) return baseline;
  live = supplementRequestBodies(live);
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
  return supplementRequestBodies({
    ...baseline,
    ...live,
    paths,
    components: {
      ...baseline.components,
      ...live.components,
      schemas: { ...baseline.components?.schemas, ...live.components?.schemas },
    },
  });
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

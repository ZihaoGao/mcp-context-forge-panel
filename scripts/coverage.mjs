import { readFile, writeFile } from "node:fs/promises";
import { operations } from "../packages/api-client/contract.mjs";
const spec = JSON.parse(
  await readFile("contracts/contextforge/web-contract.json", "utf8"),
);
const inventory = JSON.parse(
  await readFile("contracts/contextforge/source-routes.json", "utf8"),
);
const domains = [
  ["/api/logs", "Logs & audit / API workspace"],
  [
    "/v1/observability/spans",
    "API workspace (trace detail uses embedded spans)",
  ],
  ["/v1/observability", "Observability / API workspace"],
  ["/v1/auth/", "Login / account / API workspace"],
  ["/v1/rbac/", "Roles & permissions"],
  ["/v1/tokens", "My API keys"],
  ["/v1/teams", "Teams"],
  ["/v1/servers", "Virtual servers"],
  ["/v1/virtual-servers", "Virtual servers / API workspace"],
  ["/v1/gateways", "MCP gateways"],
  ["/v1/mcp-servers", "MCP gateways / API workspace"],
  ["/v1/tools", "Tools"],
  ["/v1/resources", "Resources"],
  ["/v1/prompts", "Prompts"],
  ["/v1/a2a", "A2A agents"],
  ["/v1/roots", "Roots"],
  ["/v1/llmchat", "Chat / API workspace"],
  ["/v1/llm/", "Models & providers"],
];
const coverage = operations(spec).map((op) => {
  const candidates = inventory.routes.filter(
    (r) =>
      r.method === op.method &&
      op.operationId?.startsWith(r.handler + "_") &&
      op.path.endsWith(r.path),
  );
  const declared = [
    ...new Set(candidates.map((r) => r.permission).filter(Boolean)),
  ];
  const permission =
    declared.length === 1
      ? declared[0]
      : "Not statically resolved; backend enforces authorization";
  return {
    method: op.method,
    path: op.path,
    operationId: op.operationId,
    category: op.classification.kind,
    reason: op.classification.reason,
    entry:
      op.classification.kind === "excluded"
        ? null
        : op.path.replace(/\/$/, "") === "/v1/tools" && op.method === "POST"
          ? "Tools / create or import local REST definitions (MCP tools discovered via gateways)"
          : op.path.replace(/\/$/, "") === "/rpc" && op.method === "POST"
            ? "Tools / schema-driven test call; API workspace / JSON-RPC"
            : op.path.replace(/\/$/, "") === "/v1/gateways" &&
                op.method === "POST"
              ? "MCP gateways / Tools: connect MCP service and view discovered tools"
              : domains.find(([prefix]) => op.path.startsWith(prefix))?.[1] ||
                "API workspace",
    permission,
    dependencies: [...new Set(candidates.flatMap((r) => r.dependencies || []))],
    permissionEvidence: candidates.map((r) => `${r.source}:${r.line}`),
    feature: op["x-panel-feature"] || null,
    requestBody: op.requestBody
      ? {
          required: op.requestBody.required !== false,
          contentTypes: Object.keys(op.requestBody.content || {}),
          completeness: op["x-panel-request-body-completeness"] || "openapi",
          source: op["x-panel-request-body-source"] || "OpenAPI",
        }
      : null,
    verification:
      "Contract mapped; see docs/verification.md for executed scenarios",
  };
});
const totals = coverage.reduce(
  (acc, item) => ({ ...acc, [item.category]: (acc[item.category] || 0) + 1 }),
  {},
);
await writeFile(
  "contracts/contextforge/coverage.json",
  JSON.stringify({ tag: "v1.0.11", totals, operations: coverage }, null, 2) +
    "\n",
);
const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
const columns = [
  "method",
  "path",
  "category",
  "entry",
  "permission",
  "feature",
  "requestBodyTypes",
  "requestBodyCompleteness",
  "requestBodySource",
  "reason",
  "verification",
];
await writeFile(
  "contracts/contextforge/coverage.csv",
  [
    columns.join(","),
    ...coverage.map((item) =>
      columns
        .map((key) => {
          if (key === "requestBodyTypes")
            return quote(item.requestBody?.contentTypes.join(" | ") || "");
          if (key === "requestBodyCompleteness")
            return quote(item.requestBody?.completeness || "");
          if (key === "requestBodySource")
            return quote(item.requestBody?.source || "");
          return quote(item[key]);
        })
        .join(","),
    ),
  ].join("\n") + "\n",
);
console.log(totals);

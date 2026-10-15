import { readFile, writeFile } from "node:fs/promises";
import { operations } from "../packages/api-client/contract.mjs";
const spec = JSON.parse(
  await readFile("contracts/contextforge/web-contract.json", "utf8"),
);
const inventory = JSON.parse(
  await readFile("contracts/contextforge/source-routes.json", "utf8"),
);
const domains = [
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
        : domains.find(([prefix]) => op.path.startsWith(prefix))?.[1] ||
          "API workspace",
    permission,
    dependencies: [...new Set(candidates.flatMap((r) => r.dependencies || []))],
    permissionEvidence: candidates.map((r) => `${r.source}:${r.line}`),
    feature: op["x-panel-feature"] || null,
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
  "reason",
  "verification",
];
await writeFile(
  "contracts/contextforge/coverage.csv",
  [
    columns.join(","),
    ...coverage.map((item) => columns.map((key) => quote(item[key])).join(",")),
  ].join("\n") + "\n",
);
console.log(totals);

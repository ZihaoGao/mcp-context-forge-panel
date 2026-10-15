import { readFile, writeFile } from "node:fs/promises";
const spec = JSON.parse(
  await readFile("contracts/contextforge/openapi.json", "utf8"),
);
const optional = JSON.parse(
  await readFile("contracts/contextforge/optional-openapi.json", "utf8").catch(
    () => '{"paths":{},"components":{"schemas":{}}}',
  ),
);
spec.paths = { ...spec.paths, ...optional.paths };
spec.components.schemas = {
  ...spec.components.schemas,
  ...optional.components?.schemas,
};
const inventory = JSON.parse(
  await readFile("contracts/contextforge/source-routes.json", "utf8"),
);
for (const [path, methods] of Object.entries(spec.paths))
  for (const [method, operation] of Object.entries(methods)) {
    const candidates = inventory.routes.filter(
      (route) =>
        route.method.toLowerCase() === method &&
        operation.operationId?.startsWith(route.handler + "_") &&
        path.endsWith(route.path),
    );
    const permissions = [
      ...new Set(candidates.map((route) => route.permission).filter(Boolean)),
    ];
    if (permissions.length === 1) {
      const match = permissions[0].match(
        /require_permission\(['"]([^'"]+)['"]/,
      );
      if (match) operation["x-panel-permission"] = match[1];
      if (permissions[0].startsWith("require_admin_permission"))
        operation["x-panel-admin"] = true;
    }
  }
for (const entry of optional["x-panel-features"] || [])
  for (const operation of Object.values(spec.paths[entry.path] || {}))
    operation["x-panel-feature"] = entry.flag;
function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !["examples", "example", "externalDocs"].includes(key),
        )
        .map(([key, item]) => [
          key,
          key === "description" && typeof item === "string"
            ? item.split("\n\n")[0].slice(0, 240)
            : compact(item),
        ]),
    );
  return value;
}
await writeFile(
  "contracts/contextforge/web-contract.json",
  JSON.stringify(compact(spec)) + "\n",
);
const auth = compact({
  ...spec,
  paths: Object.fromEntries(
    Object.entries(spec.paths).filter(
      ([path]) =>
        path.startsWith("/v1/auth/email/") && !path.includes("/admin/"),
    ),
  ),
});
const needed = new Set();
function refs(value) {
  if (!value || typeof value !== "object") return;
  if (value.$ref) {
    const name = value.$ref.split("/").pop();
    if (!needed.has(name)) {
      needed.add(name);
      refs(spec.components.schemas[name]);
    }
  }
  for (const item of Object.values(value)) refs(item);
}
refs(auth.paths);
auth.components = {
  ...auth.components,
  schemas: Object.fromEntries(
    Object.entries(auth.components.schemas).filter(([name]) =>
      needed.has(name),
    ),
  ),
};
await writeFile(
  "contracts/contextforge/auth-contract.json",
  JSON.stringify(auth) + "\n",
);

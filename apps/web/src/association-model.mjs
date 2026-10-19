import { loadResourcePages } from "./list-model.mjs";
import { listItems } from "../../../packages/api-client/contract.mjs";
import { canonicalField } from "./resource-copy.mjs";

export const associationEndpoints = {
  associated_tools: "/v1/tools",
  associated_resources: "/v1/resources",
  associated_prompts: "/v1/prompts",
  associated_a2a_agents: "/v1/a2a",
  plugin_ids: "/v1/admin/plugins",
};

export async function loadAssociationOptions(name, spec, fetchPage, signal) {
  const key = canonicalField(name);
  const path = associationEndpoints[key];
  const operation = spec.paths?.[path]?.get || spec.paths?.[path + "/"]?.get;
  if (!operation || operation["x-panel-available"] === false)
    throw new Error("关联目录接口不可用 / Association catalog unavailable");
  const seenIds = new Set();
  const rows = await loadResourcePages(
    { ...operation, path: spec.paths[path]?.get ? path : path + "/" },
    async (url, options) => {
      const data = await fetchPage(url, options);
      const items = listItems(data).map((item) => ({
        ...item,
        id: key === "plugin_ids" ? item.name : item.id,
      }));
      if (items.some((item) => typeof item.id !== "string" || !item.id))
        throw new Error("关联目录缺少 ID / Association catalog missing IDs");
      if (items.length && items.every((item) => seenIds.has(item.id)))
        throw new Error(
          "关联目录分页未返回新结果 / Pagination made no progress",
        );
      for (const item of items) seenIds.add(item.id);
      return Array.isArray(data) ? items : { ...data, data: items };
    },
    { signal },
  );
  return rows;
}

export function filterAssociationOptions(
  options,
  value,
  filter,
  selection = "all",
) {
  const search = filter.trim().toLowerCase();
  return options.filter(
    (item) =>
      [item.name, item.displayName, item.id, item.description, item.gatewaySlug]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search) &&
      (selection === "all" ||
        (selection === "selected") === value.includes(item.id)),
  );
}

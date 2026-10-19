import { listItems, recordId } from "../../../packages/api-client/contract.mjs";
import { readField } from "./resource-model.mjs";

export function resourceTags(tags, includeIds = false) {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .flatMap((tag) => {
          if (typeof tag === "string") return [tag];
          if (!tag || typeof tag !== "object" || Array.isArray(tag)) return [];
          const label = typeof tag.label === "string" ? tag.label.trim() : "";
          const id = typeof tag.id === "string" ? tag.id.trim() : "";
          return includeIds ? [label, id] : [label || id];
        })
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export function resourceStatus(item) {
  return (
    item.is_active ??
    item.enabled ??
    item.isActive ??
    (item.status === "disabled"
      ? false
      : ["active", "enabled"].includes(item.status)
        ? true
        : undefined)
  );
}

export function matchesResource(
  item,
  { search = "", state = "", visibility = "", team = "" } = {},
) {
  const haystack = [
    item.name,
    item.full_name,
    item.displayName,
    item.originalName,
    item.email,
    item.uri,
    item.id,
    item.description,
    ...resourceTags(item.tags, true),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes(search.trim().toLowerCase()) &&
    (!state ||
      (state === "enabled"
        ? resourceStatus(item) === true
        : resourceStatus(item) === false)) &&
    (!visibility || item.visibility === visibility) &&
    (!team || readField(item, "team_id") === team)
  );
}

export function listPath(
  operation,
  { team = "", visibility = "", cursor = "", page = 0, size = 25 } = {},
) {
  const names = new Set((operation.parameters || []).map((p) => p.name));
  const q = new URLSearchParams();
  for (const key of ["include_pagination", "include_inactive"])
    if (names.has(key)) q.set(key, "true");
  for (const key of ["active_only", "enabled_only"])
    if (names.has(key)) q.set(key, "false");
  if (names.has("limit")) q.set("limit", String(size));
  if (names.has("page_size")) q.set("page_size", String(size));
  if (names.has("offset")) q.set("offset", String(page * size));
  if (names.has("skip")) q.set("skip", String(page * size));
  if (names.has("page")) q.set("page", String(page + 1));
  if (team && names.has("team_id")) q.set("team_id", team);
  if (visibility && names.has("visibility")) q.set("visibility", visibility);
  if (cursor) q.set("cursor", cursor);
  return operation.path + (q.size ? "?" + q : "");
}

export function pagination(data, operation, page, size = 25) {
  const nextCursor =
    data?.nextCursor ||
    data?.next_cursor ||
    data?.pagination?.next_cursor ||
    "";
  const total = data?.total ?? data?.pagination?.total;
  const offset = (operation.parameters || []).some((p) =>
    ["offset", "skip", "page"].includes(p.name),
  );
  return {
    nextCursor,
    total,
    hasNext:
      !!nextCursor ||
      (offset &&
        (Number.isFinite(total)
          ? (page + 1) * size < total
          : listItems(data).length === size)),
  };
}

// Never present a truncated scan as a complete search or batch selection.
/** @param {{team?: string, visibility?: string, signal?: AbortSignal, maxItems?: number}} [options] */
export async function loadResourcePages(operation, fetchPage, options = {}) {
  const { team = "", visibility = "", signal, maxItems = 10000 } = options;
  const size = 100;
  const out = new Map();
  const cursors = new Set();
  let cursor = "";
  for (let page = 0; page < 500; page++) {
    signal?.throwIfAborted();
    const data = await fetchPage(
      listPath(operation, { team, visibility, cursor, page, size }),
      { signal },
    );
    const items = listItems(data);
    const before = out.size;
    for (const item of items) {
      const id = recordId(item);
      if (id === undefined || id === null)
        throw new Error(
          "列表缺少资源标识，无法可靠完成跨页查找 / Missing resource identifier",
        );
      out.set(String(id), item);
    }
    if (out.size > maxItems)
      throw new Error(
        `资源超过跨页查找上限（${maxItems} 项），请先选择团队或可见性缩小范围 / Search limit exceeded; narrow team or visibility`,
      );
    const { nextCursor, total, hasNext } = pagination(
      data,
      operation,
      page,
      size,
    );
    if (!hasNext) {
      if (Number.isFinite(total) && total > out.size)
        throw new Error(
          "分页结果不完整，无法确认全部资源；请刷新后重试 / Incomplete pagination",
        );
      return [...out.values()];
    }
    if (!items.length || out.size === before)
      throw new Error(
        "分页未继续返回新资源，无法确认全部结果；请刷新后重试 / Pagination made no progress",
      );
    if (nextCursor) {
      if (cursors.has(nextCursor))
        throw new Error(
          "分页游标重复，无法确认全部结果；请刷新后重试 / Repeated pagination cursor",
        );
      cursors.add(nextCursor);
    }
    cursor = nextCursor;
  }
  throw new Error(
    "分页超过查找上限，未显示不完整结果 / Pagination limit exceeded",
  );
}

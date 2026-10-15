import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listItems } from "../../../../packages/api-client/contract.mjs";
import {
  request,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext } from "../session";
export function ReferenceInput({
  name,
  value,
  required,
  onChange,
  scope,
}: {
  name: string;
  value: string;
  required: boolean;
  onChange: (next: string | undefined) => void;
  scope?: string;
}) {
  const { user } = useContext(SessionContext);
  const [search, setSearch] = useState("");
  const endpoint =
    name === "server_id"
      ? "/v1/servers?limit=100&include_pagination=true"
      : ["role_id", "inherits_from"].includes(name)
        ? "/v1/rbac/roles"
        : "/v1/teams/?limit=500&include_pagination=true";
  const data = useQuery({
    queryKey: ["reference-options", endpoint],
    queryFn: async () => {
      if (["role_id", "inherits_from"].includes(name))
        return listItems(await request(endpoint));
      const size = name === "server_id" ? 100 : 500;
      const out: JsonRecord[] = [];
      let cursor = "";
      const cursors = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const [path, query] = endpoint.split("?");
        const q = new URLSearchParams(query);
        q.set(name === "server_id" ? "offset" : "skip", String(page * size));
        if (cursor) q.set("cursor", cursor);
        const data = await request(path + "?" + q);
        const items = listItems(data);
        const fresh = items.filter(
          (v: JsonRecord) => !out.some((previous) => previous.id === v.id),
        );
        out.push(...fresh);
        const next = data?.nextCursor || data?.next_cursor;
        if (next) {
          if (cursors.has(next)) throw new Error("分页游标重复");
          cursors.add(next);
          cursor = next;
        } else if (
          !fresh.length ||
          items.length < size ||
          (data.total !== undefined && out.length >= data.total)
        )
          return out;
      }
      throw new Error("可选项超过加载上限，请缩小查询范围");
    },
    enabled: !!user,
    retry: false,
  });
  const options = (data.data || []).filter(
    (item: JsonRecord) => name !== "role_id" || !scope || item.scope === scope,
  );
  const selected = options.find((item: JsonRecord) => item.id === value);
  return (
    <>
      <input
        aria-label={`Search ${name} choices`}
        placeholder="搜索名称或 ID / Search choices"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={name}
        required={required}
        value={value || ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">
          {data.isPending ? "正在加载…" : "不指定 / Not specified"}
        </option>
        {value &&
          !options
            .filter((item: JsonRecord) =>
              `${item.name} ${item.id}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .some((item: JsonRecord) => item.id === value) && (
            <option value={value}>{selected?.name || value}</option>
          )}
        {options
          .filter((item: JsonRecord) =>
            `${item.name} ${item.id}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((item: JsonRecord) => (
            <option key={item.id} value={item.id}>
              {item.name || item.email} · {item.id.slice(0, 8)}
            </option>
          ))}
      </select>
      {data.isError && (
        <small className="error-text">无法加载可选项，请检查权限后重试。</small>
      )}
    </>
  );
}
export function PermissionPicker({
  value,
  onChange,
  restricted,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  restricted: boolean;
}) {
  const { user, permissions } = useContext(SessionContext);
  const [filter, setFilter] = useState("");
  const catalog = useQuery({
    queryKey: ["available-permissions"],
    queryFn: () => request("/v1/rbac/permissions/available"),
    enabled: !!user,
    retry: false,
  });
  const options: string[] = catalog.data?.all_permissions || [];
  const allowed = options.filter(
    (permission) => !restricted || permitted(permissions, permission),
  );
  const shown = [...new Set([...allowed, ...value])].filter((p) =>
    p.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="permission-picker">
      <input
        aria-label="Filter permission choices"
        placeholder="搜索权限 / Search permissions"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="picker-actions">
        <button
          type="button"
          className="text-button"
          disabled={!shown.length}
          onClick={() => onChange([...new Set([...value, ...shown])])}
        >
          全选匹配项 ({shown.length}) / Select matching
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!shown.some((p) => value.includes(p))}
          onClick={() => onChange(value.filter((p) => !shown.includes(p)))}
        >
          取消匹配项 / Deselect matching
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!value.length}
          onClick={() => onChange([])}
        >
          清空 / Clear
        </button>
      </div>
      <div className="permission-choices">
        {shown.map((permission) => (
          <label className="check-label" key={permission}>
            <input
              type="checkbox"
              checked={value.includes(permission)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, permission]
                    : value.filter((p) => p !== permission),
                )
              }
            />
            <code>{permission}</code>
          </label>
        ))}
      </div>
      {!shown.length && <p className="muted">没有匹配权限 / No matches</p>}
      <small>{value.length} 项已选择 / selected</small>
      {catalog.isError && (
        <small className="error-text">
          权限目录加载失败 / Failed to load permissions
        </small>
      )}
    </div>
  );
}

const referenceEndpoints: Record<string, string> = {
  associated_tools: "/v1/tools",
  associated_resources: "/v1/resources",
  associated_prompts: "/v1/prompts",
  associated_a2a_agents: "/v1/a2a",
  plugin_ids: "/v1/admin/plugins",
};
export function ResourcePicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const query = useQuery({
    queryKey: ["association-options", name],
    queryFn: async () => {
      const out: JsonRecord[] = [];
      const seen = new Set<string>();
      let cursor = "";
      for (let page = 0; page < 100; page++) {
        const q = new URLSearchParams({
          limit: "100",
          offset: String(page * 100),
          include_pagination: "true",
        });
        if (cursor) q.set("cursor", cursor);
        const data = await request(referenceEndpoints[name] + "?" + q);
        const items = listItems(data).map((item: JsonRecord) =>
          name === "plugin_ids" ? { ...item, id: item.name } : item,
        );
        if (
          items.length &&
          items.every((item: JsonRecord) =>
            out.some((prev) => prev.id === item.id),
          )
        )
          return [...new Map(out.map((v) => [v.id, v])).values()];
        out.push(...items);
        const next = data?.nextCursor || data?.next_cursor;
        if (next) {
          if (seen.has(next)) throw new Error("分页游标重复");
          seen.add(next);
          cursor = next;
        } else if (
          items.length < 100 ||
          (data.total !== undefined && out.length >= data.total)
        )
          return [...new Map(out.map((v) => [v.id, v])).values()];
      }
      throw new Error("选项过多，请使用全部操作指定精确关联");
    },
    retry: false,
  });
  const options = query.data || [];
  const shown = options.filter((v) =>
    `${v.name} ${v.id} ${v.description || ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <div className="permission-picker">
      <input
        aria-label={`Search ${name}`}
        value={filter}
        placeholder="搜索名称或 ID / Search"
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="picker-actions">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onChange([...new Set([...value, ...shown.map((v) => v.id)])])
          }
        >
          全选匹配项 ({shown.length})
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onChange(value.filter((v) => !shown.some((item) => item.id === v)))
          }
        >
          取消匹配项
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([])}
        >
          清空
        </button>
      </div>
      {query.isPending ? (
        <p>正在加载…</p>
      ) : query.isError ? (
        <p className="error-text">
          可选资源加载失败{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => query.refetch()}
          >
            重试
          </button>
        </p>
      ) : (
        <div className="permission-choices">
          {shown.map((item) => (
            <label key={item.id} className="check-label">
              <input
                type="checkbox"
                checked={value.includes(item.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, item.id]
                      : value.filter((v) => v !== item.id),
                  )
                }
              />
              <span>
                {item.name || item.id}
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {!query.isPending && !query.isError && !shown.length && (
        <p className="muted">没有匹配资源；请先在对应栏目创建。</p>
      )}
      {value
        .filter((v) => !options.some((item) => item.id === v))
        .map((id) => (
          <label key={id} className="check-label">
            <input
              type="checkbox"
              checked
              onChange={() => onChange(value.filter((v) => v !== id))}
            />
            {id}（当前目录中不可见）
          </label>
        ))}
      <small>已选择 {value.length} 项</small>
    </div>
  );
}

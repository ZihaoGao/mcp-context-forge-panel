import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listItems } from "../../../../packages/api-client/contract.mjs";
import {
  request,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext, useText } from "../session";
import {
  loadAssociationOptions,
  filterAssociationOptions,
} from "../association-model.mjs";
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
  const t = useText();
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
        aria-label={t(`搜索 ${name} 选项`, `Search ${name} choices`)}
        placeholder={t("搜索名称或 ID", "Search name or ID")}
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
          {data.isPending
            ? t("正在加载…", "Loading…")
            : t("不指定", "Not specified")}
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
        <small className="error-text">
          {t(
            "无法加载可选项，请检查权限后重试。",
            "Could not load options. Check permissions and retry.",
          )}
        </small>
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
  const t = useText();
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
        aria-label={t("筛选权限选项", "Filter permission choices")}
        placeholder={t("搜索权限", "Search permissions")}
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
          {t("全选匹配项", "Select matching")} ({shown.length})
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!shown.some((p) => value.includes(p))}
          onClick={() => onChange(value.filter((p) => !shown.includes(p)))}
        >
          {t("取消匹配项", "Deselect matching")}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!value.length}
          onClick={() => onChange([])}
        >
          {t("清空", "Clear")}
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
      {!shown.length && (
        <p className="muted">{t("没有匹配权限", "No matching permissions")}</p>
      )}
      <small>
        {t(`已选择 ${value.length} 项`, `${value.length} selected`)}
      </small>
      {catalog.isError && (
        <small className="error-text">
          {t("权限目录加载失败", "Failed to load permissions")}
        </small>
      )}
    </div>
  );
}

export function ResourcePicker({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: JsonRecord;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useText();
  const { user, team } = useContext(SessionContext);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState("all");
  const query = useQuery({
    queryKey: ["association-options", name, user?.email, team],
    queryFn: ({ signal }) =>
      loadAssociationOptions(name, spec, request, signal),
    retry: false,
  });
  // Failed refetches must not expose stale results as a complete catalog.
  const options: JsonRecord[] = query.isError ? [] : query.data || [];
  const shown = filterAssociationOptions(options, value, filter, selection);
  const unavailable = value.filter(
    (id) => !options.some((item) => item.id === id),
  );
  return (
    <div className="permission-picker">
      <input
        aria-label={t(`搜索 ${name}`, `Search ${name}`)}
        value={filter}
        placeholder={t("搜索名称、说明或 ID", "Search name, description or ID")}
        onChange={(e) => setFilter(e.target.value)}
      />
      <select
        aria-label={t(`选择状态 ${name}`, `Selection status ${name}`)}
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
      >
        <option value="all">{t("全部选项", "All options")}</option>
        <option value="selected">{t("仅已选", "Selected only")}</option>
        <option value="unselected">{t("仅未选", "Unselected only")}</option>
      </select>
      <div className="picker-actions">
        <button
          type="button"
          className="text-button"
          disabled={query.isPending || query.isError || !shown.length}
          onClick={() =>
            onChange([
              ...new Set([
                ...value,
                ...shown.map((item: JsonRecord) => item.id),
              ]),
            ])
          }
        >
          {t("全选匹配项", "Select matching")} ({shown.length})
        </button>
        <button
          type="button"
          className="text-button"
          disabled={
            query.isPending ||
            query.isError ||
            !shown.some((item: JsonRecord) => value.includes(item.id))
          }
          onClick={() =>
            onChange(
              value.filter(
                (id) => !shown.some((item: JsonRecord) => item.id === id),
              ),
            )
          }
        >
          {t("取消匹配项", "Deselect matching")}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!value.length}
          onClick={() => onChange([])}
        >
          {t("清空", "Clear")}
        </button>
      </div>
      {query.isPending ? (
        <p>{t("正在加载…", "Loading…")}</p>
      ) : query.isError ? (
        <p className="error-text" role="alert">
          {t(
            "可选资源未能完整加载，已有选择已保留。",
            "Could not load the complete resource catalog. Existing selections are retained.",
          )}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => query.refetch()}
          >
            {t("重试", "Retry")}
          </button>
        </p>
      ) : (
        <div className="permission-choices">
          {shown.map((item: JsonRecord) => (
            <label key={item.id} className="check-label">
              <input
                type="checkbox"
                aria-label={`${item.name || item.id} · ${item.id}`}
                checked={value.includes(item.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...new Set([...value, item.id])]
                      : value.filter((id) => id !== item.id),
                  )
                }
              />
              <span>
                {item.name || item.id}
                <small>
                  {item.id}
                  {item.gatewaySlug || item.gatewayId || item.gateway_id
                    ? ` · ${t("来源", "Source")}: ${item.gatewaySlug || item.gatewayId || item.gateway_id}`
                    : ""}
                </small>
                {item.description && <small>{item.description}</small>}
              </span>
            </label>
          ))}
        </div>
      )}
      {!query.isPending && !query.isError && !shown.length && (
        <p className="muted">
          {t(
            "没有匹配选项，请调整筛选条件。",
            "No matching options. Adjust the filters.",
          )}
        </p>
      )}
      {!!unavailable.length && (
        <div className="permission-choices">
          {unavailable.map((id) => (
            <label key={id} className="check-label">
              <input
                type="checkbox"
                checked
                aria-label={id}
                onChange={() =>
                  onChange(value.filter((selected) => selected !== id))
                }
              />
              <span>
                {id}
                <small>
                  {query.isPending || query.isError
                    ? t(
                        "已有选择，目录尚未加载完成",
                        "Existing selection; catalog not fully loaded",
                      )
                    : t(
                        "当前目录中不可见，保留此关联",
                        "Not visible in the current catalog; association retained",
                      )}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
      <small aria-live="polite">
        {t(`已选择 ${value.length} 项`, `${value.length} selected`)}
      </small>
    </div>
  );
}

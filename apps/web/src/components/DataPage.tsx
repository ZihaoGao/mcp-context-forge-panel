import { WorkflowDialog } from "./WorkflowDialog";
import { ResourceTags } from "./ResourceTags";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { SessionContext } from "../session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  RefreshCw,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Power,
  Check,
  X,
  Download,
  List,
  LayoutGrid,
  KeyRound,
  Copy,
} from "lucide-react";
import {
  config,
  request,
  send,
  displayError,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import {
  initialValue,
  listItems,
  operations,
  recordId,
  resolveSchema,
  runBatch,
} from "../../../../packages/api-client/contract.mjs";
import { type Module } from "../modules";
import { type Operation } from "./ActionDialog";
import { ResourceDialog, resourceActionName } from "./ResourceDialog";
import { TransferPanel } from "./TransferPanel";
import { GovernancePage } from "./GovernancePage";
import { resourceProfiles, validateValue } from "../resource-model.mjs";
import { englishProfiles } from "../resource-copy.mjs";
import { SchemaForm } from "./SchemaForm";
import { ConfigurationTransfer } from "./ConfigurationTransfer";
import { ApiExplorer } from "./ApiExplorer";
import { RowActionMenu } from "./RowActionMenu";
import { McpConnection } from "./Connections";
import {
  listPath as resourceListPath,
  pagination,
  loadResourcePages,
  matchesResource,
  resourceStatus as status,
} from "../list-model.mjs";

export function findOperation(
  spec: JsonRecord,
  path: string,
  method: string,
): Operation | undefined {
  const found =
    spec.paths?.[path]?.[method.toLowerCase()] ||
    spec.paths?.[path + "/"]?.[method.toLowerCase()];
  if (!found) return undefined;
  return {
    ...found,
    path: spec.paths[path]?.[method.toLowerCase()] ? path : path + "/",
    method: method.toUpperCase(),
  };
}
function title(item: JsonRecord) {
  return item.name || item.full_name || item.email || item.uri || item.id;
}

export function DataPage({
  module,
  spec,
  permissions,
  team,
  en = false,
  teams = [],
  onTeamChange,
}: {
  module: Module;
  spec: JsonRecord;
  permissions: string[];
  team: string;
  en?: boolean;
  teams?: JsonRecord[];
  onTeamChange?: (team: string) => void;
}) {
  const client = useQueryClient();
  const session = useContext(SessionContext);
  const [tab, setTab] = useState("list");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<JsonRecord[]>([]);
  const [operation, setOperation] = useState<Operation>();
  const [initial, setInitial] = useState<JsonRecord>();
  const [preset, setPreset] = useState<Record<string, string>>({});
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  const [gridChoice, setGridChoice] = useState<boolean>();
  const grid = gridChoice ?? compact;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [busy, setBusy] = useState(false);
  const [batchAction, setBatchAction] = useState("");
  const [batchResults, setBatchResults] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [patch, setPatch] = useState("{}");
  const [connection, setConnection] = useState<JsonRecord>();
  const [activeItem, setActiveItem] = useState<JsonRecord>();
  const [mode, setMode] = useState<"create" | "edit" | "action" | "detail">(
    "action",
  );
  const [transfer, setTransfer] = useState(false);
  const list = findOperation(spec, module.path, "GET");
  const create = findOperation(spec, module.path, "POST");
  const ops = useMemo(() => operations(spec) as Operation[], [spec]);
  const detailOps = ops.filter(
    (o) =>
      o.path.startsWith(module.path.replace(/\/$/, "") + "/{") &&
      o.classification.kind === "business" &&
      o["x-panel-available"] !== false &&
      !/\/(sse|mcp|message)(\/|$)/.test(o.path),
  );
  const primaryDetail = detailOps.find(
    (o) =>
      o.method === "GET" &&
      o.path.split("/").length === module.path.split("/").length + 1,
  );
  const update = detailOps.find(
    (o) =>
      ["PUT", "PATCH"].includes(o.method) &&
      o.path.split("/").length === module.path.split("/").length + 1,
  );
  const remove = detailOps.find(
    (o) =>
      o.method === "DELETE" &&
      o.path.split("/").length === module.path.split("/").length + 1,
  );
  const toggle = detailOps.find((o) => o.path.endsWith("/state"));
  const canToggle =
    !!toggle &&
    (!toggle["x-panel-admin"] || session.user?.is_admin) &&
    permitted(
      permissions,
      toggle["x-panel-permission"] || `${module.permission}.update`,
    );
  const transferWrite =
    create ||
    (module.id === "plugins"
      ? update
      : module.id === "catalog"
        ? detailOps.find(
            (o) => o.method === "POST" && o.path.endsWith("/register"),
          )
        : undefined);
  const mayImport =
    transferWrite &&
    (!transferWrite["x-panel-admin"] || session.user?.is_admin) &&
    permitted(
      permissions,
      transferWrite["x-panel-permission"] || module.permission,
    );
  const can = (action: string) => {
    const op =
      action === "read"
        ? list
        : action === "create"
          ? create
          : action === "update"
            ? update
            : remove;
    if (op?.["x-panel-admin"] && !session.user?.is_admin) return false;
    if (op?.["x-panel-available"] === false) return false;
    if (op?.["x-panel-permission"])
      return permitted(permissions, op["x-panel-permission"]);
    return permitted(
      permissions,
      module.permission?.includes(".")
        ? module.permission
        : module.permission
          ? `${module.permission}.${action}`
          : undefined,
    );
  };
  const profile = (resourceProfiles as Record<string, any>)[module.id];
  const hasVisibility = profile?.fields?.includes("visibility");
  const hasTeam =
    profile?.fields?.some((field: string) =>
      ["team_id", "teamId"].includes(field),
    ) || module.id === "tokens";
  const hasStatus =
    !!toggle || ["tokens", "users", "llm", "plugins"].includes(module.id);
  const filters = {
    search,
    state: stateFilter,
    visibility: visibilityFilter,
    team: hasTeam ? team : "",
  };
  const filterKey = JSON.stringify(filters);
  const currentFilters = useRef(filterKey);
  currentFilters.current = filterKey;
  const searching = !!(
    search.trim() ||
    stateFilter ||
    visibilityFilter ||
    (team && hasTeam)
  );
  function listPath(nextCursor = "", nextPage = 0) {
    return resourceListPath(list!, {
      team,
      cursor: nextCursor,
      page: nextPage,
    });
  }
  const query = useQuery({
    queryKey: ["list", module.id, team, cursor, page],
    queryFn: ({ signal }) => request(listPath(cursor, page), { signal }),
    enabled: !!list && can("read") && !module.actionsOnly && !searching,
    retry: false,
  });
  const allQuery = useQuery({
    queryKey: ["list", module.id, team, "all", visibilityFilter],
    queryFn: ({ signal }) =>
      loadResourcePages(list!, request, {
        team,
        visibility: visibilityFilter,
        signal,
      }),
    enabled: !!list && can("read") && !module.actionsOnly && searching,
    retry: false,
  });
  const activeQuery = searching ? allQuery : query;
  const items = listItems(query.data) as JsonRecord[];
  const allMatches = ((allQuery.data || []) as JsonRecord[]).filter((item) =>
    matchesResource(item, filters),
  );
  const filtered = searching
    ? allMatches.slice(page * 25, (page + 1) * 25)
    : items;
  const pageInfo = list
    ? pagination(query.data, list, page)
    : { nextCursor: "", total: undefined, hasNext: false };
  const nextCursor = searching ? "" : pageInfo.nextCursor;
  const total = searching ? allMatches.length : pageInfo.total;
  const hasNext = searching
    ? (page + 1) * 25 < allMatches.length
    : pageInfo.hasNext;
  useEffect(() => {
    setCursor("");
    setHistory([]);
    setPage(0);
    setSelected([]);
    setBatchAction("");
    setBatchResults([]);
    setError("");
  }, [team, search, stateFilter, visibilityFilter]);
  useEffect(() => {
    if (searching && allQuery.isSuccess && page > 0) {
      const last = Math.max(0, Math.ceil(allMatches.length / 25) - 1);
      if (page > last) setPage(last);
    }
  }, [searching, allQuery.data, allQuery.isSuccess, page, allMatches.length]);
  function refresh() {
    void client.invalidateQueries({ queryKey: ["list", module.id] });
    void client.invalidateQueries({ queryKey: ["reference-options"] });
    void client.invalidateQueries({ queryKey: ["association-options"] });
    if (module.id === "rbac")
      void client.invalidateQueries({ queryKey: ["role-catalog"] });
    if (module.id === "teams")
      void client.invalidateQueries({ queryKey: ["my-teams"] });
  }
  function launch(op: Operation, item?: JsonRecord, edit = false) {
    setError("");
    setOperation(op);
    setActiveItem(item);
    setMode(
      op === create
        ? "create"
        : edit || op === update
          ? "edit"
          : op.method === "GET" &&
              (op.parameters || []).filter((p: any) => p.in === "path")
                .length <= 1
            ? "detail"
            : "action",
    );
    setInitial(undefined);
    setPreset(
      Object.fromEntries(
        (op.parameters || [])
          .filter((p: any) => p.in === "path")
          .slice(0, 1)
          .map((p: any) => [
            p.name,
            String(
              item
                ? p.name === "user_email"
                  ? item.email
                  : recordId(item)
                : "",
            ),
          ]),
      ),
    );
    if (edit && item) {
      const schema = resolveSchema(
        op.requestBody?.content?.["application/json"]?.schema,
        spec,
      );
      const wrapper = [
        "tool",
        "resource",
        "prompt",
        "gateway",
        "server",
        "agent",
      ].find((k) => schema.properties?.[k]);
      const fields =
        resolveSchema(wrapper ? schema.properties[wrapper] : schema, spec)
          .properties || {};
      const value = Object.fromEntries(
        Object.keys(fields)
          .filter((k) => item[k] !== undefined)
          .map((k) => [k, item[k]]),
      );
      setInitial(wrapper ? { [wrapper]: value } : value);
    }
    if (!edit && op === create && team)
      setInitial({
        ...initialValue(
          op.requestBody?.content?.["application/json"]?.schema,
          spec,
        ),
        team_id: team,
      });
  }
  async function selectAll() {
    setBusy(true);
    setError("");
    const scope = filterKey;
    try {
      const all = await client.fetchQuery({
        queryKey: ["list", module.id, team, "all", visibilityFilter],
        queryFn: ({ signal }) =>
          loadResourcePages(list!, request, {
            team,
            visibility: visibilityFilter,
            signal,
          }),
        staleTime: 0,
      });
      if (currentFilters.current !== scope)
        throw new Error(
          en
            ? "Filters changed. Select again."
            : "筛选条件已变更，请重新选择。",
        );
      const matches = all.filter((item: JsonRecord) =>
        matchesResource(item, filters),
      );
      setSelected(matches);
      return matches;
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function executeBatch(targets = selected) {
    if (busy) return;
    setBusy(true);
    setError("");
    setBatchResults([]);
    try {
      const patchValue = batchAction === "update" ? JSON.parse(patch) : null;
      if (
        patchValue &&
        (Array.isArray(patchValue) || typeof patchValue !== "object")
      )
        throw new Error("Patch must be a JSON object");
      if (batchAction === "update") {
        if (!Object.keys(patchValue).length)
          throw new Error("请先选择至少一个要修改的字段");
        const errors = validateValue(
          patchValue,
          { type: "object", properties: batchFields },
          spec,
        );
        if (errors.length) throw new Error(errors.join("；"));
      }
      const op =
        batchAction === "delete"
          ? remove
          : batchAction === "update"
            ? update
            : toggle;
      if (!op) throw new Error("Operation not supported");
      const results = await runBatch(
        targets,
        async (item: JsonRecord) => {
          let path = op.path.replace(
            /\{[^}]+\}/g,
            encodeURIComponent(
              String(module.id === "users" ? item.email : recordId(item)),
            ),
          );
          let body: any;
          if (batchAction === "update") {
            const schema = resolveSchema(
              op.requestBody?.content?.["application/json"]?.schema,
              spec,
            );
            const wrapper = [
              "tool",
              "resource",
              "prompt",
              "gateway",
              "server",
              "agent",
            ].find((k) => schema.properties?.[k]);
            body = wrapper ? { [wrapper]: patchValue } : patchValue;
          } else if (batchAction !== "delete") {
            const active = batchAction === "enable";
            if (op.parameters?.some((p: any) => p.name === "activate"))
              path += "?activate=" + active;
            else body = { enabled: active, is_active: active };
          }
          await send(path, op.method, body);
        },
        {
          concurrency: 3,
          onResult: (result: JsonRecord) =>
            setBatchResults((prev) => [...prev, result]),
        },
      );
      setSelected(results.filter((r: any) => !r.ok).map((r: any) => r.item));
      refresh();
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  function exportSelected() {
    setTransfer(true);
  }
  const batchSchema = resolveSchema(
    update?.requestBody?.content?.["application/json"]?.schema,
    spec,
  );
  const batchWrapper = [
    "server",
    "tool",
    "resource",
    "prompt",
    "gateway",
    "agent",
  ].find((k) => batchSchema.properties?.[k]);
  const batchFields =
    resolveSchema(
      batchWrapper ? batchSchema.properties[batchWrapper] : batchSchema,
      spec,
    ).properties || {};
  const editableBatchKeys = [
    "description",
    "visibility",
    "tags",
    "team_id",
    "teamId",
    "enabled",
    "is_active",
    "max_members",
    "expires_in_days",
  ].filter((k) => batchFields[k]);
  return (
    <>
      <div className="tabs">
        <button
          className={tab === "list" ? "active" : ""}
          onClick={() => setTab("list")}
        >
          {en ? "Overview" : "资源列表"}
        </button>
        <button
          className={tab === "actions" ? "active" : ""}
          onClick={() => setTab("actions")}
        >
          {en ? "All actions" : "全部操作"}
          <span className="tab-count">
            {
              ops.filter(
                (o) =>
                  o.path.startsWith(module.path) &&
                  o.classification.kind !== "excluded",
              ).length
            }
          </span>
        </button>
      </div>
      {tab === "actions" ? (
        <ApiExplorer spec={spec} filter={module.path} en={en} />
      ) : ["logs", "settings", "observability"].includes(module.id) ? (
        <>
          <GovernancePage moduleId={module.id} spec={spec} en={en} />
          {module.id === "settings" && <ConfigurationTransfer spec={spec} />}
        </>
      ) : (
        <>
          {module.id === "tokens" && (
            <div className="info-banner">
              <KeyRound size={20} />
              <div>
                <strong>
                  {en
                    ? "Give applications access within your permissions"
                    : "让应用安全地使用你有权访问的工具"}
                </strong>
                <p>
                  {en
                    ? "Create a key scoped to your team or virtual server. Copy the key when it is created."
                    : "选择团队和虚拟服务器，设置权限与有效期。Key 明文仅在创建时显示。"}
                </p>
              </div>
            </div>
          )}
          <section className="panel">
            <div className="toolbar">
              <label className="search-field">
                <Search size={17} />
                <input
                  aria-label="Filter resources"
                  placeholder={
                    en
                      ? "Search all pages by name, description, tags or ID…"
                      : "跨页搜索名称、描述、标签或 ID…"
                  }
                  disabled={busy}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <span className="muted">
                {activeQuery.error
                  ? "—"
                  : activeQuery.isPending
                    ? "…"
                    : (total ?? filtered.length)}{" "}
                {en ? "items" : "项"}
              </span>
              <div className="toolbar-right">
                <button
                  className="button secondary"
                  onClick={() => setTransfer(true)}
                >
                  <Download size={16} />
                  {en ? "Import / export" : "导入 / 导出"}
                </button>
                <button
                  className="icon-button"
                  aria-label="Refresh"
                  onClick={refresh}
                >
                  <RefreshCw
                    size={17}
                    className={activeQuery.isFetching ? "spinning" : ""}
                  />
                </button>
                <button
                  className="icon-button"
                  aria-label="Toggle layout"
                  onClick={() => setGridChoice(!grid)}
                >
                  {grid ? <List size={18} /> : <LayoutGrid size={18} />}
                </button>
                {create && can("create") && (
                  <button
                    className="button primary"
                    onClick={() => launch(create)}
                  >
                    <Plus size={16} />
                    {en
                      ? "Create"
                      : module.id === "tokens"
                        ? "创建 API Key"
                        : "新建"}
                  </button>
                )}
              </div>
            </div>
            <div className="resource-filters">
              {hasStatus && (
                <label className="field">
                  <span>{en ? "Status" : "状态"}</span>
                  <select
                    aria-label="Resource status"
                    disabled={busy}
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                  >
                    <option value="">{en ? "All statuses" : "全部状态"}</option>
                    <option value="enabled">{en ? "Enabled" : "已启用"}</option>
                    <option value="disabled">
                      {en ? "Disabled" : "已停用"}
                    </option>
                  </select>
                </label>
              )}
              {hasVisibility && (
                <label className="field">
                  <span>{en ? "Visibility" : "可见性"}</span>
                  <select
                    aria-label="Resource visibility"
                    disabled={busy}
                    value={visibilityFilter}
                    onChange={(e) => setVisibilityFilter(e.target.value)}
                  >
                    <option value="">
                      {en ? "All visibility" : "全部可见性"}
                    </option>
                    <option value="private">{en ? "Private" : "仅自己"}</option>
                    <option value="team">{en ? "Team" : "所属团队"}</option>
                    <option value="public">
                      {en ? "Public" : "所有获准用户"}
                    </option>
                  </select>
                </label>
              )}
              {hasTeam && onTeamChange && (
                <label className="field">
                  <span>{en ? "Team" : "团队"}</span>
                  <select
                    aria-label="Resource team"
                    disabled={busy}
                    value={team}
                    onChange={(e) => onTeamChange(e.target.value)}
                  >
                    <option value="">
                      {en ? "All accessible teams" : "所有可访问团队"}
                    </option>
                    {teams.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {searching && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setSearch("");
                    setStateFilter("");
                    setVisibilityFilter("");
                    onTeamChange?.("");
                  }}
                >
                  {en ? "Clear filters" : "清除筛选"}
                </button>
              )}
            </div>
            {searching && (
              <p className="resource-search-help field-help" role="status">
                {activeQuery.error
                  ? en
                    ? "Search incomplete. Retry before selecting results."
                    : "查找未完成，请重试后再选择结果。"
                  : activeQuery.isFetching
                    ? en
                      ? "Searching accessible resources across pages…"
                      : "正在跨页查找可访问资源…"
                    : en
                      ? "Search and filters cover all accessible pages in the selected team scope (up to 10,000 resources)."
                      : "搜索和筛选覆盖所选团队范围内的全部可访问页（最多 10000 项）。"}
              </p>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {activeQuery.error && (
              <div className="alert error" role="alert">
                {displayError(activeQuery.error)}
                <button className="text-button" onClick={refresh}>
                  {en ? "Retry" : "重试"}
                </button>
              </div>
            )}
            {!can("read") ? (
              <div className="empty">
                <h3>{en ? "Permission required" : "没有查看权限"}</h3>
                <p>
                  {en
                    ? "Contact your team administrator."
                    : "请联系团队管理员分配相应角色。"}
                </p>
              </div>
            ) : !list ? (
              <div className="empty">
                <h3>{en ? "Feature unavailable" : "当前后端未启用此功能"}</h3>
                <p>
                  {en
                    ? "Inspect all actions for available capabilities."
                    : "可在全部操作中查看当前提供的能力。"}
                </p>
              </div>
            ) : activeQuery.isPending || activeQuery.error ? (
              <div className="empty">
                <RefreshCw
                  className={activeQuery.isPending ? "spinning" : ""}
                />
                <p>
                  {activeQuery.error
                    ? en
                      ? "Search failed. Retry to obtain complete results."
                      : "查找失败，请重试以获取完整结果。"
                    : en
                      ? "Loading…"
                      : "正在加载…"}
                </p>
              </div>
            ) : !filtered.length ? (
              <div className="empty">
                <module.icon size={34} />
                <h3>
                  {en
                    ? "No resources yet"
                    : searching
                      ? "没有匹配的资源"
                      : "还没有资源"}
                </h3>
                <p>
                  {en
                    ? "Create a resource or adjust your filters."
                    : searching
                      ? "尝试调整筛选条件。"
                      : "创建第一个资源，或切换团队查看已有资源。"}
                </p>
                {create && can("create") && (
                  <button
                    className="button secondary"
                    onClick={() => launch(create)}
                  >
                    <Plus size={15} />
                    {en ? "Create resource" : "创建资源"}
                  </button>
                )}
              </div>
            ) : grid ? (
              <div className="resource-grid">
                {filtered.map((item) => (
                  <article className="resource-card" key={recordId(item)}>
                    <div className="section-heading">
                      <module.icon size={22} />
                      <input
                        type="checkbox"
                        aria-label={`Select ${title(item)}`}
                        checked={selected.some(
                          (v) => recordId(v) === recordId(item),
                        )}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, item]
                              : prev.filter(
                                  (v) => recordId(v) !== recordId(item),
                                ),
                          )
                        }
                      />
                    </div>
                    <h3>{title(item)}</h3>
                    <p>{item.description || "—"}</p>
                    <ResourceTags tags={item.tags} en={en} />
                    <span
                      className={`badge ${status(item) === false ? "neutral" : "success"}`}
                    >
                      {status(item) === false
                        ? en
                          ? "Disabled"
                          : "已停用"
                        : en
                          ? "Available"
                          : "可用"}
                    </span>
                    <div className="card-footer">
                      {(primaryDetail || list) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            launch(
                              primaryDetail || {
                                ...list!,
                                "x-panel-local-detail": true,
                              },
                              item,
                            )
                          }
                        >
                          {en ? "Details" : "查看详情"}
                          <ArrowUpRight size={14} />
                        </button>
                      )}
                      {update && can("update") && (
                        <button
                          className="text-button"
                          onClick={() => launch(update, item, true)}
                        >
                          {en ? "Edit" : "编辑"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="checkbox-cell">
                        <input
                          type="checkbox"
                          aria-label="Select page"
                          checked={
                            !!filtered.length &&
                            filtered.every((item) =>
                              selected.some(
                                (v) => recordId(v) === recordId(item),
                              ),
                            )
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [
                                    ...new Map(
                                      [...selected, ...filtered].map((item) => [
                                        recordId(item),
                                        item,
                                      ]),
                                    ).values(),
                                  ]
                                : selected.filter(
                                    (item) =>
                                      !filtered.some(
                                        (v) => recordId(item) === recordId(v),
                                      ),
                                  ),
                            )
                          }
                        />
                      </th>
                      <th>{en ? "Name" : "名称"}</th>
                      <th>{en ? "Status" : "状态"}</th>
                      <th>
                        {en
                          ? "Scope / type"
                          : (
                              {
                                llm: "供应商类型",
                                plugins: "运行模式",
                                catalog: "服务分类",
                                users: "账户类型",
                              } as Record<string, string>
                            )[module.id] || "可见性 / 范围"}
                      </th>
                      <th>{en ? "Updated / created" : "更新 / 创建时间"}</th>
                      <th>{en ? "Actions" : "操作"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={recordId(item)}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${title(item)}`}
                            checked={selected.some(
                              (v) => recordId(v) === recordId(item),
                            )}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...prev, item]
                                  : prev.filter(
                                      (v) => recordId(v) !== recordId(item),
                                    ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <div className="resource-name">
                            <span className="resource-symbol">
                              <module.icon size={17} />
                            </span>
                            <div>
                              <button
                                className="name-button"
                                onClick={() =>
                                  launch(
                                    primaryDetail || {
                                      ...list!,
                                      "x-panel-local-detail": true,
                                    },
                                    item,
                                  )
                                }
                              >
                                {title(item)}
                              </button>
                              <small>
                                {item.description ||
                                  item.email ||
                                  item.id ||
                                  "—"}
                              </small>
                              <ResourceTags tags={item.tags} en={en} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${status(item) === false ? "neutral" : "success"}`}
                          >
                            <span className="status-dot" />
                            {status(item) === false
                              ? en
                                ? "Disabled"
                                : "已停用"
                              : en
                                ? "Available"
                                : "可用"}
                          </span>
                        </td>
                        <td>
                          <span className="badge neutral">
                            {item.visibility ||
                              (typeof item.scope === "string"
                                ? item.scope
                                : undefined) ||
                              item.provider_type ||
                              item.mode ||
                              item.category ||
                              (module.id === "users"
                                ? item.is_admin
                                  ? "管理员"
                                  : "普通用户"
                                : undefined) ||
                              item.team_id ||
                              (en ? "Personal" : "个人")}
                          </span>
                        </td>
                        <td className="muted">
                          {item.updated_at ||
                          item.created_at ||
                          item.updatedAt ||
                          item.createdAt
                            ? new Date(
                                item.updated_at ||
                                  item.created_at ||
                                  item.updatedAt ||
                                  item.createdAt,
                              ).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          <div className="row-actions">
                            {update && can("update") && (
                              <button
                                className="text-button"
                                onClick={() => launch(update, item, true)}
                              >
                                {en ? "Edit" : "编辑"}
                              </button>
                            )}
                            {module.id === "servers" && (
                              <button
                                className="icon-button"
                                aria-label="Connection"
                                onClick={() => setConnection(item)}
                              >
                                <Copy size={15} />
                              </button>
                            )}
                            <RowActionMenu
                              items={detailOps
                                .filter(
                                  (op) =>
                                    op !== primaryDetail &&
                                    op !== update &&
                                    (!op["x-panel-admin"] ||
                                      session.user?.is_admin) &&
                                    permitted(
                                      permissions,
                                      op["x-panel-permission"],
                                    ) &&
                                    op["x-panel-available"] !== false,
                                )
                                .map((op) => ({
                                  id: op.method + op.path,
                                  label: resourceActionName(
                                    op,
                                    en
                                      ? (
                                          englishProfiles as Record<
                                            string,
                                            string[]
                                          >
                                        )[module.id]?.[0] || "resource"
                                      : (
                                          resourceProfiles as Record<
                                            string,
                                            any
                                          >
                                        )[module.id]?.noun || "资源",
                                    en,
                                  ),
                                  onSelect: () => launch(op, item),
                                }))}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {list && (
              <footer className="table-footer">
                <span>
                  {en ? "Page" : "第"} {page + 1} {en ? "" : "页"} ·{" "}
                  {filtered.length} {en ? "visible" : "项可见"}
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={!page}
                    onClick={() => {
                      setCursor(history[page - 1] || "");
                      setPage(page - 1);
                    }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={!hasNext}
                    onClick={() => {
                      setHistory((h) => [...h.slice(0, page), cursor]);
                      setCursor(nextCursor);
                      setPage(page + 1);
                    }}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </footer>
            )}
          </section>
          {transfer && (
            <TransferPanel
              onClose={() => setTransfer(false)}
              moduleId={module.id}
              spec={spec}
              create={mayImport ? transferWrite : undefined}
              detail={primaryDetail}
              records={selected.length ? selected : filtered}
              loadAll={selectAll}
              onSuccess={refresh}
              en={en}
            />
          )}
          {selected.length > 0 && (
            <div className="bulk-bar">
              <strong>
                {en
                  ? `${selected.length} selected`
                  : `已选择 ${selected.length} 项`}
              </strong>
              <button
                className="text-button"
                disabled={busy}
                onClick={selectAll}
              >
                {en ? "Select all matching pages" : "选择跨页全部匹配项"}
              </button>
              <button
                className="icon-button"
                aria-label="Export selected"
                onClick={exportSelected}
              >
                <Download size={17} />
              </button>
              {canToggle && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => setBatchAction("enable")}
                  >
                    <Power size={15} />
                    {en ? "Enable" : "启用"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setBatchAction("disable")}
                  >
                    {en ? "Disable" : "停用"}
                  </button>
                </>
              )}
              {update && can("update") && (
                <button
                  className="button secondary"
                  onClick={() => setBatchAction("update")}
                >
                  {en ? "Bulk edit" : "批量修改"}
                </button>
              )}
              {remove && can(module.id === "tokens" ? "revoke" : "delete") && (
                <button
                  className="button danger-outline"
                  onClick={() => setBatchAction("delete")}
                >
                  <Trash2 size={15} />
                  {en ? "Delete / revoke" : "删除 / 撤销"}
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Clear selection"
                disabled={busy}
                onClick={() => setSelected([])}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {batchAction && (
            <WorkflowDialog
              title={`${en ? "Review bulk action" : "确认批量操作"} · ${batchAction}`}
              footer={
                <button
                  className="button primary"
                  disabled={busy || !selected.length}
                  onClick={() => executeBatch()}
                >
                  {busy
                    ? en
                      ? "Running…"
                      : "执行中…"
                    : batchResults.length
                      ? en
                        ? "Retry failed targets"
                        : "重试失败项"
                      : en
                        ? "Confirm execution"
                        : "确认执行"}
                </button>
              }
              className="batch-panel"
              closeLabel="Close batch"
              en={en}
              busy={busy}
              onClose={() => {
                setBatchAction("");
                setBatchResults([]);
                setError("");
              }}
            >
              {error && (
                <div role="alert" className="alert error">
                  {error}
                </div>
              )}
              <p className="muted">
                {en
                  ? `${selected.length} frozen targets. Individual calls can partially succeed.`
                  : `已确定 ${selected.length} 个目标。逐项执行，可能部分成功；不支持事务回滚。`}
              </p>
              {batchAction === "update" && (
                <div className="field">
                  <span>选择要统一修改的字段；未选择的字段保持不变</span>
                  <div className="picker-actions">
                    {editableBatchKeys.map((k) => (
                      <label key={k} className="check-label">
                        <input
                          type="checkbox"
                          checked={Object.hasOwn(JSON.parse(patch), k)}
                          onChange={(e) => {
                            const v = JSON.parse(patch);
                            if (e.target.checked)
                              v[k] =
                                resolveSchema(batchFields[k], spec).type ===
                                "array"
                                  ? []
                                  : "";
                            else delete v[k];
                            setPatch(JSON.stringify(v));
                          }}
                        />
                        {k}
                      </label>
                    ))}
                  </div>
                  <SchemaForm
                    all
                    schema={{
                      type: "object",
                      properties: Object.fromEntries(
                        Object.keys(JSON.parse(patch))
                          .filter((k) => batchFields[k])
                          .map((k) => [k, batchFields[k]]),
                      ),
                    }}
                    spec={spec}
                    value={JSON.parse(patch)}
                    onChange={(v) =>
                      setPatch(
                        JSON.stringify({
                          ...v,
                          ...(Object.hasOwn(JSON.parse(patch), "description") &&
                          v.description === undefined
                            ? { description: "" }
                            : {}),
                        }),
                      )
                    }
                  />
                  <small className="field-help">
                    留空的文本会清空该字段；请确认所有目标都应使用相同值。
                  </small>
                </div>
              )}

              {batchResults.length > 0 && (
                <div className="batch-results">
                  {batchResults.map((r, i) => (
                    <div key={i}>
                      {r.ok ? <Check size={15} /> : <X size={15} />}
                      <strong>{title(r.item)}</strong>
                      <span className={r.ok ? "muted" : "error-text"}>
                        {r.ok ? (en ? "Succeeded" : "成功") : r.error}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </WorkflowDialog>
          )}
        </>
      )}
      {operation && (
        <ResourceDialog
          key={operation.method + operation.path + JSON.stringify(preset)}
          operation={operation}
          moduleId={module.id}
          mode={mode}
          item={activeItem}
          team={team}
          spec={spec}
          initial={initial}
          preset={preset}
          onClose={() => setOperation(undefined)}
          onSuccess={refresh}
          detailActions={
            module.id === "tools" && activeItem
              ? [
                  ...(update && can("update")
                    ? [
                        {
                          label: en ? "Edit tool" : "编辑工具",
                          onSelect: () => launch(update, activeItem, true),
                        },
                      ]
                    : []),
                  ...(toggle && canToggle
                    ? [
                        {
                          label: en ? "Change enabled state" : "更改启用状态",
                          onSelect: () => launch(toggle, activeItem),
                        },
                      ]
                    : []),
                ]
              : []
          }
          en={en}
        />
      )}
      {connection && (
        <WorkflowDialog
          title={`${title(connection)} · MCP`}
          className="connection-result"
          closeLabel="Close connection"
          en={en}
          onClose={() => setConnection(undefined)}
        >
          <McpConnection key={connection.id} serverId={connection.id} />
        </WorkflowDialog>
      )}
    </>
  );
}

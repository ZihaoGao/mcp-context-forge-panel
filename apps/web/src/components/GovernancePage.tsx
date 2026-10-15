import { useContext, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Download,
  FileText,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import {
  displayError,
  permitted,
  request,
  send,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext } from "../session";
import { HistoryTransfer } from "./HistoryTransfer";
import { safeDisplay } from "../resource-model.mjs";

type GovernanceProps = {
  moduleId: string;
  spec: JsonRecord;
  en: boolean;
};

type Column = {
  key: string;
  label: string;
};

type LogFilters = {
  searchText: string;
  correlation: string;
  userId: string;
  component: string;
  category: string;
  levels: string[];
  startTime: string;
  endTime: string;
};

const redact = safeDisplay;

function text(value: unknown, key = ""): string {
  const safe = redact(value, key);
  if (safe === undefined || safe === null || safe === "") return "—";
  if (typeof safe === "object") {
    const json = JSON.stringify(safe);
    return json.length > 180 ? `${json.slice(0, 177)}…` : json;
  }
  return String(safe);
}

function records(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value as JsonRecord[];
  if (!value || typeof value !== "object") return [];
  const object = value as JsonRecord;
  for (const key of [
    "results",
    "items",
    "data",
    "traces",
    "spans",
    "events",
    "logs",
    "security_events",
    "audit_trails",
    "metrics",
  ]) {
    if (Array.isArray(object[key])) return object[key] as JsonRecord[];
  }
  return [];
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function flattenSettings(
  value: unknown,
  prefix = "",
): Array<{ key: string; value: unknown; group: string }> {
  if (Array.isArray(value)) {
    return [
      {
        key: prefix || "settings",
        value,
        group: prefix.split(".")[0] || "settings",
      },
    ];
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonRecord);
    if (!entries.length)
      return [
        {
          key: prefix || "settings",
          value,
          group: prefix.split(".")[0] || "settings",
        },
      ];
    return entries.flatMap(([key, child]) =>
      flattenSettings(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [
    {
      key: prefix || "settings",
      value,
      group: prefix.split(".")[0] || "settings",
    },
  ];
}

function operationAvailable(spec: JsonRecord, path: string, method: string) {
  const operation =
    spec.paths?.[path]?.[method.toLowerCase()] ||
    spec.paths?.[`${path}/`]?.[method.toLowerCase()];
  return Boolean(operation && operation["x-panel-available"] !== false);
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(redact(value), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ErrorBox({ error, en }: { error: unknown; en: boolean }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      {displayError(error)}
      <span className="field-help">
        {en ? "The backend rejected this request." : "后端拒绝了这次请求。"}
      </span>
    </div>
  );
}

function Empty({ en, children }: { en: boolean; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <ShieldAlert size={30} />
      <h3>{en ? "Permission or data unavailable" : "权限不足或暂无数据"}</h3>
      {children || (
        <p>
          {en
            ? "Ask an administrator for the permission required by this view."
            : "请联系管理员分配该视图所需权限。"}
        </p>
      )}
    </div>
  );
}

function Table({
  columns,
  rows,
  en,
  onRow,
}: {
  columns: Column[];
  rows: JsonRecord[];
  en: boolean;
  onRow?: (row: JsonRecord) => void;
}) {
  if (!rows.length)
    return (
      <div className="empty compact-empty">
        <FileText size={25} />
        <p>{en ? "No records" : "暂无记录"}</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(
                row.id || row.correlation_id || row.timestamp || index,
              )}
              onClick={() => onRow?.(row)}
              className={onRow ? "governance-clickable-row" : undefined}
            >
              {columns.map((column) => (
                <td key={column.key}>{text(row[column.key], column.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  total,
  pageSize,
  onPage,
  en,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  en: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="table-footer">
      <span>
        {en
          ? "Page " + (page + 1) + " of " + pages
          : "第 " + (page + 1) + " / " + pages + " 页"}{" "}
        · {total} {en ? "records" : "条"}
      </span>
      <div>
        <button
          type="button"
          className="icon-button"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label={en ? "Previous page" : "上一页"}
        >
          ‹
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
          aria-label={en ? "Next page" : "下一页"}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  subtitle,
  onRefresh,
  busy,
  en,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  busy?: boolean;
  en: boolean;
}) {
  return (
    <div className="section-heading">
      <div className="title-with-icon">
        {icon}
        <div>
          <h3>{title}</h3>
          <small className="field-help">{subtitle}</small>
        </div>
      </div>
      {onRefresh && (
        <button
          className="icon-button"
          aria-label={en ? "Refresh" : "刷新"}
          onClick={onRefresh}
          disabled={busy}
        >
          <RefreshCw size={16} className={busy ? "spinning" : undefined} />
        </button>
      )}
    </div>
  );
}

function QueryState({
  query,
  en,
}: {
  query: { isPending: boolean; error: unknown };
  en: boolean;
}) {
  if (query.isPending)
    return <p className="muted">{en ? "Loading…" : "正在加载…"}</p>;
  return <ErrorBox error={query.error} en={en} />;
}

function LogsPanel({ spec, en }: { spec: JsonRecord; en: boolean }) {
  const session = useContext(SessionContext);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [correlation, setCorrelation] = useState("");
  const [userId, setUserId] = useState("");
  const [component, setComponent] = useState("");
  const [category, setCategory] = useState("");
  const [levels, setLevels] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [searchPage, setSearchPage] = useState(0);
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitted, setSubmitted] = useState<LogFilters>({
    searchText: "",
    correlation: "",
    userId: "",
    component: "",
    category: "",
    levels: [],
    startTime: "",
    endTime: "",
  });
  const canLogs = permitted(session.permissions, "logs:read");
  const canAudit = permitted(session.permissions, "audit:read");
  const canSecurity = permitted(session.permissions, "security:read");
  const canMetrics = permitted(session.permissions, "metrics:read");
  const canAdminExport = permitted(session.permissions, "admin.system_config");
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["governance"] });
  const search = useQuery({
    queryKey: ["governance", "logs", "search", submitted, searchPage],
    queryFn: () =>
      request("/api/logs/search", {
        method: "POST",
        body: JSON.stringify({
          ...(submitted.searchText
            ? { search_text: submitted.searchText }
            : {}),
          ...(submitted.correlation
            ? { correlation_id: submitted.correlation }
            : {}),
          ...(submitted.userId ? { user_id: submitted.userId } : {}),
          ...(submitted.component ? { component: [submitted.component] } : {}),
          ...(submitted.category ? { category: [submitted.category] } : {}),
          ...(submitted.levels.length ? { level: submitted.levels } : {}),
          ...(localDateTimeToIso(submitted.startTime)
            ? { start_time: localDateTimeToIso(submitted.startTime) }
            : {}),
          ...(localDateTimeToIso(submitted.endTime)
            ? { end_time: localDateTimeToIso(submitted.endTime) }
            : {}),
          limit: 100,
          offset: searchPage * 100,
        }),
      }),
    enabled: canLogs && operationAvailable(spec, "/api/logs/search", "POST"),
  });
  const audit = useQuery({
    queryKey: ["governance", "logs", "audit"],
    queryFn: () => request("/api/logs/audit-trails?limit=100&offset=0"),
    enabled:
      canAudit && operationAvailable(spec, "/api/logs/audit-trails", "GET"),
  });
  const security = useQuery({
    queryKey: ["governance", "logs", "security"],
    queryFn: () => request("/api/logs/security-events?limit=100&offset=0"),
    enabled:
      canSecurity &&
      operationAvailable(spec, "/api/logs/security-events", "GET"),
  });
  const activity = useQuery({
    queryKey: ["governance", "logs", "activity"],
    queryFn: () => request("/api/logs/activity?limit=100"),
    enabled: canAudit && operationAvailable(spec, "/api/logs/activity", "GET"),
  });
  const performance = useQuery({
    queryKey: ["governance", "logs", "performance"],
    queryFn: () => request("/api/logs/performance-metrics?hours=24"),
    enabled:
      canMetrics &&
      operationAvailable(spec, "/api/logs/performance-metrics", "GET"),
  });
  const trace = useQuery({
    queryKey: ["governance", "logs", "trace", submitted.correlation],
    queryFn: () =>
      request(`/api/logs/trace/${encodeURIComponent(submitted.correlation)}`),
    enabled:
      canLogs &&
      !!submitted.correlation &&
      operationAvailable(spec, "/api/logs/trace/{correlation_id}", "GET"),
  });
  const searchRows = records(search.data);
  const searchTotal =
    typeof search.data?.total === "number"
      ? search.data.total
      : searchRows.length;
  const auditRows = records(audit.data);
  const securityRows = records(security.data);
  const activityRows = records(activity.data);
  const performanceRows = records(performance.data);
  const submitSearch = () => {
    const start = localDateTimeToIso(startTime);
    const end = localDateTimeToIso(endTime);
    if (startTime && !start) {
      setSearchError(
        en ? "Enter a valid start time." : "请输入有效的开始时间。",
      );
      return;
    }
    if (endTime && !end) {
      setSearchError(en ? "Enter a valid end time." : "请输入有效的结束时间。");
      return;
    }
    if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
      setSearchError(
        en
          ? "Start time must be earlier than or equal to end time."
          : "开始时间必须早于或等于结束时间。",
      );
      return;
    }
    setSearchError("");
    setSearchPage(0);
    setSubmitted({
      searchText,
      correlation,
      userId,
      component,
      category,
      levels,
      startTime,
      endTime,
    });
  };
  const exportLogs = async () => {
    setActionError("");
    try {
      const params = new URLSearchParams({ format: "json" });
      if (submitted.correlation)
        params.set("request_id", submitted.correlation);
      if (submitted.searchText) params.set("search", submitted.searchText);
      if (submitted.levels.length)
        params.set("level", submitted.levels.join(","));
      const start = localDateTimeToIso(submitted.startTime);
      const end = localDateTimeToIso(submitted.endTime);
      if (start) params.set("start_time", start);
      if (end) params.set("end_time", end);
      const value = await request("/v1/admin/logs/export?" + params);
      downloadJson(value, "contextforge-logs.json");
    } catch (error) {
      setActionError(displayError(error));
    }
  };
  return (
    <div className="governance-page">
      <div className="governance-heading">
        <div>
          <p className="eyebrow">{en ? "GOVERNANCE" : "治理中心"}</p>
          <h2>{en ? "Logs & audit" : "日志与审计"}</h2>
          <p className="muted">
            {en
              ? "Search operational records while keeping correlation and security context together."
              : "按运行记录检索，并保留关联 ID 与安全上下文。"}
          </p>
        </div>
        <div className="toolbar-right">
          {canAdminExport &&
            operationAvailable(spec, "/v1/admin/logs/export", "GET") && (
              <button
                className="button secondary"
                onClick={exportLogs}
                disabled={search.isFetching}
              >
                <Download size={15} /> {en ? "Export" : "导出"}
              </button>
            )}
          <button
            className="icon-button"
            aria-label="Refresh"
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {actionError && <ErrorBox error={actionError} en={en} />}
      {!canLogs && !canAudit && !canSecurity && !canMetrics ? (
        <Empty en={en} />
      ) : (
        <>
          <section className="panel governance-search-panel">
            <PanelHeader
              icon={<Search size={18} />}
              title={en ? "Log search" : "日志检索"}
              subtitle={
                en
                  ? "Search text and correlation ID are sent to the backend search API."
                  : "搜索文本和关联 ID 由后端检索接口处理。"
              }
              onRefresh={refresh}
              busy={search.isFetching}
              en={en}
            />
            <div className="logs-filter-grid">
              <label className="field log-search-text">
                <span>{en ? "Search text" : "搜索文本"}</span>
                <span className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Search logs"
                    placeholder={en ? "Search text…" : "搜索文本…"}
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                </span>
              </label>
              <label className="field inline-field log-correlation">
                <span>{en ? "Correlation ID" : "关联 ID"}</span>
                <input
                  value={correlation}
                  onChange={(event) => setCorrelation(event.target.value)}
                />
              </label>
              <label className="field inline-field log-user">
                <span>{en ? "User ID" : "用户 ID"}</span>
                <input
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </label>
              <label className="field inline-field log-component">
                <span>{en ? "Component" : "组件"}</span>
                <input
                  value={component}
                  onChange={(event) => setComponent(event.target.value)}
                />
              </label>
              <label className="field inline-field log-category">
                <span>{en ? "Category" : "类别"}</span>
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <fieldset className="field inline-field filter-levels">
                <legend>{en ? "Level" : "级别"}</legend>
                <div className="level-choices">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setLevels([
                        "DEBUG",
                        "INFO",
                        "WARNING",
                        "ERROR",
                        "CRITICAL",
                      ])
                    }
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setLevels([])}
                  >
                    清空
                  </button>
                  {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(
                    (level) => (
                      <label key={level} className="check-label">
                        <input
                          type="checkbox"
                          checked={levels.includes(level)}
                          onChange={(e) =>
                            setLevels(
                              e.target.checked
                                ? [...levels, level]
                                : levels.filter((v) => v !== level),
                            )
                          }
                        />
                        {level}
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
              <label className="field inline-field log-start">
                <span>{en ? "From" : "开始时间"}</span>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label className="field inline-field log-end">
                <span>{en ? "To" : "结束时间"}</span>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
              <button
                className="button primary log-submit"
                onClick={submitSearch}
                disabled={!canLogs}
              >
                {en ? "Search" : "检索"}
              </button>
            </div>
            {searchError && <div className="alert error">{searchError}</div>}
            <QueryState query={search} en={en} />
            {canLogs && (
              <>
                <Table
                  en={en}
                  rows={searchRows}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "level", label: en ? "Level" : "级别" },
                    { key: "component", label: en ? "Component" : "组件" },
                    { key: "message", label: en ? "Message" : "消息" },
                    {
                      key: "correlation_id",
                      label: en ? "Correlation" : "关联 ID",
                    },
                    { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  ]}
                />
                <Pager
                  page={searchPage}
                  total={searchTotal}
                  pageSize={100}
                  onPage={setSearchPage}
                  en={en}
                />
              </>
            )}
          </section>
          <div className="governance-grid">
            {canAudit && (
              <section className="panel">
                <PanelHeader
                  icon={<FileText size={18} />}
                  title={en ? "Audit trails" : "审计轨迹"}
                  subtitle={en ? "Actions and review flags" : "操作与复核标记"}
                  onRefresh={refresh}
                  busy={audit.isFetching}
                  en={en}
                />
                <QueryState query={audit} en={en} />
                <Table
                  en={en}
                  rows={auditRows}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "action", label: en ? "Action" : "操作" },
                    { key: "resource_type", label: en ? "Resource" : "资源" },
                    { key: "user_email", label: en ? "User" : "用户" },
                    { key: "success", label: en ? "Success" : "成功" },
                    { key: "requires_review", label: en ? "Review" : "复核" },
                  ]}
                />
              </section>
            )}
            {canSecurity && (
              <section className="panel">
                <PanelHeader
                  icon={<ShieldAlert size={18} />}
                  title={en ? "Security events" : "安全事件"}
                  subtitle={
                    en
                      ? "Threat score and resolution state"
                      : "威胁评分与处置状态"
                  }
                  onRefresh={refresh}
                  busy={security.isFetching}
                  en={en}
                />
                <QueryState query={security} en={en} />
                <Table
                  en={en}
                  rows={securityRows}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "severity", label: en ? "Severity" : "严重度" },
                    { key: "event_type", label: en ? "Event" : "事件" },
                    { key: "category", label: en ? "Category" : "类别" },
                    { key: "threat_score", label: en ? "Threat" : "威胁分" },
                    { key: "resolved", label: en ? "Resolved" : "已解决" },
                  ]}
                />
              </section>
            )}
            {canAudit && (
              <section className="panel">
                <PanelHeader
                  icon={<Activity size={18} />}
                  title={en ? "Activity" : "活动流"}
                  subtitle={
                    en
                      ? "Recent audit and security activity"
                      : "最近的审计与安全活动"
                  }
                  onRefresh={refresh}
                  busy={activity.isFetching}
                  en={en}
                />
                <QueryState query={activity} en={en} />
                <Table
                  en={en}
                  rows={activityRows}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "source", label: en ? "Source" : "来源" },
                    { key: "title", label: en ? "Title" : "标题" },
                    { key: "status", label: en ? "Status" : "状态" },
                    { key: "resource_type", label: en ? "Resource" : "资源" },
                    { key: "actor", label: en ? "Actor" : "操作者" },
                  ]}
                />
              </section>
            )}
            {canMetrics && (
              <section className="panel">
                <PanelHeader
                  icon={<Activity size={18} />}
                  title={en ? "Performance metrics" : "性能指标"}
                  subtitle={en ? "Last 24 hours" : "最近 24 小时"}
                  onRefresh={refresh}
                  busy={performance.isFetching}
                  en={en}
                />
                <QueryState query={performance} en={en} />
                <Table
                  en={en}
                  rows={performanceRows}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "component", label: en ? "Component" : "组件" },
                    { key: "operation_type", label: en ? "Operation" : "操作" },
                    { key: "request_count", label: en ? "Requests" : "请求" },
                    { key: "error_rate", label: en ? "Error rate" : "错误率" },
                    { key: "p95_duration_ms", label: "P95 ms" },
                  ]}
                />
              </section>
            )}
          </div>
          {submitted.correlation && canLogs && (
            <section className="panel governance-detail-panel">
              <PanelHeader
                icon={<FileText size={18} />}
                title={en ? "Correlation detail" : "关联详情"}
                subtitle={submitted.correlation}
                onRefresh={() => void trace.refetch()}
                busy={trace.isFetching}
                en={en}
              />
              <QueryState query={trace} en={en} />
              {trace.data && (
                <pre className="governance-json">
                  {JSON.stringify(redact(trace.data), null, 2)}
                </pre>
              )}
            </section>
          )}
        </>
      )}
      <HistoryTransfer
        kind="logs"
        value={{
          logs: search.data,
          audit: audit.data,
          security: security.data,
          activity: activity.data,
          performance: performance.data,
        }}
      />
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="stat-card governance-stat-card">
      <span>{label}</span>
      <strong>{text(value, label)}</strong>
    </div>
  );
}

function ObservabilityPanel({ spec, en }: { spec: JsonRecord; en: boolean }) {
  const session = useContext(SessionContext);
  const queryClient = useQueryClient();
  const [hours, setHours] = useState("24");
  const [interval, setInterval] = useState("60");
  const [cleanupDays, setCleanupDays] = useState("30");
  const [actionError, setActionError] = useState("");
  const [draft, setDraft] = useState({
    status: "",
    http_method: "",
    user_email: "",
    attribute_search: "",
    min_duration_ms: "",
    max_duration_ms: "",
  });
  const [filters, setFilters] = useState(draft);
  const [traceId, setTraceId] = useState("");
  const canAdmin = permitted(session.permissions, "admin.system_config");
  const canMetrics = permitted(session.permissions, "metrics:read") || canAdmin;
  const cleanupAvailable = operationAvailable(
    spec,
    "/v1/observability/traces/cleanup",
    "DELETE",
  );
  const exportAvailable = operationAvailable(
    spec,
    "/v1/observability/traces/export",
    "POST",
  );
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["governance"] });
  const metricQuery = (name: string, path: string) =>
    useQuery({
      queryKey: ["governance", "observability", name, hours, interval],
      queryFn: () =>
        request(
          `${path}?hours=${encodeURIComponent(hours)}&interval_minutes=${encodeURIComponent(interval)}`,
        ),
      enabled: canMetrics && operationAvailable(spec, path, "GET"),
    });
  const timeseries = metricQuery(
    "timeseries",
    "/v1/observability/metrics/timeseries",
  );
  const percentiles = metricQuery(
    "percentiles",
    "/v1/observability/metrics/percentiles",
  );
  const stats = useQuery({
    queryKey: ["governance", "observability", "stats", hours],
    queryFn: () =>
      request(`/v1/observability/stats?hours=${encodeURIComponent(hours)}`),
    enabled:
      canAdmin && operationAvailable(spec, "/v1/observability/stats", "GET"),
  });
  const queryPerformance = useQuery({
    queryKey: ["governance", "observability", "query-performance", hours],
    queryFn: () =>
      request(
        `/v1/observability/analytics/query-performance?hours=${encodeURIComponent(hours)}`,
      ),
    enabled:
      canAdmin &&
      operationAvailable(
        spec,
        "/v1/observability/analytics/query-performance",
        "GET",
      ),
  });
  const traceQueryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "100", offset: "0" });
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    return params.toString();
  }, [filters]);
  const traces = useQuery({
    queryKey: ["governance", "observability", "traces", filters],
    queryFn: () => request(`/v1/observability/traces?${traceQueryString}`),
    enabled:
      canAdmin && operationAvailable(spec, "/v1/observability/traces", "GET"),
  });
  const spans = useQuery({
    queryKey: ["governance", "observability", "spans", traceId],
    queryFn: () =>
      request(
        `/v1/observability/spans?trace_id=${encodeURIComponent(traceId)}&limit=100&offset=0`,
      ),
    enabled:
      canAdmin &&
      !!traceId &&
      operationAvailable(spec, "/v1/observability/spans", "GET"),
  });
  const detail = useQuery({
    queryKey: ["governance", "observability", "trace", traceId],
    queryFn: () =>
      request(`/v1/observability/traces/${encodeURIComponent(traceId)}`),
    enabled:
      canAdmin &&
      !!traceId &&
      operationAvailable(spec, "/v1/observability/traces/{trace_id}", "GET"),
  });
  const statsRows =
    stats.data && typeof stats.data === "object" ? stats.data : {};
  const timeseriesRows = records(timeseries.data);
  const percentileRows = records(percentiles.data);
  const traceRows = records(traces.data);
  const spanRows = records(spans.data);
  const performCleanup = async () => {
    if (!window.confirm(en ? "Delete old traces?" : "删除旧的 traces？"))
      return;
    setActionError("");
    try {
      await request(
        `/v1/observability/traces/cleanup?days=${encodeURIComponent(cleanupDays)}`,
        { method: "DELETE" },
      );
      refresh();
    } catch (error) {
      setActionError(displayError(error));
    }
  };
  const exportTraces = async () => {
    setActionError("");
    try {
      const value = await request(
        `/v1/observability/traces/export?format=json`,
        {
          method: "POST",
          body: JSON.stringify(filters),
        },
      );
      downloadJson(value, "contextforge-traces.json");
    } catch (error) {
      setActionError(displayError(error));
    }
  };
  return (
    <div className="governance-page">
      <div className="governance-heading">
        <div>
          <p className="eyebrow">{en ? "GOVERNANCE" : "治理中心"}</p>
          <h2>{en ? "Observability" : "可观测性"}</h2>
          <p className="muted">
            {en
              ? "Inspect latency, traces, spans, and query performance with explicit retention controls."
              : "查看延迟、traces、spans 与查询性能，并明确控制保留周期。"}
          </p>
        </div>
        <div className="toolbar-right">
          {canAdmin && (cleanupAvailable || exportAvailable) && (
            <>
              {exportAvailable && (
                <button className="button secondary" onClick={exportTraces}>
                  <Download size={15} /> {en ? "Export traces" : "导出 traces"}
                </button>
              )}
              {cleanupAvailable && (
                <button
                  className="button danger-outline"
                  onClick={performCleanup}
                >
                  <Trash2 size={15} />{" "}
                  {en
                    ? `Cleanup older than ${cleanupDays} days`
                    : `清理 ${cleanupDays} 天前`}
                </button>
              )}
            </>
          )}
          <button
            className="icon-button"
            aria-label="Refresh"
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {actionError && <ErrorBox error={actionError} en={en} />}
      {!canMetrics && !canAdmin ? (
        <Empty en={en} />
      ) : (
        <>
          <section className="panel">
            <PanelHeader
              icon={<Activity size={18} />}
              title={en ? "Metric window" : "指标时间窗"}
              subtitle={en ? "Backend aggregation interval" : "后端聚合间隔"}
              onRefresh={refresh}
              busy={timeseries.isFetching || percentiles.isFetching}
              en={en}
            />
            <div className="toolbar governance-filter-bar">
              <label className="field inline-field">
                <span>{en ? "Hours" : "小时"}</span>
                <input
                  type="number"
                  min="1"
                  max="720"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <label className="field inline-field">
                <span>{en ? "Interval (minutes)" : "间隔（分钟）"}</span>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                />
              </label>
              {cleanupAvailable && (
                <label className="field inline-field">
                  <span>{en ? "Cleanup days" : "清理天数"}</span>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    value={cleanupDays}
                    onChange={(e) => setCleanupDays(e.target.value)}
                  />
                </label>
              )}
              <span className="field-help">
                {en
                  ? "Metric responses may be unavailable when telemetry is disabled."
                  : "未启用遥测时指标接口可能不可用。"}
              </span>
            </div>
            <QueryState query={timeseries} en={en} />
            <QueryState query={percentiles} en={en} />
            <div className="governance-stats">
              {Object.entries(statsRows)
                .filter(
                  ([, value]) =>
                    value !== null &&
                    ["number", "string", "boolean"].includes(typeof value),
                )
                .slice(0, 8)
                .map(([key, value]) => (
                  <MetricCard
                    key={key}
                    label={
                      en
                        ? key
                        : (
                            {
                              time_window_hours: "时间范围（小时）",
                              total_traces: "追踪总数",
                              success_count: "成功数",
                              error_count: "错误数",
                              error_rate: "错误率（%）",
                              avg_duration_ms: "平均耗时（毫秒）",
                            } as Record<string, string>
                          )[key] || key
                    }
                    value={value}
                  />
                ))}
            </div>
            {Array.isArray(statsRows.slowest_endpoints) && (
              <section className="slowest-endpoints">
                <h4>{en ? "Slowest endpoints" : "最慢端点"}</h4>
                <Table
                  en={en}
                  rows={statsRows.slowest_endpoints}
                  columns={[
                    { key: "name", label: en ? "Endpoint" : "端点" },
                    {
                      key: "avg_duration_ms",
                      label: en ? "Average duration (ms)" : "平均耗时（毫秒）",
                    },
                    { key: "count", label: en ? "Requests" : "请求数" },
                  ]}
                />
              </section>
            )}
            {timeseriesRows.length > 0 && (
              <Table
                en={en}
                rows={timeseriesRows}
                columns={[
                  { key: "timestamp", label: en ? "Time" : "时间" },
                  { key: "request_count", label: en ? "Requests" : "请求" },
                  { key: "error_count", label: en ? "Errors" : "错误" },
                  {
                    key: "avg_duration_ms",
                    label: en ? "Average ms" : "平均毫秒",
                  },
                ]}
              />
            )}
            {percentileRows.length > 0 && (
              <Table
                en={en}
                rows={percentileRows}
                columns={[
                  { key: "timestamp", label: en ? "Time" : "时间" },
                  { key: "p50", label: "P50" },
                  { key: "p95", label: "P95" },
                  { key: "p99", label: "P99" },
                ]}
              />
            )}
            {queryPerformance.data && (
              <pre className="governance-json">
                {JSON.stringify(redact(queryPerformance.data), null, 2)}
              </pre>
            )}
          </section>
          {canAdmin && (
            <section className="panel">
              <PanelHeader
                icon={<Search size={18} />}
                title={en ? "Trace explorer" : "Trace 检索"}
                subtitle={
                  en
                    ? "Select a trace to inspect its spans and detail."
                    : "选择 trace 查看 spans 与详情。"
                }
                onRefresh={refresh}
                busy={traces.isFetching}
                en={en}
              />
              <div className="toolbar governance-filter-bar">
                {(
                  [
                    ["status", en ? "Status" : "状态"],
                    ["http_method", en ? "HTTP method" : "HTTP 方法"],
                    ["user_email", en ? "User" : "用户"],
                    ["attribute_search", en ? "Attribute" : "属性"],
                    ["min_duration_ms", en ? "Min ms" : "最小毫秒"],
                    ["max_duration_ms", en ? "Max ms" : "最大毫秒"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="field inline-field" key={key}>
                    <span>{label}</span>
                    <input
                      value={draft[key]}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <button
                  className="button primary"
                  onClick={() => setFilters(draft)}
                >
                  {en ? "Apply filters" : "应用筛选"}
                </button>
              </div>
              <QueryState query={traces} en={en} />
              <Table
                en={en}
                rows={traceRows}
                onRow={(row) =>
                  setTraceId(String(row.id || row.trace_id || ""))
                }
                columns={[
                  { key: "id", label: en ? "Trace ID" : "Trace ID" },
                  { key: "start_time", label: en ? "Start" : "开始" },
                  { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  { key: "status", label: en ? "Status" : "状态" },
                  { key: "http_method", label: "HTTP" },
                  { key: "user_email", label: en ? "User" : "用户" },
                ]}
              />
            </section>
          )}
          {traceId && canAdmin && (
            <section className="panel governance-detail-panel">
              <PanelHeader
                icon={<FileText size={18} />}
                title={en ? "Selected trace" : "选中的 trace"}
                subtitle={traceId}
                onRefresh={() => {
                  void detail.refetch();
                  void spans.refetch();
                }}
                busy={detail.isFetching || spans.isFetching}
                en={en}
              />
              <QueryState query={detail} en={en} />
              {detail.data && (
                <pre className="governance-json">
                  {JSON.stringify(redact(detail.data), null, 2)}
                </pre>
              )}
              <Table
                en={en}
                rows={spanRows}
                columns={[
                  { key: "span_id", label: "Span ID" },
                  { key: "operation_name", label: en ? "Operation" : "操作" },
                  { key: "start_time", label: en ? "Start" : "开始" },
                  { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  { key: "status", label: en ? "Status" : "状态" },
                ]}
              />
            </section>
          )}
        </>
      )}
      <HistoryTransfer
        kind="observability"
        value={{
          traces: traces.data,
          timeseries: timeseries.data,
          percentiles: percentiles.data,
          stats: stats.data,
        }}
      />
    </div>
  );
}

type SettingsTemplate = {
  kind: "contextforge-panel-settings";
  version: 1;
  passthrough_headers: string[];
};

function normalizeHeaders(value: unknown): string[] {
  if (!Array.isArray(value))
    throw new Error("passthrough_headers must be an array");
  const headers = value.map((item) => String(item).trim()).filter(Boolean);
  if (headers.some((item) => !/^[A-Za-z0-9!#$%&'*+.^_|~-]+$/.test(item)))
    throw new Error("Header names must use HTTP token characters");
  return [...new Set(headers)];
}

function SettingsPanel({ spec, en }: { spec: JsonRecord; en: boolean }) {
  const session = useContext(SessionContext);
  const queryClient = useQueryClient();
  const [draftHeaders, setDraftHeaders] = useState<string | undefined>();
  const [preview, setPreview] = useState<string[] | null>(null);
  const [importError, setImportError] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState("");
  const canAdmin = permitted(session.permissions, "admin.system_config");
  const headersAvailable = operationAvailable(
    spec,
    "/v1/admin/config/passthrough-headers",
    "GET",
  );
  const headersWritable = operationAvailable(
    spec,
    "/v1/admin/config/passthrough-headers",
    "PUT",
  );
  const settings = useQuery({
    queryKey: ["governance", "settings", "snapshot"],
    queryFn: () => request("/v1/admin/config/settings"),
    enabled:
      canAdmin && operationAvailable(spec, "/v1/admin/config/settings", "GET"),
  });
  const headers = useQuery({
    queryKey: ["governance", "settings", "headers"],
    queryFn: () => request("/v1/admin/config/passthrough-headers"),
    enabled: canAdmin && headersAvailable,
  });
  const cacheStats = useQuery({
    queryKey: ["governance", "settings", "cache-stats"],
    queryFn: () => request("/v1/admin/config/passthrough-headers/cache-stats"),
    enabled:
      canAdmin &&
      operationAvailable(
        spec,
        "/v1/admin/config/passthrough-headers/cache-stats",
        "GET",
      ),
  });
  const currentHeaders = useMemo(() => {
    const data = headers.data as JsonRecord | undefined;
    return Array.isArray(data?.passthrough_headers)
      ? data.passthrough_headers.map(String)
      : [];
  }, [headers.data]);
  const settingEntries = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase();
    const data = settings.data;
    const entries =
      data?.groups && typeof data.groups === "object"
        ? [
            ...Object.entries(data.groups).flatMap(([group, values]) =>
              flattenSettings(values).map((entry) => ({ ...entry, group })),
            ),
            ...flattenSettings(data.security_status || {}).map((entry) => ({
              ...entry,
              group: "Security status",
            })),
          ]
        : flattenSettings(data);
    return entries.filter((entry) => {
      if (!query) return true;
      return (
        entry.group +
        " " +
        entry.key +
        " " +
        text(entry.value, entry.key)
      )
        .toLowerCase()
        .includes(query);
    });
  }, [settings.data, settingsSearch]);
  const settingGroups = useMemo(() => {
    const groups = new Map<
      string,
      Array<{ key: string; value: unknown; group: string }>
    >();
    for (const entry of settingEntries) {
      const group = groups.get(entry.group) || [];
      group.push(entry);
      groups.set(entry.group, group);
    }
    return [...groups.entries()];
  }, [settingEntries]);
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["governance", "settings"],
    });
  const preparePreview = (value: string[]) => {
    const next = [...new Set(value)].sort();
    const invalid = next.filter(
      (item) => !/^[A-Za-z0-9!#$%&'*+.^_|~-]+$/.test(item),
    );
    if (invalid.length) throw new Error(`Invalid header name: ${invalid[0]}`);
    setPreview(next);
    return next;
  };
  const applyPreview = async () => {
    if (
      !canAdmin ||
      !headersWritable ||
      preview === null ||
      saving ||
      !headers.data
    )
      return;
    setSaving(true);
    try {
      const next = preview ?? [];
      await send("/v1/admin/config/passthrough-headers", "PUT", {
        passthrough_headers: next,
      });
      setDraftHeaders(next.join("\n"));
      setPreview(null);
      refresh();
    } catch (error) {
      setImportError(displayError(error));
    } finally {
      setSaving(false);
    }
  };
  const importTemplate = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as JsonRecord;
      const value =
        parsed.passthrough_headers ??
        (parsed.settings as JsonRecord | undefined)?.passthrough_headers;
      preparePreview(normalizeHeaders(value));
      setImportError("");
    } catch (error) {
      setImportError(displayError(error));
    }
  };
  const exportTemplate = () => {
    const template: SettingsTemplate = {
      kind: "contextforge-panel-settings",
      version: 1,
      passthrough_headers: currentHeaders,
    };
    downloadJson(template, "contextforge-settings-template.json");
  };
  const saveDraft = () => {
    try {
      const value = normalizeHeaders(
        (draftHeaders ?? currentHeaders.join("\n")).split(/[\n,]/),
      );
      preparePreview(value);
      setImportError("");
    } catch (error) {
      setImportError(displayError(error));
    }
  };
  const previewHeaders = preview ?? [];
  const added = previewHeaders.filter((item) => !currentHeaders.includes(item));
  const removed = currentHeaders.filter(
    (item) => !previewHeaders.includes(item),
  );
  return (
    <div className="governance-page">
      <div className="governance-heading">
        <div>
          <p className="eyebrow">{en ? "GOVERNANCE" : "治理中心"}</p>
          <h2>{en ? "System settings" : "系统设置"}</h2>
          <p className="muted">
            {en
              ? "Manage the typed passthrough-header setting; inspect other runtime settings as read-only data."
              : "管理允许透传的请求头，并查看后端当前的运行配置。"}
          </p>
        </div>
        <div className="toolbar-right">
          <button
            className="button secondary"
            onClick={exportTemplate}
            disabled={!canAdmin}
          >
            <Download size={15} /> {en ? "Export template" : "导出模板"}
          </button>
          <label className="button secondary">
            <Upload size={15} /> {en ? "Import template" : "导入模板"}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={importTemplate}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Refresh"
            onClick={refresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {!canAdmin ? (
        <Empty en={en} />
      ) : (
        <>
          <section className="panel">
            <PanelHeader
              icon={<Settings size={18} />}
              title={en ? "Passthrough headers" : "透传请求头"}
              subtitle={
                en
                  ? "A typed, portable setting with a review step"
                  : "控制客户端可传给上游的请求头，保存前查看增删差异"
              }
              onRefresh={refresh}
              busy={headers.isFetching}
              en={en}
            />
            <QueryState query={headers} en={en} />
            <div className="toolbar governance-settings-editor">
              <label className="field full">
                <span>
                  {en ? "Allowed header names" : "允许透传的请求头名称"}
                </span>
                <textarea
                  rows={6}
                  disabled={!headers.data || saving}
                  value={draftHeaders ?? currentHeaders.join("\n")}
                  onChange={(event) => setDraftHeaders(event.target.value)}
                  placeholder="MCP-Protocol-Version\nX-Request-ID"
                />
                <small className="field-help">
                  {en
                    ? "One HTTP header token per line. Secrets and values are never accepted here."
                    : "每行一个 HTTP 请求头名称；此设置不接受密钥或请求头值。"}
                </small>
              </label>
              <button
                className="button primary"
                disabled={!headers.data || saving || !headersWritable}
                onClick={saveDraft}
              >
                {en ? "Preview changes" : "预览变更"}
              </button>
            </div>
            {importError && <div className="alert error">{importError}</div>}
            {preview !== null && (
              <div className="governance-preview">
                <div className="section-heading">
                  <div>
                    <h3>{en ? "Preflight preview" : "变更预览"}</h3>
                    <small className="field-help">
                      {en
                        ? "Review before the PUT request is sent."
                        : "确认后应用到后端。"}
                    </small>
                  </div>
                  <button
                    className="button primary"
                    onClick={applyPreview}
                    disabled={!headersWritable || saving || !headers.data}
                  >
                    {en ? "Apply" : "应用"}
                  </button>
                </div>
                <div className="governance-diff">
                  <span className="badge success">+ {added.length}</span>
                  <span className="badge neutral">− {removed.length}</span>
                </div>
                <pre className="governance-json">
                  {JSON.stringify(
                    { added, removed, next: previewHeaders },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </section>
          <div className="governance-grid">
            <section className="panel">
              <PanelHeader
                icon={<Settings size={18} />}
                title={en ? "Runtime settings snapshot" : "运行设置快照"}
                subtitle={
                  en
                    ? "Read-only because the response is untyped"
                    : "这些运行参数由后端部署配置管理，在此只读查看"
                }
                onRefresh={refresh}
                busy={settings.isFetching}
                en={en}
              />
              <QueryState query={settings} en={en} />
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label={en ? "Filter settings" : "筛选设置"}
                  placeholder={en ? "Filter keys and values…" : "筛选键和值…"}
                  value={settingsSearch}
                  onChange={(event) => setSettingsSearch(event.target.value)}
                />
              </label>
              {settings.data &&
                (settingGroups.length ? (
                  <div className="governance-settings-groups">
                    {settingGroups.map(([group, entries]) => (
                      <details
                        key={group}
                        open={!!settingsSearch || group === "Basic Settings"}
                      >
                        <summary>
                          {en
                            ? group
                            : (
                                {
                                  "Basic Settings": "基本设置",
                                  "Authentication & Security": "认证与安全",
                                  "SSO Configuration": "单点登录",
                                  "Email Authentication": "邮箱登录",
                                  "Database & Cache": "数据库与缓存",
                                  "Feature Flags": "功能开关",
                                  "Connection Timeouts": "连接超时",
                                  Transport: "传输方式",
                                  Logging: "日志配置",
                                  "Resources & Tools": "资源与工具",
                                  "CORS Settings": "跨域访问",
                                  "Security Headers": "安全请求头",
                                  Observability: "可观测性配置",
                                  Development: "开发选项",
                                  "Security status": "安全状态",
                                } as Record<string, string>
                              )[group] || group}{" "}
                          <span className="muted">({entries.length})</span>
                        </summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{en ? "Setting" : "设置项"}</th>
                                <th>{en ? "Value" : "值"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map((entry) => (
                                <tr key={entry.key}>
                                  <td>
                                    <code>{entry.key}</code>
                                  </td>
                                  <td>{text(entry.value, entry.key)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    {en ? "No settings match this filter." : "没有匹配的设置。"}
                  </p>
                ))}
            </section>
            <section className="panel">
              <PanelHeader
                icon={<Activity size={18} />}
                title={en ? "Header cache" : "请求头缓存"}
                subtitle={
                  en
                    ? "Inspect cache state before invalidating it"
                    : "清理前查看缓存状态"
                }
                onRefresh={refresh}
                busy={cacheStats.isFetching}
                en={en}
              />
              <QueryState query={cacheStats} en={en} />
              {cacheStats.data && (
                <pre className="governance-json">
                  {JSON.stringify(redact(cacheStats.data), null, 2)}
                </pre>
              )}
              <button
                className="button secondary"
                disabled={
                  !canAdmin ||
                  !operationAvailable(
                    spec,
                    "/v1/admin/config/passthrough-headers/invalidate-cache",
                    "POST",
                  )
                }
                onClick={async () => {
                  if (
                    !window.confirm(
                      en ? "Invalidate the header cache?" : "清理请求头缓存？",
                    )
                  )
                    return;
                  try {
                    await send(
                      "/v1/admin/config/passthrough-headers/invalidate-cache",
                      "POST",
                    );
                    refresh();
                  } catch (error) {
                    setImportError(displayError(error));
                  }
                }}
              >
                <Trash2 size={15} /> {en ? "Invalidate cache" : "清理缓存"}
              </button>
            </section>
          </div>
          {headers.isError && (
            <div className="alert warning">
              <AlertTriangle size={15} />{" "}
              {en
                ? "The backend did not return the typed setting."
                : "后端未返回有类型的设置。"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function GovernancePage({ moduleId, spec, en }: GovernanceProps) {
  if (moduleId === "logs") return <LogsPanel spec={spec} en={en} />;
  if (moduleId === "observability")
    return <ObservabilityPanel spec={spec} en={en} />;
  return <SettingsPanel spec={spec} en={en} />;
}

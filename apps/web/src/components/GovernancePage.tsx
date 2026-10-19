import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
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
  Copy,
  Check,
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
import {
  formatDuration,
  formatTimestamp,
  formatOperationalValue,
  metricRows,
  utcTimestamp,
} from "../operations-display.mjs";

type GovernanceProps = {
  moduleId: string;
  spec: JsonRecord;
  en: boolean;
};

type Column = {
  key: string;
  label: string;
  render?: (row: JsonRecord) => React.ReactNode;
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
                row.span_id ||
                  row.trace_id ||
                  row.id ||
                  row.correlation_id ||
                  row.timestamp ||
                  index,
              )}
              onClick={() => onRow?.(row)}
              className={onRow ? "governance-clickable-row" : undefined}
            >
              {columns.map((column) => {
                const value = row[column.key];
                const isTime =
                  /^(timestamp|start_time|end_time|created_at|updated_at)$/.test(
                    column.key,
                  );
                return (
                  <td key={column.key}>
                    {column.render ? (
                      column.render(row)
                    ) : isTime ? (
                      <time dateTime={utcTimestamp(value)} title={text(value)}>
                        {formatTimestamp(value, en)}
                      </time>
                    ) : (
                      (formatOperationalValue(value, column.key, en) ??
                      text(value, column.key))
                    )}
                  </td>
                );
              })}
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
  hasNext = false,
  busy = false,
  onPageSize,
}: {
  page: number;
  total?: number;
  pageSize: number;
  onPage: (page: number) => void;
  en: boolean;
  hasNext?: boolean;
  busy?: boolean;
  onPageSize: (size: number) => void;
}) {
  const pages =
    total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="table-footer">
      <span>
        {pages === undefined
          ? en
            ? `Page ${page + 1}`
            : `第 ${page + 1} 页`
          : en
            ? "Page " + (page + 1) + " of " + pages
            : "第 " + (page + 1) + " / " + pages + " 页"}{" "}
        {total !== undefined && (
          <>
            {" "}
            · {total} {en ? "records" : "条"}
          </>
        )}
      </span>
      <div>
        <label>
          {en ? "Rows per page" : "每页条数"}{" "}
          <select
            value={pageSize}
            disabled={busy}
            onChange={(event) => onPageSize(Number(event.target.value))}
          >
            {[20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button"
          disabled={busy || page === 0}
          onClick={() => onPage(page - 1)}
          aria-label={en ? "Previous page" : "上一页"}
        >
          ‹
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={
            busy || (pages === undefined ? !hasNext : page + 1 >= pages)
          }
          onClick={() => onPage(page + 1)}
          aria-label={en ? "Next page" : "下一页"}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function usePaging() {
  const [page, onPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  return {
    page,
    pageSize,
    onPage,
    onPageSize: (size: number) => {
      setPageSize(size);
      onPage(0);
    },
  };
}

function DetailDialog({
  title,
  onClose,
  en,
  children,
}: {
  title: string;
  onClose: () => void;
  en: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="action-dialog governance-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="button secondary" onClick={onClose}>
          {en ? "Close" : "关闭"}
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

function PagedTable({
  rows,
  en,
  columns,
}: {
  rows: JsonRecord[];
  en: boolean;
  columns: Column[];
}) {
  const paging = usePaging();
  const page = Math.min(
    paging.page,
    Math.max(0, Math.ceil(rows.length / paging.pageSize) - 1),
  );
  return (
    <>
      <Table
        rows={rows.slice(page * paging.pageSize, (page + 1) * paging.pageSize)}
        columns={columns}
        en={en}
      />
      <Pager {...paging} page={page} total={rows.length} en={en} />
    </>
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
  const searchPaging = usePaging();
  const auditPaging = usePaging();
  const securityPaging = usePaging();
  const [correlationId, setCorrelationId] = useState("");
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
    queryKey: [
      "governance",
      "logs",
      "search",
      submitted,
      searchPaging.page,
      searchPaging.pageSize,
    ],
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
          limit: searchPaging.pageSize,
          offset: searchPaging.page * searchPaging.pageSize,
        }),
      }),
    enabled: canLogs && operationAvailable(spec, "/api/logs/search", "POST"),
  });
  const audit = useQuery({
    queryKey: [
      "governance",
      "logs",
      "audit",
      auditPaging.page,
      auditPaging.pageSize,
    ],
    queryFn: () =>
      request(
        `/api/logs/audit-trails?limit=${auditPaging.pageSize + 1}&offset=${auditPaging.page * auditPaging.pageSize}`,
      ),
    enabled:
      canAudit && operationAvailable(spec, "/api/logs/audit-trails", "GET"),
  });
  const security = useQuery({
    queryKey: [
      "governance",
      "logs",
      "security",
      securityPaging.page,
      securityPaging.pageSize,
    ],
    queryFn: () =>
      request(
        `/api/logs/security-events?limit=${securityPaging.pageSize + 1}&offset=${securityPaging.page * securityPaging.pageSize}`,
      ),
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
    queryKey: ["governance", "logs", "trace", correlationId],
    queryFn: () =>
      request(`/api/logs/trace/${encodeURIComponent(correlationId)}`),
    enabled:
      canLogs &&
      !!correlationId &&
      operationAvailable(spec, "/api/logs/trace/{correlation_id}", "GET"),
  });
  const searchRows = records(search.data);
  const searchTotal =
    typeof search.data?.total === "number" ? search.data.total : undefined;
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
    searchPaging.onPage(0);
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
            {canLogs &&
              submitted.correlation &&
              operationAvailable(
                spec,
                "/api/logs/trace/{correlation_id}",
                "GET",
              ) && (
                <button
                  className="button secondary"
                  onClick={() => setCorrelationId(submitted.correlation)}
                >
                  {en ? "View correlation detail" : "查看关联详情"}
                </button>
              )}
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
                      render: (row) =>
                        row.correlation_id &&
                        operationAvailable(
                          spec,
                          "/api/logs/trace/{correlation_id}",
                          "GET",
                        ) ? (
                          <button
                            className="text-button"
                            onClick={() =>
                              setCorrelationId(String(row.correlation_id))
                            }
                          >
                            {text(row.correlation_id)}
                          </button>
                        ) : (
                          text(row.correlation_id)
                        ),
                    },
                    { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  ]}
                />
                <Pager
                  {...searchPaging}
                  total={searchTotal}
                  hasNext={searchRows.length === searchPaging.pageSize}
                  busy={search.isFetching}
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
                  rows={auditRows.slice(0, auditPaging.pageSize)}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "action", label: en ? "Action" : "操作" },
                    { key: "resource_type", label: en ? "Resource" : "资源" },
                    { key: "user_email", label: en ? "User" : "用户" },
                    { key: "success", label: en ? "Success" : "成功" },
                    { key: "requires_review", label: en ? "Review" : "复核" },
                  ]}
                />
                <Pager
                  {...auditPaging}
                  hasNext={auditRows.length > auditPaging.pageSize}
                  busy={audit.isFetching}
                  en={en}
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
                  rows={securityRows.slice(0, securityPaging.pageSize)}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "severity", label: en ? "Severity" : "严重度" },
                    { key: "event_type", label: en ? "Event" : "事件" },
                    { key: "category", label: en ? "Category" : "类别" },
                    { key: "threat_score", label: en ? "Threat" : "威胁分" },
                    { key: "resolved", label: en ? "Resolved" : "已解决" },
                  ]}
                />
                <Pager
                  {...securityPaging}
                  hasNext={securityRows.length > securityPaging.pageSize}
                  busy={security.isFetching}
                  en={en}
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
                      ? "Latest 100 audit and security records"
                      : "最近 100 条审计与安全活动"
                  }
                  onRefresh={refresh}
                  busy={activity.isFetching}
                  en={en}
                />
                <QueryState query={activity} en={en} />
                <div
                  className="governance-recent-records"
                  tabIndex={0}
                  role="region"
                  aria-label={en ? "Recent activity" : "最近活动"}
                >
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
                </div>
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
          {correlationId && canLogs && (
            <DetailDialog
              title={en ? "Correlation detail" : "关联详情"}
              onClose={() => setCorrelationId("")}
              en={en}
            >
              <PanelHeader
                icon={<FileText size={18} />}
                title={en ? "Correlation detail" : "关联详情"}
                subtitle={correlationId}
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
            </DetailDialog>
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

function TraceIdentifier({
  value,
  onSelect,
  en,
}: {
  value: string;
  onSelect: () => void;
  en: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  if (!value) return <>—</>;
  return (
    <div className="trace-identifier">
      <button
        type="button"
        className="text-button trace-id-button"
        title={en ? "Open trace details" : "查看 Trace 详情"}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {value}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`${en ? "Copy Trace ID" : "复制 Trace ID"} ${value}`}
        onClick={async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setError("");
          } catch {
            setError(
              en
                ? "Clipboard unavailable; select and copy the ID."
                : "剪贴板不可用，请选中 ID 手动复制。",
            );
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {copied && <small role="status">{en ? "Copied" : "已复制"}</small>}
      {error && <small role="alert">{error}</small>}
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
  const tracePaging = usePaging();
  const canAdmin = permitted(session.permissions, "admin.system_config");
  const canMetrics = permitted(session.permissions, "metrics:read");
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
  const timeseriesEnabled =
    canMetrics &&
    operationAvailable(spec, "/v1/observability/metrics/timeseries", "GET");
  const percentilesEnabled =
    canMetrics &&
    operationAvailable(spec, "/v1/observability/metrics/percentiles", "GET");
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
    const params = new URLSearchParams({
      limit: String(tracePaging.pageSize + 1),
      offset: String(tracePaging.page * tracePaging.pageSize),
    });
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    return params.toString();
  }, [filters, tracePaging.page, tracePaging.pageSize]);
  const traces = useQuery({
    queryKey: ["governance", "observability", "traces", traceQueryString],
    queryFn: () => request(`/v1/observability/traces?${traceQueryString}`),
    enabled:
      canAdmin && operationAvailable(spec, "/v1/observability/traces", "GET"),
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
  const timeseriesRows = metricRows(timeseries.data, "timeseries");
  const percentileRows = metricRows(percentiles.data, "percentiles");
  const lastPercentile = [...percentileRows]
    .reverse()
    .find((row) =>
      [row.p50, row.p95, row.p99].some(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
    );
  const traceRows = records(traces.data);
  const spanRows = records(detail.data?.spans)
    .slice()
    .sort((a, b) =>
      String(b.start_time || "").localeCompare(String(a.start_time || "")),
    );
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
      <p className="field-help governance-timezone">
        {en ? "Times shown in browser timezone: " : "时间显示为浏览器时区："}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
        {en
          ? ". Backend timestamps without an offset are interpreted as UTC. Hover over a time to see the original value."
          : "。后端未附时区的时间按 UTC 解释；悬停可查看原始值。"}
      </p>
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
            {timeseriesEnabled ? (
              <QueryState query={timeseries} en={en} />
            ) : (
              <p className="alert info">
                {en
                  ? "Request metrics are not enabled or permitted."
                  : "请求指标未启用，或当前账户无权查看。"}
              </p>
            )}
            {percentilesEnabled ? (
              <QueryState query={percentiles} en={en} />
            ) : (
              <p className="alert info">
                {en
                  ? "Latency percentiles are not enabled or permitted."
                  : "延迟分位数未启用，或当前账户无权查看。"}
              </p>
            )}
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
                    value={formatOperationalValue(value, key, en) ?? value}
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
              <details className="metric-buckets">
                <summary>
                  {en
                    ? "Request counts by time bucket (latest 24)"
                    : "按时间桶查看请求数（最近 24 桶）"}{" "}
                  · {timeseriesRows.length}
                </summary>
                <Table
                  en={en}
                  rows={timeseriesRows.slice(-24)}
                  columns={[
                    { key: "timestamp", label: en ? "Time" : "时间" },
                    { key: "request_count", label: en ? "Requests" : "请求" },
                    { key: "error_count", label: en ? "Errors" : "错误" },
                    {
                      key: "success_count",
                      label: en ? "Successful requests" : "成功请求",
                    },
                  ]}
                />
              </details>
            )}
            <section className="latency-percentiles">
              <h4>{en ? "Latency percentiles" : "延迟分位数"}</h4>
              <p className="field-help">
                {!percentilesEnabled
                  ? en
                    ? "Latency metrics unavailable."
                    : "延迟指标不可用。"
                  : percentiles.error
                    ? en
                      ? "Could not load latency samples. Retry the request."
                      : "未能读取延迟样本，请重试。"
                    : percentiles.isPending
                      ? en
                        ? "Loading latency samples…"
                        : "正在读取延迟样本…"
                      : lastPercentile
                        ? `${en ? "Latest sampled bucket: " : "最近有样本的时间桶："}${formatTimestamp(lastPercentile.timestamp, en)}`
                        : en
                          ? "No latency samples in this time window."
                          : "此时间窗内暂无延迟样本。"}
              </p>
              <div className="percentile-cards">
                {["p50", "p95", "p99"].map((key) => (
                  <MetricCard
                    key={key}
                    label={key.toUpperCase()}
                    value={formatDuration(lastPercentile?.[key], en)}
                  />
                ))}
              </div>
              <p className="field-help">
                {en
                  ? "P50 / P95 / P99 show the latency within which 50% / 95% / 99% of requests completed in that bucket. Empty buckets are not zero latency."
                  : "P50 / P95 / P99 表示该时间桶内 50% / 95% / 99% 请求完成所需的耗时上界。空桶不表示延迟为零。"}
              </p>
              {percentileRows.length > 0 && (
                <details className="metric-buckets">
                  <summary>
                    {en
                      ? "Latency by time bucket (latest 24)"
                      : "按时间桶查看延迟（最近 24 桶）"}{" "}
                    · {percentileRows.length}
                  </summary>
                  <Table
                    en={en}
                    rows={percentileRows.slice(-24)}
                    columns={[
                      { key: "timestamp", label: en ? "Time" : "时间" },
                      { key: "p50", label: "P50" },
                      { key: "p95", label: "P95" },
                      { key: "p99", label: "P99" },
                    ]}
                  />
                </details>
              )}
            </section>
            {queryPerformance.data && (
              <details className="advanced-fields">
                <summary>
                  {en
                    ? "Advanced: query performance JSON"
                    : "高级：查询性能原始数据"}
                </summary>
                <pre className="governance-json">
                  {JSON.stringify(redact(queryPerformance.data), null, 2)}
                </pre>
              </details>
            )}
            <details className="advanced-fields">
              <summary>
                {en ? "Advanced: raw metric responses" : "高级：指标原始响应"}
              </summary>
              <pre className="governance-json">
                {JSON.stringify(
                  redact({
                    timeseries: timeseries.data,
                    percentiles: percentiles.data,
                    stats: stats.data,
                  }),
                  null,
                  2,
                )}
              </pre>
            </details>
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
                  onClick={() => {
                    setFilters(draft);
                    tracePaging.onPage(0);
                  }}
                >
                  {en ? "Apply filters" : "应用筛选"}
                </button>
              </div>
              <QueryState query={traces} en={en} />
              <Table
                en={en}
                rows={traceRows.slice(0, tracePaging.pageSize)}
                onRow={(row) =>
                  setTraceId(String(row.trace_id || row.id || ""))
                }
                columns={[
                  {
                    key: "trace_id",
                    label: "Trace ID",
                    render: (row) => (
                      <TraceIdentifier
                        value={String(row.trace_id || row.id || "")}
                        onSelect={() =>
                          setTraceId(String(row.trace_id || row.id || ""))
                        }
                        en={en}
                      />
                    ),
                  },
                  { key: "start_time", label: en ? "Start" : "开始" },
                  { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  { key: "status", label: en ? "Status" : "状态" },
                  { key: "http_method", label: "HTTP" },
                  { key: "user_email", label: en ? "User" : "用户" },
                ]}
              />
              <Pager
                {...tracePaging}
                hasNext={traceRows.length > tracePaging.pageSize}
                busy={traces.isFetching}
                en={en}
              />
            </section>
          )}
          {traceId && canAdmin && (
            <DetailDialog
              title={en ? "Selected trace" : "选中的 trace"}
              onClose={() => setTraceId("")}
              en={en}
            >
              <PanelHeader
                icon={<FileText size={18} />}
                title={en ? "Selected trace" : "选中的 trace"}
                subtitle={traceId}
                onRefresh={() => {
                  void detail.refetch();
                }}
                busy={detail.isFetching}
                en={en}
              />
              <QueryState query={detail} en={en} />
              {detail.data && (
                <>
                  <div className="governance-stats">
                    <MetricCard
                      label={en ? "Operation" : "操作"}
                      value={detail.data.name}
                    />
                    <MetricCard
                      label={en ? "Status" : "状态"}
                      value={detail.data.status}
                    />
                    <MetricCard
                      label={en ? "Duration" : "耗时"}
                      value={formatDuration(detail.data.duration_ms, en)}
                    />
                    <MetricCard
                      label={en ? "Started at" : "开始时间"}
                      value={formatTimestamp(detail.data.start_time, en)}
                    />
                  </div>
                  <details className="advanced-fields">
                    <summary>
                      {en
                        ? "Advanced: raw trace response"
                        : "高级：Trace 原始响应"}
                    </summary>
                    <pre className="governance-json">
                      {JSON.stringify(redact(detail.data), null, 2)}
                    </pre>
                  </details>
                </>
              )}
              <PagedTable
                key={traceId}
                en={en}
                rows={spanRows}
                columns={[
                  { key: "span_id", label: "Span ID" },
                  { key: "name", label: en ? "Operation" : "操作" },
                  { key: "start_time", label: en ? "Start" : "开始" },
                  { key: "duration_ms", label: en ? "Duration" : "耗时" },
                  { key: "status", label: en ? "Status" : "状态" },
                ]}
              />
            </DetailDialog>
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

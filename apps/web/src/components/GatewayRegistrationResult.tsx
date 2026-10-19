import { useContext, useEffect, useState } from "react";
import { SessionContext, useText } from "../session";
import {
  request,
  displayError,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import { loadResourcePages } from "../list-model.mjs";
import { readField, safeDisplay } from "../resource-model.mjs";

export function GatewayRegistrationResult({
  gateway,
  spec,
}: {
  gateway: JsonRecord;
  spec: JsonRecord;
}) {
  const t = useText();
  const session = useContext(SessionContext);
  const [current, setCurrent] = useState(gateway);
  const [count, setCount] = useState<number>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const tools = spec.paths?.["/v1/tools"]?.get;
  const detailPath = "/v1/gateways/{gateway_id}";
  const detail = spec.paths?.[detailPath]?.get;
  const canRead = (op: JsonRecord | undefined, fallback: string) =>
    !!op &&
    op["x-panel-available"] !== false &&
    (!op["x-panel-admin"] || session.user?.is_admin) &&
    permitted(session.permissions, op["x-panel-permission"] || fallback);
  const canReadTools = canRead(tools, "tools.read");
  const canRefresh = canRead(detail, "gateways.read");
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setBusy(true);
      setError("");
      setCount(undefined);
      try {
        const next =
          revision && canRefresh
            ? await request(
                detailPath.replace(
                  "{gateway_id}",
                  encodeURIComponent(gateway.id),
                ),
                { signal: abort.signal },
              )
            : gateway;
        if (abort.signal.aborted) return;
        setCurrent(next);
        if (
          next.status === "active" &&
          next.reachable !== false &&
          canReadTools
        ) {
          const rows = await loadResourcePages(
            { ...tools, path: "/v1/tools" },
            request,
            { signal: abort.signal, gateway: gateway.id },
          );
          if (!abort.signal.aborted)
            setCount(
              rows.filter(
                (row: JsonRecord) =>
                  readField(row, "gateway_id") === gateway.id,
              ).length,
            );
        }
      } catch (err) {
        if (!abort.signal.aborted) setError(displayError(err));
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    if (gateway.id) void load();
    return () => abort.abort();
  }, [gateway, revision, canReadTools, canRefresh]);
  const active = current.status === "active" && current.reachable !== false;
  return (
    <div>
      <h3>{t("MCP 服务接入结果", "MCP service connection result")}</h3>
      <p role="status">
        {current.status === "pending"
          ? t(
              "网关已登记，正在等待连接与工具发现。可稍后刷新结果。",
              "Gateway registered; connection and discovery are pending. Refresh the result later.",
            )
          : active
            ? t(
                "已连接上游 MCP 服务。",
                "Connected to the upstream MCP service.",
              )
            : t(
                "网关已登记，但连接尚未就绪。请检查网关状态与认证配置。",
                "Gateway registered, but the connection is not ready. Check its status and authentication.",
              )}
      </p>
      {(readField(current, "last_error") ||
        readField(current, "status_message")) && (
        <p className="alert warning">
          {String(
            safeDisplay(
              readField(current, "last_error") ||
                readField(current, "status_message"),
            ),
          )}
        </p>
      )}
      {busy && <p>{t("正在读取发现结果…", "Reading discovery results…")}</p>}
      {count !== undefined && (
        <p>
          {t(`已发现 ${count} 个工具`, `${count} tools discovered`)}
          {count === 0
            ? t(
                "；当前账户可访问的工具列表中尚无此网关的工具。",
                "; no tools from this gateway are currently visible to your account.",
              )
            : ""}
        </p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {t(
            "网关已保存，读取发现结果失败：",
            "Gateway saved; could not read discovery results: ",
          )}
          {error}
        </div>
      )}
      {!canReadTools && (
        <p>
          {t(
            "当前账户无权读取工具发现清单。",
            "Your account cannot read the discovered tool list.",
          )}
        </p>
      )}
      <p className="field-help">
        {t(
          "发现数量基于当前账户可访问的工具；连接与发现成功不代表工具调用已经验证。",
          "Counts cover tools visible to your account. Connection and discovery do not verify tool execution.",
        )}
      </p>
      <div className="toolbar">
        {canRefresh && gateway.id && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            {t("刷新发现结果", "Refresh discovery results")}
          </button>
        )}
        {canReadTools && gateway.id && (
          <button
            type="button"
            className="button primary"
            onClick={() => {
              window.location.hash =
                "tools?gateway=" + encodeURIComponent(gateway.id);
            }}
          >
            {t("查看发现的工具", "View discovered tools")}
          </button>
        )}
      </div>
    </div>
  );
}

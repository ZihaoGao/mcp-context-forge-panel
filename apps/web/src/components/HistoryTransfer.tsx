import { WorkflowDialog } from "./WorkflowDialog";
import { useState } from "react";
import { type JsonRecord, displayError } from "../../../../packages/api-client";
import { downloadJson, safeDisplay } from "../resource-model.mjs";
import { RecordDetails } from "./ResourceDialog";

/** A local inspection tool, deliberately separate from backend data ingestion. */
function HistoryTransferDialog({
  kind,
  value,
  onClose,
}: {
  kind: "logs" | "observability";
  value: JsonRecord;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<JsonRecord>();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const envelope = (data: JsonRecord) => ({
    format: "contextforge-panel-history",
    version: 1,
    resource: kind,
    exported_at: new Date().toISOString(),
    data: safeDisplay(data),
  });
  async function read(file?: File) {
    setError("");
    setSnapshot(undefined);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("文件最大为 5 MiB");
      const parsed = JSON.parse(await file.text());
      if (
        parsed?.format !== "contextforge-panel-history" ||
        parsed.version !== 1 ||
        parsed.resource !== kind ||
        !parsed.data ||
        typeof parsed.data !== "object" ||
        Array.isArray(parsed.data)
      )
        throw new Error("快照格式或栏目不匹配，请使用此处模板。");
      setSnapshot(safeDisplay(parsed.data));
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  const matched = snapshot
    ? Object.fromEntries(
        Object.entries(snapshot).filter(([k, v]) =>
          `${k} ${JSON.stringify(v)}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
        ),
      )
    : undefined;
  return (
    <WorkflowDialog
      title="查询快照 · 导入与导出"
      className="transfer-panel"
      busy={busy}
      onClose={onClose}
    >
      <p className="field-help">
        导出当前查询已加载的数据（含当前页）。后端没有写入历史日志或指标的接口；导入仅在本地查看，不会写回后端。已知凭据字段会被隐藏。
      </p>
      <div className="toolbar">
        <button
          className="button secondary"
          onClick={() => downloadJson(`${kind}-snapshot.json`, envelope(value))}
        >
          导出当前查询
        </button>
        <button
          className="button secondary"
          onClick={() =>
            downloadJson(
              `${kind}-snapshot-template.json`,
              envelope(
                kind === "logs"
                  ? { logs: [], audit: [], security: [] }
                  : { traces: [], timeseries: [], percentiles: [] },
              ),
            )
          }
        >
          下载快照模板
        </button>
      </div>
      <label className="field">
        导入快照到本地查看
        <input
          disabled={busy}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void read(e.target.files?.[0])}
        />
      </label>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {snapshot && (
        <div className="governance-preview">
          <strong>本地快照（未写入后端）</strong>
          <label className="field">
            筛选快照分组
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索字段名或内容"
            />
          </label>
          <RecordDetails value={matched} />
          <button
            className="text-button"
            onClick={() => setSnapshot(undefined)}
          >
            关闭本地快照
          </button>
        </div>
      )}
    </WorkflowDialog>
  );
}

export function HistoryTransfer({
  kind,
  value,
  en,
}: {
  kind: "logs" | "observability";
  value: JsonRecord;
  en: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)}>
        {en ? "Query snapshots: import / export" : "查询快照：导入 / 导出"}
      </button>
      {open && (
        <HistoryTransferDialog
          kind={kind}
          value={value}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

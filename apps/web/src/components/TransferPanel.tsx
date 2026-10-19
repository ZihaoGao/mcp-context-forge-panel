import { WorkflowDialog } from "./WorkflowDialog";
import { useState } from "react";
import {
  request,
  send,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import {
  resolveSchema,
  recordId,
  runBatch,
} from "../../../../packages/api-client/contract.mjs";
import {
  resourceBody,
  resourceProfiles,
  portableRecord,
  validateValue,
  downloadJson,
  safeDisplay,
  redactSecrets,
} from "../resource-model.mjs";
import type { Operation } from "./ActionDialog";
import {
  isLocalRestTool,
  restToolProblems,
  restToolTemplate,
} from "../tool-workflows.mjs";

function sample(schema: JsonRecord, spec: JsonRecord, key = ""): any {
  const s = resolveSchema(schema, spec);
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.type === "object" || s.properties)
    return Object.fromEntries(
      (s.required || []).map((k: string) => [
        k,
        sample(s.properties[k], spec, k),
      ]),
    );
  if (s.type === "array") return [];
  if (s.type === "boolean") return false;
  if (["number", "integer"].includes(s.type)) return s.minimum ?? 1;
  if (key === "email") return "person@example.com";
  if (["url", "endpoint_url"].includes(key)) return "https://example.com/mcp";
  if (key === "uri") return "context://example";
  return key === "password"
    ? ""
    : key === "name"
      ? "请填写名称"
      : key === "template"
        ? "请填写模板正文"
        : key === "content"
          ? "请填写资源内容"
          : "";
}
export function TransferPanel({
  moduleId,
  spec,
  create,
  detail,
  records,
  loadAll,
  onSuccess,
  en,
  onClose,
}: {
  moduleId: string;
  spec: JsonRecord;
  create?: Operation;
  detail?: Operation;
  records: JsonRecord[];
  loadAll: () => Promise<JsonRecord[] | undefined>;
  onSuccess: () => void;
  en: boolean;
  onClose: () => void;
}) {
  const profile = (resourceProfiles as Record<string, any>)[moduleId];
  const tools = moduleId === "tools";
  const t = (zh: string, english: string) => (en ? english : zh);
  const content = create?.requestBody?.content || {};
  const mime =
    Object.keys(content).find((k) => k.includes("json")) ||
    Object.keys(content)[0];
  // Read-only resources still have snapshots/templates. Their import preview
  // is local: no backend write endpoint means no invented write capability.
  const { schema, root, wrapper } = resourceBody(content[mime]?.schema, spec);
  const updateExisting = moduleId === "plugins";
  const register = moduleId === "catalog";
  const payload = (row: JsonRecord) => {
    const body: JsonRecord = tools
      ? { integration_type: "REST", request_type: "POST", ...row }
      : { ...row };
    if (updateExisting) delete body.name;
    if (register) delete body.catalog_id;
    return wrapper ? { [wrapper]: body } : body;
  };
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [results, setResults] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [issued, setIssued] = useState<{ name: string; key: string }[]>([]);
  const writable =
    !!create &&
    mime === "application/json" &&
    create["x-panel-available"] !== false;
  const envelope = (items: JsonRecord[], kind = "create") => ({
    format: "contextforge-panel",
    version: 1,
    resource: moduleId,
    kind,
    notes: tools
      ? t(
          "REST 定义仅用于创建本地 REST 工具；snapshot 仅为工具清单，不能恢复 MCP 连接。不包含凭据，导入后需重新配置认证。MCP 迁移请使用系统设置的原生配置迁移。",
          "REST definitions create local REST tools only. Snapshots are inventories and cannot restore MCP connections. Credentials are excluded; reconfigure authentication after import. Use native configuration migration in Settings for MCP services.",
        )
      : `不包含明文凭据。关联 ID 仅适用于原环境；跨环境请重新选择。${updateExisting ? "导入修改已安装插件的运行模式。" : register ? "导入注册目录中的现有服务。" : "导入只创建，不覆盖已有项。"}`,
    records: items,
  });
  const problems = rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      return ["每条记录必须是对象"];
    const body = payload(row);
    const errors = writable ? validateValue(body, root, spec) : [];
    if (tools && writable) errors.push(...restToolProblems(row, en));
    if (
      writable &&
      (updateExisting || register) &&
      !row[register ? "catalog_id" : "name"]
    )
      errors.push(`${register ? "catalog_id" : "name"}：必填`);
    if (writable)
      for (const key of Object.keys(row))
        if (
          !schema.properties?.[key] &&
          !(updateExisting && key === "name") &&
          !(register && key === "catalog_id")
        )
          errors.push(`${key}：模板中未定义的字段`);
    const identity = row.name || row.email || row.uri;
    if (
      identity &&
      rows.findIndex((v) => (v.name || v.email || v.uri) === identity) !== i
    )
      errors.push("文件内名称 / 邮箱 / URI 重复");
    if (
      identity &&
      !updateExisting &&
      !register &&
      records.some((v) => (v.name || v.email || v.uri) === identity)
    )
      errors.push("当前选中项或当前页已存在同名记录；请改名，避免重复创建");
    return errors;
  });
  async function exportRecords(all = false, snapshot = false) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const source = all ? await loadAll() : records;
      if (!source)
        throw new Error(
          en
            ? "Could not load all matching records. Close this dialog to review the list error, then retry."
            : "无法加载全部匹配项，请关闭弹窗查看列表错误后重试。",
        );
      const out: JsonRecord[] = [];
      let skipped = 0;
      for (const row of source) {
        let full = row;
        if (detail) {
          const path = detail.path.replace(
            /\{[^}]+\}/g,
            encodeURIComponent(
              String(moduleId === "users" ? row.email : recordId(row)),
            ),
          );
          full = await request(path);
        }
        if (tools && writable && !snapshot && !isLocalRestTool(full)) {
          skipped++;
          continue;
        }
        const clean =
          writable && !snapshot
            ? portableRecord(full, schema, spec)
            : redactSnapshot(full);
        if (updateExisting) clean.name = full.name;
        if (register) clean.catalog_id = full.id;
        out.push(clean);
      }
      if (tools && writable && !snapshot && !out.length)
        throw new Error(
          t(
            "所选范围没有可导出的本地 REST 工具。MCP / A2A 工具请导出工具清单快照；服务迁移请使用系统设置。",
            "No local REST tools in this selection. Export an inventory snapshot for MCP / A2A tools; use Settings for service migration.",
          ),
        );
      const kind = writable && !snapshot ? "create" : "snapshot";
      downloadJson(
        `${moduleId}-${kind === "create" ? (tools ? "rest-definitions" : "definitions") : "snapshot"}.json`,
        envelope(out, kind),
      );
      if (skipped)
        setNotice(
          t(
            `已导出 ${out.length} 个 REST 工具，跳过 ${skipped} 个来自 MCP / A2A 等服务的工具。完整清单请使用快照导出。`,
            `Exported ${out.length} REST tools; skipped ${skipped} service-managed tools (MCP / A2A, etc.). Use a snapshot for the complete inventory.`,
          ),
        );
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    setRows([]);
    setResults([]);
    setIssued([]);
    setApproved(false);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("文件最大为 5 MiB");
      const data = JSON.parse(await file.text());
      if (
        !Array.isArray(data) &&
        (data.format !== "contextforge-panel" ||
          data.version !== 1 ||
          data.resource !== moduleId)
      )
        throw new Error("文件格式、版本或资源栏目不匹配，请使用此处模板。");
      const items = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(items) || !items.length || items.length > 1000)
        throw new Error("需要 1–1000 条记录");
      if (writable && data.kind === "snapshot")
        throw new Error("只读快照不能作为创建配置导入，请使用创建模板。");
      setRows(items);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function importRows() {
    if (busy || !writable || !approved || problems.some((v) => v.length))
      return;
    setBusy(true);
    setResults([]);
    setError("");
    try {
      await runBatch(
        rows,
        async (row: JsonRecord) => {
          const result = await send(
            create!.path.replace(
              /\{[^}]+\}/g,
              encodeURIComponent(String(register ? row.catalog_id : row.name)),
            ),
            create!.method,
            payload(row),
          );
          if (result?.access_token)
            setIssued((prev) => [
              ...prev,
              { name: row.name, key: result.access_token },
            ]);
        },
        {
          concurrency: 3,
          onResult: (r: JsonRecord) => setResults((prev) => [...prev, r]),
        },
      );
      onSuccess();
      setApproved(false);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowDialog
      title={
        tools && writable
          ? t("REST 工具导入 / 导出", "REST tool import / export")
          : tools
            ? t("工具清单快照", "Tool inventory snapshot")
            : `${profile?.noun || moduleId} · ${en ? "Import / export" : "导入与导出"}`
      }
      className="transfer-panel"
      busy={busy}
      onClose={onClose}
      en={en}
      footer={
        writable && !!rows.length ? (
          <button
            className="button primary"
            disabled={
              busy ||
              !approved ||
              problems.some((v) => v.length) ||
              !!results.length
            }
            onClick={importRows}
          >
            {busy ? "正在导入…" : "确认导入"}
          </button>
        ) : undefined
      }
    >
      <p className="field-help">
        {tools && !writable ? (
          t(
            "当前仅提供工具清单快照的导出与本地预览；快照不能创建工具或恢复 MCP 连接。",
            "Only tool inventory export and local preview are available. Snapshots cannot create tools or restore MCP connections.",
          )
        ) : tools ? (
          t(
            "仅导入本面板格式的 REST 工具定义 JSON。MCP 服务请从工具页“接入 MCP 服务”；A2A 工具由智能体管理。REST 定义导出会排除这些服务管理的工具，工具清单快照包含所有类型但不能用于创建。配置备份与迁移请使用系统设置。导出移除凭据，导入后需重新配置认证。",
            "Import REST tool definition JSON in this panel’s format. Use “Connect MCP service” for MCP services; A2A tools are managed through agents. REST exports exclude service-managed tools. Inventory snapshots include all types but cannot create tools. Use Settings for backup and migration. Credentials are removed; reconfigure authentication after import.",
          )
        ) : (
          <>
            导出{writable ? "可创建配置" : "只读快照"}，自动移除凭据。关联的资源
            ID 不会跨环境自动转换。
            {moduleId === "tokens"
              ? "导入会签发新 Key，无法还原旧 Key；成功后在弹窗中逐个复制明文。"
              : moduleId === "users"
                ? "导出不包含密码；导入前需在文件中补充初始密码。"
                : ""}
          </>
        )}
      </p>
      <div className="toolbar">
        <button
          className="button secondary"
          disabled={busy || !records.length}
          onClick={() => exportRecords()}
        >
          {tools && writable
            ? t(
                "导出 REST 定义：已选 / 当前页",
                "Export REST definitions: selected / current page",
              )
            : "导出已选 / 当前页"}{" "}
          ({records.length})
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => exportRecords(true)}
        >
          {tools && writable
            ? t(
                "导出 REST 定义：全部匹配项",
                "Export REST definitions: all matches",
              )
            : "导出全部匹配项"}
        </button>
        {tools && writable && (
          <>
            <button
              className="button secondary"
              disabled={busy || !records.length}
              onClick={() => exportRecords(false, true)}
            >
              {t(
                "导出工具清单快照：已选 / 当前页",
                "Export tool inventory snapshot: selected / current page",
              )}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => exportRecords(true, true)}
            >
              {t(
                "导出工具清单快照：全部匹配项",
                "Export tool inventory snapshot: all matches",
              )}
            </button>
          </>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            downloadJson(`${moduleId}-template.json`, {
              ...envelope(
                [
                  writable
                    ? tools
                      ? restToolTemplate
                      : {
                          ...sample(schema, spec),
                          ...(profile?.defaults || {}),
                          ...(updateExisting
                            ? { name: "已安装插件名称" }
                            : register
                              ? { catalog_id: "目录服务 ID" }
                              : {}),
                        }
                    : {},
                ],
                writable ? "create" : "snapshot",
              ),
              instructions:
                tools && writable
                  ? t(
                      "这是本面板的 REST 工具定义格式，不是 OpenAPI 文档或 MCP 客户端连接配置。示例 lookup_order 使用 POST 发送包含 order_id 的 JSON 请求。将 url 改为真实 REST API 地址，按接口修改 inputSchema；先完成本地预检查，再确认创建。预检查不验证端点连接、认证或工具调用。",
                      "This is the panel’s REST tool definition format, not an OpenAPI document or MCP client configuration. lookup_order POSTs a JSON body containing order_id. Replace url with your REST API endpoint and adapt inputSchema. Preview before confirming creation. Local checks do not verify connectivity, authentication or execution.",
                    )
                  : writable
                    ? "编辑 records 数组中的字段，保存后选择文件预检查。不要把生产凭据提交到 Git。"
                    : "此栏目没有可创建资源的后端接口。可导入快照在本地查看，不会写入后端。",
            })
          }
        >
          {tools && writable
            ? t("下载 REST 示例模板", "Download REST example template")
            : "下载模板"}
        </button>
      </div>
      {tools && writable && (
        <details>
          <summary>
            {t("REST 模板怎么填写？", "How to fill in the REST template")}
          </summary>
          <p className="field-help">
            {t(
              "模板示例按 order_id 查询订单：将 url 换成你的 API 地址，选择 request_type，并用 inputSchema 描述请求参数。records 中每项创建一个 REST 工具；不支持直接上传 OpenAPI / Swagger 文档或 MCP 客户端配置。",
              "The example looks up an order by order_id: replace url with your API address, select request_type and describe request parameters in inputSchema. Each records entry creates one REST tool. OpenAPI / Swagger documents and MCP client configurations are not accepted.",
            )}
          </p>
          <pre>{JSON.stringify(restToolTemplate, null, 2)}</pre>
        </details>
      )}
      {notice && (
        <p className="info-banner" role="status">
          {notice}
        </p>
      )}
      <label className="field">
        选择 JSON 文件 · 先预览，不会立即写入
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => void readFile(e.target.files?.[0])}
        />
      </label>
      {!writable && (
        <p className="info-banner">
          当前账户或后端不提供此资源的创建接口。快照可导入本地查看；配置变更请使用系统设置提供的维护功能。
        </p>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!!rows.length && (
        <>
          <h4>预检查 · {rows.length} 条</h4>
          <p className="field-help">
            检查必填项、类型、枚举、范围和文件内重复。后端仍会检查权限、唯一性和连接可用性；失败项会逐条保留原因。
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>名称</th>
                  <th>检查结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{r?.name || r?.email || r?.uri || "—"}</td>
                    <td className={problems[i].length ? "error-text" : ""}>
                      {problems[i].join("；") ||
                        (writable
                          ? updateExisting
                            ? "可更新模式"
                            : register
                              ? "可注册"
                              : tools
                                ? t(
                                    "本地格式检查通过",
                                    "Local format checks passed",
                                  )
                                : "可创建"
                          : "仅本地预览")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && (
            <p className="field-help">
              显示前 50 行；已预检查全部 {rows.length} 行。
              {problems.slice(50).filter((v) => v.length).length}{" "}
              个问题行在其余记录中。
            </p>
          )}
          {problems.slice(50).some((v) => v.length) && (
            <details>
              <summary>查看其余记录的校验问题</summary>
              {problems.slice(50).map((issues, i) =>
                issues.length ? (
                  <p key={i} className="error-text">
                    第 {i + 51} 行：{issues.join("；")}
                  </p>
                ) : null,
              )}
            </details>
          )}
          {!writable && (
            <details>
              <summary>查看快照内容（敏感字段已隐藏）</summary>
              <pre>{JSON.stringify(redactSnapshot(rows), null, 2)}</pre>
            </details>
          )}
          {writable && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy || !!results.length}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                {updateExisting
                  ? "确认修改以上插件的现有运行模式"
                  : register
                    ? "确认注册以上目录服务"
                    : "确认创建以上资源"}
                （逐项执行，可能部分成功）
              </label>
            </>
          )}
          {writable && moduleId === "tokens" && (
            <p className="alert warning">
              批量创建后请逐个复制下方 Key，关闭弹窗后无法重新取得明文。
            </p>
          )}
        </>
      )}
      {!!results.length && (
        <div className="batch-results">
          {results.map((r, i) => (
            <div key={i}>
              <strong>{r.item?.name || r.item?.email || r.item?.uri}</strong>
              <span className={r.ok ? "" : "error-text"}>
                {r.ok ? "成功" : r.error}
              </span>
            </div>
          ))}
        </div>
      )}
      {results.some((v) => !v.ok) && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setRows(results.filter((v) => !v.ok).map((v) => v.item));
            setResults([]);
            setApproved(false);
          }}
        >
          仅重新预览失败项
        </button>
      )}
      {!!issued.length && (
        <div className="key-delivery">
          <h4>立即保存新建的 API Key</h4>
          {issued.map((v, i) => (
            <div key={i}>
              <strong>{v.name}</strong>
              <code>{v.key}</code>
              <button
                className="button secondary"
                onClick={() =>
                  navigator.clipboard
                    .writeText(v.key)
                    .catch(() => setError("剪贴板不可用，请手动复制"))
                }
              >
                复制此 Key
              </button>
            </div>
          ))}
        </div>
      )}
    </WorkflowDialog>
  );
}
function redactSnapshot(value: any): any {
  return safeDisplay(redactSecrets(value));
}

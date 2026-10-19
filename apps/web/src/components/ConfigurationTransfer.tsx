import { WorkflowDialog } from "./WorkflowDialog";
import { useContext, useState } from "react";
import {
  request,
  send,
  permitted,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext } from "../session";
import { downloadJson } from "../resource-model.mjs";
import { RecordDetails } from "./ResourceDialog";

const types: Record<string, string> = {
  servers: "虚拟服务器",
  gateways: "MCP 网关",
  tools: "工具",
  resources: "资源",
  prompts: "提示词",
  roots: "Roots",
};
export function ConfigurationTransfer({ spec }: { spec: JsonRecord }) {
  const [open, setOpen] = useState(false);
  const { permissions } = useContext(SessionContext);
  const available = [
    ["/v1/export", "get", "admin.export"],
    ["/v1/import", "post", "admin.import"],
  ].some(
    ([path, method, permission]) =>
      permitted(permissions, permission) &&
      spec.paths?.[path]?.[method] &&
      spec.paths[path][method]["x-panel-available"] !== false,
  );
  if (!available) return null;
  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)}>
        原生配置备份与迁移
      </button>
      {open && (
        <ConfigurationTransferDialog
          spec={spec}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ConfigurationTransferDialog({
  spec,
  onClose,
}: {
  spec: JsonRecord;
  onClose: () => void;
}) {
  const { permissions } = useContext(SessionContext);
  const available = (path: string, method: string) =>
    spec.paths?.[path]?.[method] &&
    spec.paths[path][method]["x-panel-available"] !== false;
  const canExport =
    permitted(permissions, "admin.export") && available("/v1/export", "get");
  const canImport =
    permitted(permissions, "admin.import") && available("/v1/import", "post");
  const [selected, setSelected] = useState(
    Object.keys(types).filter((k) => k !== "roots"),
  );
  const [inactive, setInactive] = useState(false);
  const [dependencies, setDependencies] = useState(true);
  const [data, setData] = useState<JsonRecord>();
  const [strategy, setStrategy] = useState("skip");
  const [secret, setSecret] = useState("");
  const [preview, setPreview] = useState<JsonRecord>();
  const [result, setResult] = useState<JsonRecord>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function invalidate() {
    setPreview(undefined);
    setResult(undefined);
    setConfirmed(false);
  }
  async function exportConfig() {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams({
        types: selected.join(","),
        include_inactive: String(inactive),
        include_dependencies: String(dependencies),
      });
      const data = await request("/v1/export?" + q);
      downloadJson("contextforge-native-config.json", data);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function readConfig(file?: File) {
    invalidate();
    setData(undefined);
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("文件最大为 10 MiB");
      const data = JSON.parse(await file.text());
      if (
        !data ||
        typeof data !== "object" ||
        !data.version ||
        !data.exported_at ||
        !data.entities ||
        Array.isArray(data.entities) ||
        typeof data.entities !== "object"
      )
        throw new Error(
          "需要 ContextForge 原生导出文件：version、exported_at、entities。各资源列表的创建模板不能在这里导入。",
        );
      for (const [type, values] of Object.entries(data.entities))
        if (
          !types[type] ||
          !Array.isArray(values) ||
          values.some((v) => !v || typeof v !== "object" || Array.isArray(v))
        )
          throw new Error(`实体 ${type} 的格式不正确或当前版本不支持`);
      setData(data);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  async function importConfig(dry: boolean) {
    if (busy || !canImport || !data || (!dry && (!preview || !confirmed)))
      return;
    setError("");
    setBusy(true);
    try {
      const response = await send("/v1/import", "POST", {
        import_data: data,
        conflict_strategy: strategy,
        dry_run: dry,
        ...(secret ? { rekey_secret: secret } : {}),
      });
      if (dry) setPreview(response);
      else {
        setResult(response);
        setConfirmed(false);
      }
    } catch (err) {
      setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  if (!canExport && !canImport) return null;
  const validPreview =
    preview &&
    preview.status === "completed" &&
    !preview.errors?.length &&
    !(preview.progress?.failed > 0);
  return (
    <WorkflowDialog
      title="原生配置备份与迁移"
      footer={
        canImport ? (
          <>
            <button
              className="button secondary"
              disabled={!data || busy}
              onClick={() => importConfig(true)}
            >
              后端预检查（不修改资源）
            </button>
            {validPreview && (
              <button
                className="button primary"
                disabled={!confirmed || busy || !!result}
                onClick={() => importConfig(false)}
              >
                执行配置导入
              </button>
            )}
          </>
        ) : undefined
      }
      className="transfer-panel"
      busy={busy}
      onClose={onClose}
    >
      <p className="field-help">
        使用后端原生格式保留资源依赖关系。目前 v1.0.11
        支持下列六类实体；用户、角色、Key 等请在各自栏目使用模板。
      </p>
      {canExport && (
        <>
          <div className="picker-actions">
            {Object.entries(types).map(([id, label]) => (
              <label key={id} className="check-label">
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, id]
                        : selected.filter((k) => k !== id),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="picker-actions">
            <label className="check-label">
              <input
                type="checkbox"
                checked={inactive}
                onChange={(e) => setInactive(e.target.checked)}
              />
              包含停用资源
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={dependencies}
                onChange={(e) => setDependencies(e.target.checked)}
              />
              包含关联依赖（建议开启）
            </label>
          </div>
          <p className="field-help">
            备份可能包含加密认证配置，请妥善保管。导入端必须能够解密已有认证信息，跨环境迁移请先核对后端加密配置。
          </p>
          <button
            className="button secondary"
            disabled={busy || !selected.length}
            onClick={exportConfig}
          >
            下载原生备份
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              downloadJson("contextforge-native-template.json", {
                version: "2025-03-26",
                exported_at: new Date().toISOString(),
                entities: {
                  servers: [{ name: "example-server", visibility: "private" }],
                },
              })
            }
          >
            下载原生模板
          </button>
        </>
      )}
      {canImport && (
        <>
          <hr />
          <label className="field">
            选择原生配置文件
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => void readConfig(e.target.files?.[0])}
            />
          </label>
          <div className="schema-form">
            <label className="field">
              遇到已有资源
              <select
                value={strategy}
                disabled={busy}
                onChange={(e) => {
                  setStrategy(e.target.value);
                  invalidate();
                }}
              >
                <option value="skip">跳过已有资源（默认）</option>
                <option value="update">覆盖已有配置</option>
                <option value="rename">以新名称创建</option>
                <option value="fail">发现冲突即报错</option>
              </select>
              <small className="field-help">
                覆盖会修改已有资源；预检查后才可执行。
              </small>
            </label>
            <details className="advanced-fields full">
              <summary>高级：重新加密认证信息</summary>
              <label className="field">
                重加密后的新密钥（可选）
                <input
                  type="password"
                  autoComplete="off"
                  value={secret}
                  disabled={busy}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    invalidate();
                  }}
                />
                <small className="field-help">
                  后端先用当前密钥解密，再用此新密钥加密。普通恢复留空；输入内容不会保存在浏览器存储中。
                </small>
              </label>
            </details>
          </div>
          {data && (
            <p>
              {Object.entries(data.entities)
                .map(([k, v]) => `${types[k]} ${(v as unknown[]).length}`)
                .join(" · ")}
            </p>
          )}

          {preview && (
            <div className="governance-preview">
              <h4>预检查结果</h4>
              <RecordDetails value={preview} />
              {validPreview && (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || !!result}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    确认按上述冲突策略导入；可能部分成功
                  </label>
                </>
              )}
            </div>
          )}
          {result && (
            <div className="governance-preview">
              <h4>实际导入结果</h4>
              <RecordDetails value={result} />
            </div>
          )}
        </>
      )}
      {busy && <p>正在处理…</p>}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
    </WorkflowDialog>
  );
}

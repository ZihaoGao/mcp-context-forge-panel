import { useContext, useEffect, useRef, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import {
  request,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import { resolveSchema } from "../../../../packages/api-client/contract.mjs";
import {
  resourceBody,
  resourceProfiles,
  validateValue,
  safeDisplay,
  sensitiveKey,
  fieldCopy,
  readField,
} from "../resource-model.mjs";
import { SchemaForm } from "./SchemaForm";
import { SessionContext } from "../session";
import type { Operation } from "./ActionDialog";

const actionNames: Record<string, string> = {
  state: "更改启用状态",
  refresh: "重新发现工具",
  test: "测试连接",
  validate: "验证配置",
  revoke: "撤销访问",
  metrics: "查看使用统计",
  usage: "查看用量",
  members: "团队成员",
  invitations: "发送团队邀请",
  join: "申请加入团队",
  leave: "退出团队",
  join_requests: "加入申请",
  export: "导出",
  import: "导入",
  execute: "试运行工具",
  invoke: "调用智能体",
  render: "预览提示词",
  content: "读取内容",
  models: "管理模型",
  bindings: "资源绑定",
  permissions: "查看权限",
  reset_password: "重置密码",
  activate: "启用账户",
  deactivate: "停用账户",
  sync: "同步配置",
  probe: "检测连接",
  register: "注册服务",
  discover: "发现模型",
};
export function resourceActionName(op: Operation, noun: string) {
  const tail = op.path.split("/").pop() || "";
  if (op.path.includes("/rbac/users/") && op.path.includes("/roles"))
    return op.method === "DELETE" ? "撤销角色分配" : "分配角色";
  if (op.method === "DELETE")
    return noun === "API Key" ? "撤销 API Key" : `删除${noun}`;
  if (actionNames[tail]) return actionNames[tail];
  if (tail.startsWith("{"))
    return op.method === "GET"
      ? `${noun}详情`
      : ["PUT", "PATCH"].includes(op.method)
        ? `编辑${noun}`
        : `新建${noun}`;
  return op.summary || `${noun}操作`;
}
export function RecordDetails({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="muted">—</span>;
  if (Array.isArray(value))
    return value.length ? (
      <div className="detail-array">
        {value.map((v, i) => (
          <div key={i}>
            <RecordDetails value={v} />
          </div>
        ))}
      </div>
    ) : (
      <span className="muted">无 / None</span>
    );
  if (typeof value === "object")
    return (
      <dl className="record-details">
        {Object.entries(value as JsonRecord).map(([k, v]) => (
          <div key={k}>
            <dt>{(fieldCopy as Record<string, string[]>)[k]?.[0] || k}</dt>
            <dd>
              {sensitiveKey(k) ? "••••••••" : <RecordDetails value={v} />}
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span className="detail-text">
      {typeof value === "boolean"
        ? value
          ? "是 / Yes"
          : "否 / No"
        : String(safeDisplay(value))}
    </span>
  );
}
export function ResourceDialog({
  moduleId,
  operation,
  spec,
  preset = {},
  initial,
  item,
  mode,
  team,
  onClose,
  onSuccess,
  en = false,
}: {
  moduleId: string;
  operation: Operation;
  spec: JsonRecord;
  preset?: Record<string, string>;
  initial?: JsonRecord;
  item?: JsonRecord;
  mode: "create" | "edit" | "action" | "detail";
  team: string;
  onClose: () => void;
  onSuccess: () => void;
  en?: boolean;
}) {
  const session = useContext(SessionContext);
  const profile = (resourceProfiles as Record<string, any>)[moduleId];
  const noun = profile?.noun || "资源";
  const content = operation.requestBody?.content || {};
  const contentType =
    Object.keys(content).find((k) => k.includes("json")) ||
    Object.keys(content)[0];
  const { schema, root, wrapper } = resourceBody(
    content[contentType]?.schema,
    spec,
  );
  const [value, setValue] = useState<JsonRecord>(() => {
    const body = wrapper ? initial?.[wrapper] : initial;
    const defaults = mode === "create" ? profile?.defaults || {} : {};
    return {
      ...defaults,
      ...body,
      ...(mode === "create" && team && schema.properties?.team_id
        ? { team_id: team }
        : {}),
      ...(mode === "create" && team && schema.properties?.teamId
        ? { teamId: team }
        : {}),
    };
  });
  const parameters = (operation.parameters || []).filter(
    (p: any) => p.in !== "cookie" && !(p.in === "path" && preset[p.name]),
  );
  const parameterSchema = {
    type: "object",
    properties: Object.fromEntries(
      parameters.map((p: any) => [
        p.name,
        { ...p.schema, description: p.description },
      ]),
    ),
    required: parameters.filter((p: any) => p.required).map((p: any) => p.name),
  };
  const [params, setParams] = useState<JsonRecord>(() => ({
    ...Object.fromEntries(
      parameters
        .filter(
          (p: any) =>
            p.schema?.default !== undefined && p.schema?.default !== null,
        )
        .map((p: any) => [p.name, p.schema.default]),
    ),
    ...preset,
    ...(operation.path.endsWith("/state")
      ? {
          activate: !(
            item?.is_active ??
            item?.enabled ??
            item?.isActive ??
            true
          ),
        }
      : {}),
  }));
  const [result, setResult] = useState<any>(
    operation["x-panel-local-detail"] ? item : undefined,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(
    !operation["x-panel-local-detail"] &&
      (mode === "edit" || mode === "detail"),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    if (errors.length || result !== undefined)
      dialog.current?.querySelector(".dialog-body")?.scrollTo({ top: 0 });
  }, [errors, result]);
  const destructive =
    operation.method === "DELETE" ||
    /\/(reset|revoke|cleanup|deactivate|leave)(\/|$)/.test(operation.path);
  const title =
    mode === "create"
      ? `新建${noun}`
      : mode === "edit"
        ? `编辑${noun}`
        : resourceActionName(operation, noun);
  function pathFor(values: JsonRecord) {
    let path = operation.path;
    for (const p of operation.parameters || [])
      if (p.in === "path") {
        const id = preset[p.name] || values[p.name];
        if (!id) throw new Error(`请选择 ${p.name}`);
        path = path.replace(`{${p.name}}`, encodeURIComponent(id));
      }
    const q = new URLSearchParams();
    for (const p of parameters)
      if (
        p.in === "query" &&
        values[p.name] !== undefined &&
        values[p.name] !== null &&
        values[p.name] !== ""
      )
        q.set(p.name, String(values[p.name]));
    return path + (q.size ? "?" + q : "");
  }
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    const abort = new AbortController();
    if (
      !operation["x-panel-local-detail"] &&
      (mode === "detail" || mode === "edit")
    ) {
      // Editing a row must start from the complete GET record, not a paginated
      // list projection. Keep the form disabled if the fetch fails.
      const path = pathFor({});
      const getPath = mode === "edit" ? path.split("?")[0] : path;
      request(getPath, { signal: abort.signal })
        .then((data) => {
          if (!alive.current) return;
          if (mode === "detail") setResult(data);
          else {
            const source = data?.[wrapper || ""] || data;
            const normalized: JsonRecord = {};
            for (const key of Object.keys(schema.properties || {})) {
              const v = readField(source, key);
              if (
                v !== undefined &&
                !/^auth/i.test(key) &&
                ![
                  "auth",
                  "oauthConfig",
                  "oauth_config",
                  "oauth_credentials",
                  "headers",
                  "authHeaders",
                  "auth_headers",
                ].includes(key) &&
                !/password|secret|authToken|authValue|auth_token|auth_value|authHeaderValue|auth_header_value|authQueryParamValue|auth_query_param_value|api_key|clientKey|client_key|authType|auth_type/i.test(
                  key,
                )
              )
                normalized[key] = v;
            }
            setValue(normalized);
          }
          setLoading(false);
        })
        .catch((err) => {
          if (alive.current && err.name !== "AbortError")
            setErrors([displayError(err)]);
        });
    }
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, []);
  const primaryKeys =
    mode === "create" || mode === "edit"
      ? [...new Set([...(profile?.fields || []), ...(schema.required || [])])]
      : Object.keys(schema.properties || {});
  const sliceSchema = (keys: string[]) => ({
    ...schema,
    properties: Object.fromEntries(
      keys
        .filter((k) => schema.properties?.[k])
        .map((k) => [k, schema.properties[k]]),
    ),
    required: schema.required?.filter((k: string) => keys.includes(k)),
  });
  const advancedKeys = Object.keys(schema.properties || {}).filter(
    (k) => !primaryKeys.includes(k),
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const body = wrapper
      ? {
          [wrapper]: value,
          ...(team && root.properties?.team_id ? { team_id: team } : {}),
        }
      : value;
    const problems = [
      ...validateValue(params, parameterSchema, spec),
      ...(contentType ? validateValue(body, root, spec) : []),
    ];
    if (moduleId === "catalog" && item?.requires_api_key && !value.api_key)
      problems.push("此目录服务需要 API Key，请填写该服务的访问凭据");
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    try {
      let payload: BodyInit | undefined = contentType
        ? JSON.stringify(body)
        : undefined;
      const headers: Record<string, string> = {};
      if (contentType === "application/x-www-form-urlencoded") {
        payload = new URLSearchParams(
          Object.entries(body).map(([k, v]) => [
            k,
            typeof v === "object" ? JSON.stringify(v) : String(v),
          ]),
        );
        headers["Content-Type"] = contentType;
      }
      const data = await request(pathFor(params), {
        method: operation.method,
        headers,
        body: payload,
      });
      setResult(data ?? { message: "操作已完成" });
      onSuccess();
    } catch (err) {
      setErrors([
        displayError(err),
        "请检查下方已填配置。若后端未返回详细原因，请结合日志与审计定位；此前填写的内容已保留。",
      ]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="action-dialog resource-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          <h2>{title}</h2>
          <p>{item?.name || item?.email || item?.uri || profile?.purpose}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="dialog-body">
          {errors.length > 0 && (
            <div className="alert error" role="alert">
              <strong>请检查以下问题</strong>
              <ul>
                {errors.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
          {loading && (
            <p>
              {errors.length
                ? "未能读取完整配置，请关闭后重试。"
                : "正在读取完整配置…"}
            </p>
          )}
          {!loading && result === undefined && (
            <>
              {(mode === "create" || mode === "edit") && (
                <p className="field-help">{profile?.purpose}</p>
              )}
              {mode === "edit" && (
                <p className="field-help">
                  未填写的凭据保持原值。选择认证方式并填写新凭据才会更换认证；选择
                  none 会移除认证。 请求头与 OAuth
                  配置不回填；需要更换时请填写完整的新配置。
                </p>
              )}
              {parameters.length > 0 && (
                <SchemaForm
                  schema={parameterSchema}
                  spec={spec}
                  value={params}
                  onChange={setParams}
                  all
                />
              )}
              {contentType && (
                <SchemaForm
                  schema={sliceSchema(primaryKeys)}
                  spec={spec}
                  value={value}
                  onChange={setValue}
                  all
                />
              )}
              {!!advancedKeys.length && (
                <details className="advanced-fields">
                  <summary>更多配置（可选） · {advancedKeys.length}</summary>
                  <SchemaForm
                    schema={sliceSchema(advancedKeys)}
                    spec={spec}
                    value={value}
                    onChange={setValue}
                    all
                  />
                </details>
              )}
              {destructive && (
                <div className="alert warning">
                  <p>
                    {moduleId === "tokens"
                      ? "撤销后，使用此 Key 的应用将无法继续访问。请确认已切换应用凭据。"
                      : `此操作将影响「${item?.name || item?.email || noun}」及其使用者。删除后无法从此页面恢复。`}
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已确认操作对象和影响
                  </label>
                </div>
              )}
            </>
          )}
          {result !== undefined && (
            <section className="resource-result result">
              {mode !== "detail" && (
                <div className="alert success">
                  <Check size={18} /> {en ? "Saved successfully" : "操作成功"}
                </div>
              )}
              {result?.access_token ? (
                <div className="key-delivery">
                  <h3>保存 API Key</h3>
                  <p>
                    明文仅在此时显示。关闭页面后无法找回，请保存到安全的凭据管理器中。
                  </p>
                  <code>{result.access_token}</code>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(result.access_token)
                        .then(() => setCopied(true))
                        .catch(() =>
                          setErrors(["无法访问剪贴板，请手动复制。"]),
                        )
                    }
                  >
                    <Copy size={16} />
                    {copied ? "已复制" : "复制 API Key"}
                  </button>
                  <RecordDetails
                    value={{
                      name: result.name || value.name,
                      expires_at: result.expires_at,
                      scope: value.scope,
                    }}
                  />
                </div>
              ) : (
                <RecordDetails value={result} />
              )}
              {mode === "detail" && (
                <details>
                  <summary>查看原始数据（敏感字段已隐藏）</summary>
                  <pre>{JSON.stringify(safeDisplay(result), null, 2)}</pre>
                </details>
              )}
            </section>
          )}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {en ? "Close" : "关闭"}
          </button>
          {!loading && result === undefined && mode !== "detail" && (
            <button
              type="submit"
              className={`button ${destructive ? "danger" : "primary"}`}
              disabled={busy}
            >
              {busy
                ? "正在处理…"
                : mode === "create"
                  ? moduleId === "tokens"
                    ? "创建 API Key"
                    : `创建${noun}`
                  : mode === "edit"
                    ? "保存修改"
                    : title}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

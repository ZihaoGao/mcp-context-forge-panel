import { useEffect, useRef, useState } from "react";
import { X, Play, Download, Square, Copy } from "lucide-react";
import {
  config,
  request,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import {
  initialValue,
  resolveSchema,
} from "../../../../packages/api-client/contract.mjs";
import { SchemaForm } from "./SchemaForm";
import { TokenPermissionContext } from "./TokenPermissions";

export type Operation = JsonRecord & { path: string; method: string };
export function ActionDialog({
  operation,
  spec,
  onClose,
  onSuccess,
  initial,
  preset = {},
  en = false,
}: {
  operation: Operation;
  spec: JsonRecord;
  onClose: () => void;
  onSuccess: () => void;
  initial?: JsonRecord;
  preset?: Record<string, string>;
  en?: boolean;
}) {
  const content = operation.requestBody?.content || {};
  const contentType =
    Object.keys(content).find((k) => k.includes("json")) ||
    Object.keys(content)[0];
  const schema = resolveSchema(content[contentType]?.schema, spec);
  const fileFields = Object.entries(schema.properties || {}).filter(
    ([, s]: any) => resolveSchema(s, spec).format === "binary",
  );
  const formSchema = fileFields.length
    ? {
        ...schema,
        properties: Object.fromEntries(
          Object.entries(schema.properties).filter(
            ([name]) => !fileFields.some(([fileName]) => fileName === name),
          ),
        ),
        required: schema.required?.filter(
          (name: string) => !fileFields.some(([fileName]) => fileName === name),
        ),
      }
    : schema;
  const [value, setValue] = useState<JsonRecord>(
    () => initial || initialValue(schema, spec),
  );
  const [parameters, setParameters] = useState<Record<string, string>>(preset);
  const [result, setResult] = useState<any>();
  const [error, setError] = useState("");
  const [permissionMode, setPermissionMode] = useState(
    initial?.scope?.permissions?.length ? "custom" : "inherit",
  );
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(() =>
    Object.values(operation.responses || {}).some(
      (r: any) => r.content?.["text/event-stream"],
    ),
  );
  const canStream =
    Object.values(operation.responses || {}).some(
      (r: any) => r.content?.["text/event-stream"],
    ) ||
    /\/(stream|sse)(\/|$)/.test(operation.path) ||
    value.stream === true ||
    /streaming|\bSSE\b/i.test(operation.description || "");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [approved, setApproved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const destructive =
    operation.method === "DELETE" ||
    /\/(delete|reset|cleanup|revoke|disconnect|deactivate)(\/|$)/.test(
      operation.path,
    );
  const authorizationFlow =
    operation.method === "GET" &&
    /^\/(oauth|vault)\/authorize\//.test(operation.path);
  async function navigateAuthorization() {
    setError("");
    try {
      let path = operation.path;
      const query = new URLSearchParams();
      for (const parameter of operation.parameters || []) {
        const value = parameters[parameter.name];
        if (parameter.in === "path") {
          if (!value) throw new Error(`Required: ${parameter.name}`);
          path = path.replace(`{${parameter.name}}`, encodeURIComponent(value));
        } else if (parameter.in === "query" && value)
          query.set(parameter.name, value);
      }
      const result = await request("/_panel/navigation", {
        method: "POST",
        body: JSON.stringify({ path: path + (query.size ? "?" + query : "") }),
      });
      window.location.assign(result.url);
    } catch (err) {
      setError(displayError(err));
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    return () => controller.current?.abort();
  }, []);
  async function execute(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setResult(undefined);
    controller.current = new AbortController();
    try {
      let path = operation.path;
      const query = new URLSearchParams();
      const extraHeaders = new Headers();
      for (const p of operation.parameters || []) {
        const val = parameters[p.name];
        if (p.in === "path")
          path = path.replace(`{${p.name}}`, encodeURIComponent(val || ""));
        else if (p.in === "query" && val !== undefined && val !== "")
          query.set(p.name, val);
        else if (p.in === "header" && val) extraHeaders.set(p.name, val);
      }
      if (query.size) path += "?" + query;
      let body: BodyInit | undefined;
      if (contentType === "multipart/form-data") {
        const form = new FormData();
        for (const [key, val] of Object.entries(value))
          if (val !== undefined)
            form.append(
              key,
              typeof val === "object" ? JSON.stringify(val) : String(val),
            );
        for (const [key, file] of Object.entries(files)) form.set(key, file);
        body = form;
      } else if (contentType === "application/x-www-form-urlencoded") {
        body = new URLSearchParams(
          Object.fromEntries(
            Object.entries(value).map(([key, val]) => [
              key,
              typeof val === "object" ? JSON.stringify(val) : String(val),
            ]),
          ),
        );
        extraHeaders.set("Content-Type", contentType);
      } else if (contentType) {
        body = JSON.stringify(value);
        extraHeaders.set("Content-Type", contentType);
      }
      if (streaming || value.stream === true) {
        extraHeaders.set("X-Panel-Request", "1");
        const response = await fetch(config.prefix + path, {
          method: operation.method,
          headers: extraHeaders,
          body,
          signal: controller.current.signal,
          credentials: "same-origin",
          redirect: "error",
        });
        if (!response.ok)
          throw new Error(`${response.status}: ${await response.text()}`);
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          text = (text + decoder.decode(chunk, { stream: true })).slice(
            -200000,
          );
          setResult(text);
        }
      } else
        setResult(
          await request(path, {
            method: operation.method,
            headers: extraHeaders,
            body,
            signal: controller.current.signal,
          }),
        );
      onSuccess();
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(displayError(err));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      result?.download instanceof Blob
        ? result.download
        : new Blob(
            [
              typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2),
            ],
            { type: "application/json" },
          ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result?.filename || "contextforge-result.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <dialog
      ref={dialog}
      className="action-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !busy) onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          <span className={`method ${operation.method.toLowerCase()}`}>
            {operation.method}
          </span>
          <h2>{operation.summary || (en ? "API action" : "接口操作")}</h2>
          <code>{operation.path}</code>
        </div>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <TokenPermissionContext.Provider
        value={{ mode: permissionMode, setMode: setPermissionMode }}
      >
        <form
          onSubmit={(e) => {
            if (
              permissionMode === "custom" &&
              !value.scope?.permissions?.length
            ) {
              e.preventDefault();
              setError(
                "自定义权限至少需要选择一项；如需继承，请明确选择“继承账户权限”。",
              );
            } else void execute(e);
          }}
        >
          <div className="dialog-body">
            {(operation.parameters || []).length > 0 && (
              <div className="schema-form">
                {operation.parameters
                  .filter((p: any) => p.in !== "cookie")
                  .map((p: any) => (
                    <label className="field" key={`${p.in}-${p.name}`}>
                      <span>
                        {p.name}
                        {p.required && <b className="required"> *</b>}{" "}
                        <small>{p.in}</small>
                      </span>
                      <input
                        aria-label={p.name}
                        required={p.required}
                        value={parameters[p.name] || ""}
                        onChange={(e) =>
                          setParameters((v) => ({
                            ...v,
                            [p.name]: e.target.value,
                          }))
                        }
                      />
                      <small className="field-help">{p.description}</small>
                    </label>
                  ))}
              </div>
            )}
            {contentType && (
              <SchemaForm
                schema={formSchema}
                spec={spec}
                value={value}
                onChange={setValue}
              />
            )}
            {contentType === "multipart/form-data" &&
              Object.entries(schema.properties || {})
                .filter(
                  ([, s]: any) => resolveSchema(s, spec).format === "binary",
                )
                .map(([name]) => (
                  <label key={name} className="field">
                    {name}
                    <input
                      aria-label={name + " file"}
                      type="file"
                      required={schema.required?.includes(name)}
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          setFiles((v) => ({
                            ...v,
                            [name]: e.target.files![0],
                          }));
                      }}
                    />
                  </label>
                ))}
            {!contentType && !(operation.parameters || []).length && (
              <p className="muted">
                {en ? "No parameters required." : "此操作不需要参数。"}
              </p>
            )}
            {canStream && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={streaming}
                  onChange={(e) => setStreaming(e.target.checked)}
                />
                {en
                  ? "Show incoming updates as they arrive"
                  : "持续显示新到达的结果"}
                <small className="field-help">
                  适用于持续返回更新的接口。开始后可点击停止；普通查询不需要开启。
                </small>
              </label>
            )}
            {destructive && (
              <label className="check-label warning">
                <input
                  required
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                {en
                  ? "I understand this action changes or deletes data."
                  : "我确认执行此操作，理解它将修改或删除数据。"}
              </label>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {result !== undefined && (
              <section className="result">
                <div className="section-heading">
                  <strong>{en ? "Response" : "执行结果"}</strong>
                  <div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Copy response"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(
                            typeof result === "string"
                              ? result
                              : JSON.stringify(result, null, 2),
                          )
                          .catch(() => setError("Clipboard unavailable"))
                      }
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Download response"
                      onClick={download}
                    >
                      <Download size={16} />
                    </button>
                  </div>
                </div>
                {result?.access_token && (
                  <div className="alert warning">
                    {en
                      ? "Copy this key now. It is only displayed on creation."
                      : "请立即复制并妥善保存 API Key，明文仅在创建时返回。"}
                  </div>
                )}
                <pre tabIndex={0}>
                  {result?.download instanceof Blob
                    ? `${result.filename} · ${result.download.size} bytes`
                    : typeof result === "string"
                      ? result
                      : JSON.stringify(result, null, 2)}
                </pre>
              </section>
            )}
          </div>
          <footer className="dialog-footer">
            {authorizationFlow && (
              <button
                type="button"
                className="button primary"
                onClick={navigateAuthorization}
              >
                {en ? "Authorize in browser" : "在浏览器中授权"}
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              {en ? "Close" : "关闭"}
            </button>
            {busy ? (
              <button
                type="button"
                className="button danger"
                onClick={() => controller.current?.abort()}
              >
                <Square size={15} />
                {en ? "Stop" : "停止"}
              </button>
            ) : (
              <button
                className={`button ${destructive ? "danger" : "primary"}`}
                disabled={destructive && !approved}
              >
                <Play size={15} />
                {en ? "Execute" : "执行"}
              </button>
            )}
          </footer>
        </form>
      </TokenPermissionContext.Provider>
    </dialog>
  );
}

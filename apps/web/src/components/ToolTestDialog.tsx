import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import {
  request,
  displayError,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext } from "../session";
import { WorkflowDialog } from "./WorkflowDialog";
import { JsonInput, ToolInputForm } from "./ToolInputForm";
import {
  inputDefaults,
  inputValidator,
  toolSchema,
  toolCall,
  toolCallId,
  toolCallError,
} from "../tool-test.mjs";

export function ToolTestDialog({
  item,
  path,
  detailPath,
  onClose,
  en = false,
}: {
  item: JsonRecord;
  path: string;
  detailPath: string;
  onClose: () => void;
  en?: boolean;
}) {
  const session = useContext(SessionContext);
  const t = (zh: string, english: string) => (en ? english : zh);
  const [tool, setTool] = useState<JsonRecord>();
  const [schema, setSchema] = useState<JsonRecord>();
  const [value, setValue] = useState<JsonRecord>({});
  const [json, setJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<JsonRecord>();
  const [elapsed, setElapsed] = useState<number>();
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const id = useId();
  const validation = useMemo(
    () => (schema ? inputValidator(schema) : undefined),
    [schema],
  );
  const allowed = permitted(session.permissions, "tools.execute");
  useEffect(() => {
    if (error || result !== undefined)
      outcome.current?.scrollIntoView({ block: "nearest" });
  }, [error, result]);
  useEffect(() => {
    const load = new AbortController();
    request(detailPath, { signal: load.signal })
      .then((record) => {
        const input = toolSchema(record);
        setTool(record);
        setSchema(input);
        setValue(inputDefaults(input) ?? {});
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(displayError(err));
      })
      .finally(() => {
        if (!load.signal.aborted) setLoading(false);
      });
    return () => {
      load.abort();
      controller.current?.abort();
    };
  }, [detailPath]);
  async function execute(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !tool || !schema || !allowed) return;
    setError("");
    setResult(undefined);
    setElapsed(undefined);
    const control = new AbortController();
    controller.current = control;
    try {
      const body = toolCall(tool, value, toolCallId());
      const errors = validation?.errors(value) || [];
      if (errors.length) throw new Error(errors.join("\n"));
      setBusy(true);
      const start = performance.now();
      try {
        const response = await request(path, {
          method: "POST",
          body: JSON.stringify(body),
          signal: control.signal,
        });
        if (controller.current !== control || control.signal.aborted) return;
        setResult(response);
        setError(toolCallError(response));
      } finally {
        if (controller.current === control)
          setElapsed(Math.round(performance.now() - start));
      }
    } catch (err) {
      if (controller.current !== control) return;
      setError(
        (err as Error).name === "AbortError"
          ? t(
              "已停止等待结果；工具可能已在上游执行，请核实后再重试。",
              "Stopped waiting; the tool may already have run upstream. Check before retrying.",
            )
          : displayError(err),
      );
    } finally {
      if (controller.current === control) setBusy(false);
    }
  }
  return (
    <WorkflowDialog
      title={`${t("测试调用", "Test tool")} · ${item.displayName || item.name}`}
      busy={busy}
      en={en}
      onClose={onClose}
      footer={
        busy ? (
          <button
            key="stop"
            type="button"
            className="button danger"
            onClick={(event) => {
              event.preventDefault();
              controller.current?.abort();
              controller.current = null;
              setBusy(false);
              setError(
                t(
                  "已停止等待结果；工具可能已在上游执行，请核实后再重试。",
                  "Stopped waiting; the tool may already have run upstream. Check before retrying.",
                ),
              );
            }}
          >
            <Square size={15} />
            {t("停止等待", "Stop waiting")}
          </button>
        ) : (
          <button
            key="call"
            type="submit"
            form={id}
            className="button primary"
            disabled={
              loading ||
              !tool ||
              !schema ||
              !allowed ||
              tool.enabled === false ||
              tool.is_active === false
            }
          >
            <Play size={15} />
            {t("调用工具", "Call tool")}
          </button>
        )
      }
    >
      {loading && (
        <p role="status">{t("正在读取工具 Schema…", "Loading tool schema…")}</p>
      )}
      {schema && (
        <form id={id} ref={form} onSubmit={(event) => void execute(event)}>
          <p className="muted">
            {t(
              "这会真实执行一次工具调用，可能产生数据变更。参数完整规则由后端校验。",
              "This executes the tool and may change data. The backend enforces the full parameter rules.",
            )}
          </p>
          <p>
            <code>{tool?.name}</code> · <code>POST {path}</code>
          </p>
          {tool?.description && <p>{tool.description}</p>}
          {(tool?.enabled === false || tool?.is_active === false) && (
            <p className="alert warning">
              {t(
                "工具已停用，请启用后再调用。",
                "Enable this tool before calling it.",
              )}
            </p>
          )}
          {!allowed && (
            <p role="alert">
              {t(
                "缺少 tools.execute 权限",
                "tools.execute permission required",
              )}
            </p>
          )}
          {validation?.warning && (
            <p className="alert warning">{validation.warning}</p>
          )}
          <fieldset className="tool-input-fields" disabled={busy}>
            <div className="toolbar">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  const invalidJson = Array.from(
                    form.current?.querySelectorAll("textarea") || [],
                  ).find((input) => input.validity.customError);
                  if (invalidJson) {
                    invalidJson.reportValidity();
                    return;
                  }
                  if (json) {
                    try {
                      toolCall(tool!, value, "preview");
                    } catch (err) {
                      setError(displayError(err));
                      return;
                    }
                  }
                  setJson(!json);
                }}
              >
                {json
                  ? t("使用参数表单", "Use parameter form")
                  : t("编辑 JSON", "Edit JSON")}
              </button>
            </div>
            {json ? (
              <JsonInput value={value} onChange={setValue} />
            ) : (
              <ToolInputForm
                schema={schema}
                root={schema}
                value={value}
                onChange={setValue}
                en={en}
              />
            )}
          </fieldset>
          <details>
            <summary>{t("查看输入 Schema", "View input schema")}</summary>
            <pre tabIndex={0}>{JSON.stringify(schema, null, 2)}</pre>
          </details>
        </form>
      )}
      <div ref={outcome}>
        {error && (
          <div role="alert" className="alert error tool-call-error">
            {error}
          </div>
        )}
        {result !== undefined && (
          <section className="result">
            <strong>
              {toolCallError(result)
                ? t("调用失败", "Call failed")
                : t("执行结果", "Result")}
            </strong>
            <pre tabIndex={0}>{JSON.stringify(result, null, 2)}</pre>
          </section>
        )}
        {elapsed !== undefined && (
          <p className="muted">
            {t("请求耗时", "Request duration")}: {elapsed} ms
          </p>
        )}
      </div>
    </WorkflowDialog>
  );
}

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
import { SessionContext, useText } from "../session";
import {
  TokenPermissionContext,
  TokenPermissionSummary,
} from "./TokenPermissions";
import type { Operation } from "./ActionDialog";
import { resourceActionName } from "../resource-actions.mjs";
import {
  canonicalField,
  englishFieldLabel,
  englishProfiles,
} from "../resource-copy.mjs";
import { associationEndpoints } from "../association-model.mjs";
import { restToolProblems } from "../tool-workflows.mjs";
import { inputCompatibilityError } from "../tool-test.mjs";
import { toolEditContext, toolWriteBody } from "../tool-auth.mjs";
import { GatewayRegistrationResult } from "./GatewayRegistrationResult";
import { TokenScope, TokenStatus } from "./TokenPresentation";
import { mergeTokenRevocation } from "../token-display.mjs";
export { resourceActionName } from "../resource-actions.mjs";

export function RecordDetails({ value }: { value: unknown }) {
  const { en } = useContext(SessionContext);
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
      <span className="muted">{en ? "None" : "无"}</span>
    );
  if (typeof value === "object")
    return (
      <dl className="record-details">
        {Object.entries(value as JsonRecord).map(([k, v]) => (
          <div key={k}>
            <dt>
              {en
                ? englishFieldLabel(k, k)
                : (fieldCopy as Record<string, string[]>)[k]?.[0] || k}
            </dt>
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
          ? en
            ? "Yes"
            : "是"
          : en
            ? "No"
            : "否"
        : String(safeDisplay(value))}
    </span>
  );
}
function TokenDetails({
  value,
  item,
  spec,
  teams,
}: {
  value: JsonRecord;
  item?: JsonRecord;
  spec: JsonRecord;
  teams: JsonRecord[];
}) {
  const t = useText();
  const token = mergeTokenRevocation(item, value);
  const fields = { ...token };
  for (const key of [
    "name",
    "team_id",
    "server_id",
    "is_active",
    "is_revoked",
    "revoked_at",
    "revoked_by",
    "revocation_reason",
  ])
    delete fields[key];
  if (token.is_revoked) {
    fields[t("撤销时间", "Revoked at")] = token.revoked_at;
    fields[t("撤销人", "Revoked by")] = token.revoked_by;
    fields[t("撤销原因", "Revocation reason")] = token.revocation_reason;
  }
  return (
    <div className="token-details">
      <div className="section-heading">
        <h3>{token.name}</h3>
        <TokenStatus token={token} />
      </div>
      <TokenScope token={token} spec={spec} teams={teams} />
      <RecordDetails value={fields} />
    </div>
  );
}
function ToolDetails({ value }: { value: JsonRecord }) {
  const t = useText();
  const labels: Record<string, string> = {
    集成方式: "Integration",
    请求方法: "Request method",
    调用地址: "Endpoint",
    结果过滤: "Result filter",
    行为说明: "Annotations",
    输入结构: "Input schema",
    输出结构: "Output schema",
    可见范围: "Visibility",
    所属团队: "Team",
    所有者: "Owner",
    认证配置: "Authentication",
    "工具 ID": "Tool ID",
    原始名称: "Original name",
    创建时间: "Created at",
    创建人: "Created by",
    更新时间: "Updated at",
    修改人: "Modified by",
    调用次数: "Execution count",
    调用配置: "Invocation",
    输入输出: "Input & output",
    访问控制: "Access control",
    审计信息: "Audit information",
  };
  const pick = (fields: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(fields)
        .map(([key, label]) => [
          t(label, labels[label] || label),
          safeDisplay(readField(value, key), key),
        ])
        .filter(
          ([, v]) =>
            v !== null &&
            v !== undefined &&
            v !== "" &&
            (!Array.isArray(v) || v.length),
        ),
    );
  const enabled = value.enabled ?? value.is_active;
  const groups = [
    [
      "调用配置",
      {
        integrationType: "集成方式",
        requestType: "请求方法",
        url: "调用地址",
        jsonpathFilter: "结果过滤",
        annotations: "行为说明",
      },
    ],
    ["输入输出", { inputSchema: "输入结构", outputSchema: "输出结构" }],
    [
      "访问控制",
      {
        visibility: "可见范围",
        teamId: "所属团队",
        ownerEmail: "所有者",
        auth: "认证配置",
      },
    ],
    [
      "审计信息",
      {
        id: "工具 ID",
        originalName: "原始名称",
        createdAt: "创建时间",
        createdBy: "创建人",
        updatedAt: "更新时间",
        modifiedBy: "修改人",
        executionCount: "调用次数",
      },
    ],
  ] as const;
  return (
    <div className="tool-details">
      <section className="tool-overview">
        <h3>
          {value.displayName ||
            value.name ||
            value.originalName ||
            t("未命名工具", "Unnamed tool")}
        </h3>
        <p>
          {value.description ||
            value.originalDescription ||
            t("尚未填写用途说明", "No purpose provided")}
        </p>
        <RecordDetails
          value={{
            [t("状态", "State")]:
              enabled === undefined
                ? t("未知", "Unknown")
                : enabled
                  ? t("已启用", "Enabled")
                  : t("已停用", "Disabled"),
            [t("可达性", "Reachability")]:
              value.reachable === undefined
                ? t("未知", "Unknown")
                : value.reachable
                  ? t("可达", "Reachable")
                  : t("不可达", "Unreachable"),
            [t("来源", "Source")]:
              value.gatewaySlug ||
              readField(value, "gatewayId") ||
              readField(value, "grpcServiceId") ||
              t("手工注册", "Manually registered"),
            [t("所属团队", "Team")]:
              readField(value, "teamId") ||
              t("未指定团队", "No team specified"),
            [t("所有者", "Owner")]:
              readField(value, "ownerEmail") ||
              readField(value, "createdBy") ||
              t("未提供", "Not provided"),
          }}
        />
      </section>
      {groups.map(([name, fields]) => (
        <details
          className="advanced-fields"
          key={name}
          open={name === "调用配置"}
        >
          <summary>{t(name, labels[name])}</summary>
          {Object.keys(pick(fields)).length ? (
            <RecordDetails value={pick(fields)} />
          ) : (
            <p className="muted">
              {t(
                "未配置或后端未提供",
                "Not configured or not provided by backend",
              )}
            </p>
          )}
        </details>
      ))}
    </div>
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
  detailActions = [],
  teams = [],
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
  detailActions?: { label: string; onSelect: () => void }[];
  teams?: JsonRecord[];
}) {
  const session = useContext(SessionContext);
  const t = (zh: string, english: string) => (en ? english : zh);
  const profile = (resourceProfiles as Record<string, any>)[moduleId];
  const englishProfile = (englishProfiles as Record<string, string[]>)[
    moduleId
  ];
  const restCreate = moduleId === "tools" && mode === "create";
  const noun = restCreate
    ? t("REST 工具", "REST tool")
    : en
      ? englishProfile?.[0] || "resource"
      : profile?.noun || "资源";
  const purpose = restCreate
    ? t(
        "注册独立 REST HTTP 端点。MCP 服务请通过 MCP 网关接入并自动发现工具。",
        "Register an individual REST HTTP endpoint. Connect MCP services through MCP gateways to discover tools automatically.",
      )
    : en
      ? englishProfile?.[1]
      : profile?.purpose;
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
      ...(restCreate ? { integration_type: "REST", request_type: "POST" } : {}),
      ...(mode === "create" && team && schema.properties?.team_id
        ? { team_id: team }
        : {}),
      ...(mode === "create" && team && schema.properties?.teamId
        ? { teamId: team }
        : {}),
    };
  });
  const inputError =
    moduleId === "tools" && (mode === "create" || mode === "edit")
      ? inputCompatibilityError(readField(value, "inputSchema"), en)
      : "";
  const fieldErrors = { inputSchema: inputError, input_schema: inputError };
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
  const [toolContext, setToolContext] = useState<JsonRecord>();
  const toolTeamReadOnly =
    moduleId === "tools" &&
    mode === "edit" &&
    !schema.properties?.team_id &&
    !schema.properties?.teamId;
  const [permissionMode, setPermissionMode] = useState(
    initial?.scope?.permissions?.length ? "custom" : "inherit",
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const loadedAssociations = useRef<JsonRecord>({});
  useEffect(() => {
    if (errors.length || result !== undefined)
      dialog.current?.querySelector(".dialog-body")?.scrollTo({ top: 0 });
  }, [errors, result]);
  const destructive =
    operation.method === "DELETE" ||
    /\/(reset|revoke|cleanup|deactivate|leave)(\/|$)/.test(operation.path);
  const title =
    mode === "create"
      ? t(`新建${noun}`, `Create ${noun}`)
      : mode === "edit"
        ? t(`编辑${noun}`, `Edit ${noun}`)
        : resourceActionName(operation, noun, en);
  function pathFor(values: JsonRecord) {
    let path = operation.path;
    for (const p of operation.parameters || [])
      if (p.in === "path") {
        const id = preset[p.name] || values[p.name];
        if (!id) throw new Error(t(`请选择 ${p.name}`, `Select ${p.name}`));
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
            if (moduleId === "tools") setToolContext(toolEditContext(source));
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
            loadedAssociations.current = Object.fromEntries(
              Object.entries(normalized).filter(
                ([key]) => canonicalField(key) in associationEndpoints,
              ),
            );
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
  const requestedKeys =
    mode === "create" || mode === "edit"
      ? [...new Set([...(profile?.fields || []), ...(schema.required || [])])]
      : Object.keys(schema.properties || {});
  const primaryKeys = Object.keys(schema.properties || {}).filter((key) =>
    requestedKeys.some(
      (candidate: string) => canonicalField(candidate) === canonicalField(key),
    ),
  );
  const sliceSchema = (keys: string[]) => ({
    ...schema,
    properties: Object.fromEntries(
      keys
        .filter(
          (k) =>
            schema.properties?.[k] &&
            !(restCreate && ["gateway_id", "allow_auto"].includes(k)),
        )
        .map((k) => [
          k,
          restCreate && k === "integration_type"
            ? { ...schema.properties[k], enum: ["REST"] }
            : restCreate && k === "request_type"
              ? {
                  ...schema.properties[k],
                  enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
                }
              : toolTeamReadOnly && k === "visibility" && !toolContext?.teamId
                ? {
                    ...schema.properties[k],
                    "x-panel-disabled-values": ["team"],
                  }
                : schema.properties[k],
        ]),
    ),
    required: schema.required?.filter((k: string) => keys.includes(k)),
  });
  const advancedKeys = Object.keys(schema.properties || {}).filter(
    (k) =>
      !primaryKeys.includes(k) &&
      !(moduleId === "tools" && ["auth_headers", "authHeaders"].includes(k)),
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const submittedValue = { ...value };
    if (mode === "edit")
      for (const [key, original] of Object.entries(loadedAssociations.current))
        if (JSON.stringify(value[key]) === JSON.stringify(original))
          delete submittedValue[key];
    const selectedTeam =
      schema.properties?.team_id || schema.properties?.teamId
        ? readField(submittedValue, "team_id")
        : team;
    const body = wrapper
      ? {
          [wrapper]: submittedValue,
          ...(root.properties?.team_id && selectedTeam
            ? { team_id: selectedTeam }
            : {}),
        }
      : submittedValue;
    const problems = [
      ...validateValue(params, parameterSchema, spec, "", en),
      ...(contentType
        ? validateValue(body, root, spec, "", en, {
            teamId: toolTeamReadOnly ? toolContext?.teamId : undefined,
            teamReadOnly: toolTeamReadOnly,
          })
        : []),
      ...(restCreate ? restToolProblems(submittedValue, en) : []),
      ...(!restCreate && inputError ? [inputError] : []),
    ];
    if (
      moduleId === "tokens" &&
      permissionMode === "custom" &&
      !value.scope?.permissions?.length
    )
      problems.push(
        t(
          "自定义权限至少需要选择一项；如需继承，请明确选择“继承账户权限”。",
          "Select at least one custom permission, or explicitly choose to inherit account permissions.",
        ),
      );
    if (moduleId === "catalog" && item?.requires_api_key && !value.api_key)
      problems.push(
        t(
          "此目录服务需要 API Key，请填写该服务的访问凭据",
          "This catalog service requires an API Key. Enter its access credential.",
        ),
      );
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setBusy(true);
    try {
      let payload: BodyInit | undefined = contentType
        ? JSON.stringify(
            moduleId === "tools" && ["create", "edit"].includes(mode)
              ? toolWriteBody(body, en)
              : body,
          )
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
      setResult(data ?? { message: t("操作已完成", "Operation completed") });
      onSuccess();
    } catch (err) {
      setErrors([
        displayError(err),
        t(
          "请检查下方已填配置。若后端未返回详细原因，请结合日志与审计定位；此前填写的内容已保留。",
          "Review the configuration below. Check logs and audit records if the backend provided no details. Your input has been retained.",
        ),
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
          <p>{item?.name || item?.email || item?.uri || purpose}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t("关闭弹窗", "Close dialog")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <TokenPermissionContext.Provider
        value={{ mode: permissionMode, setMode: setPermissionMode }}
      >
        <form onSubmit={submit}>
          <div className="dialog-body">
            {errors.length > 0 && (
              <div className="alert error" role="alert">
                <strong>
                  {t("请检查以下问题", "Review the following problems")}
                </strong>
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
                  ? t(
                      "未能读取完整配置，请关闭后重试。",
                      "Could not load the complete configuration. Close and retry.",
                    )
                  : t("正在读取完整配置…", "Loading complete configuration…")}
              </p>
            )}
            {!loading && result === undefined && (
              <>
                {(mode === "create" || mode === "edit") && (
                  <p className="field-help">{purpose}</p>
                )}
                {mode === "edit" && (
                  <p className="field-help">
                    {t(
                      "未填写的凭据保持原值。选择认证方式并填写新凭据才会更换认证；选择 none 会移除认证。请求头与 OAuth 配置不回填；需要更换时请填写完整的新配置。",
                      "Blank credentials keep their current values. Choose an authentication method and enter new credentials to replace them; none removes authentication. Headers and OAuth configuration are not prefilled. Enter the complete configuration to replace them.",
                    )}
                  </p>
                )}
                {toolTeamReadOnly && (
                  <label className="field full">
                    <span>
                      {t(
                        "所属团队（创建时确定）",
                        "Team (assigned on creation)",
                      )}
                    </span>
                    <input
                      aria-label="Tool team"
                      readOnly
                      value={
                        toolContext?.teamName ||
                        toolContext?.teamId ||
                        t("未分配团队", "No team assigned")
                      }
                    />
                    <small className="field-help">
                      {toolContext?.teamId
                        ? t(
                            "此接口保留现有团队归属，不支持更换团队。",
                            "This endpoint preserves the existing team assignment and cannot change it.",
                          )
                        : t(
                            "未分配团队的工具不能改为团队可见。请在创建工具时选择团队。",
                            "A tool without a team cannot become team-visible. Assign a team when creating it.",
                          )}
                    </small>
                  </label>
                )}
                {moduleId === "tools" && mode === "edit" && (
                  <p className="field-help">
                    {t("当前认证方式", "Current authentication")}:{" "}
                    <strong>{toolContext?.authType || "none"}</strong> ·{" "}
                    {t(
                      "凭据不回填；不修改认证选项会保留现有凭据。",
                      "Credentials are not prefilled. Leave authentication unchanged to preserve them.",
                    )}
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
                    fieldErrors={fieldErrors}
                    all
                  />
                )}
                {!!advancedKeys.length && (
                  <details className="advanced-fields">
                    <summary>
                      {t("更多配置（可选）", "More configuration (optional)")} ·{" "}
                      {advancedKeys.length}
                    </summary>
                    <SchemaForm
                      schema={sliceSchema(advancedKeys)}
                      spec={spec}
                      value={value}
                      onChange={setValue}
                      fieldErrors={fieldErrors}
                      all
                    />
                  </details>
                )}
                {destructive && (
                  <div className="alert warning">
                    <p>
                      {moduleId === "tokens"
                        ? t(
                            "撤销后，使用此 Key 的应用将无法继续访问。请确认已切换应用凭据。",
                            "Revoking this key prevents applications using it from accessing the service. Switch their credentials first.",
                          )
                        : t(
                            `将对「${item?.name || item?.email || noun}」执行「${title}」${params.user_email ? `（成员：${params.user_email}）` : params.request_id ? `（申请：${params.request_id}）` : ""}。请核对操作对象；执行后可能影响相关访问权限。`,
                            `Execute “${title}” for “${item?.name || item?.email || noun}”${params.user_email ? ` (member: ${params.user_email})` : params.request_id ? ` (request: ${params.request_id})` : ""}. Check the target; this may affect related access permissions.`,
                          )}
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        required
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      {t(
                        "我已确认操作对象和影响",
                        "I confirm the target and impact",
                      )}
                    </label>
                  </div>
                )}
              </>
            )}
            {result !== undefined && (
              <section className="resource-result result">
                {mode !== "detail" &&
                  !(moduleId === "gateways" && mode === "create") && (
                    <div className="alert success">
                      <Check size={18} />{" "}
                      {en ? "Saved successfully" : "操作成功"}
                    </div>
                  )}
                {moduleId === "gateways" && mode === "create" ? (
                  <GatewayRegistrationResult gateway={result} spec={spec} />
                ) : result?.access_token ? (
                  <div className="key-delivery">
                    <h3>{t("保存 API Key", "Save API Key")}</h3>
                    <p>
                      {t(
                        "明文仅在此时显示。关闭页面后无法找回，请保存到安全的凭据管理器中。",
                        "The secret is shown only now and cannot be recovered after closing. Save it in a secure credential manager.",
                      )}
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
                            setErrors([
                              t(
                                "无法访问剪贴板，请手动复制。",
                                "Clipboard unavailable. Copy manually.",
                              ),
                            ]),
                          )
                      }
                    >
                      <Copy size={16} />
                      {copied
                        ? t("已复制", "Copied")
                        : t("复制 API Key", "Copy API Key")}
                    </button>
                    {moduleId === "tokens" && result.token && (
                      <TokenScope
                        token={result.token}
                        spec={spec}
                        teams={teams}
                      />
                    )}
                    <RecordDetails
                      value={{
                        name: result.token?.name || value.name,
                        expires_at: result.token?.expires_at,
                        [t("授权方式", "Authorization")]: result.token
                          ?.resource_scopes?.length
                          ? t(
                              "自定义权限，与账户 RBAC 权限取交集",
                              "Custom permissions intersected with account RBAC permissions",
                            )
                          : t(
                              "运行时继承账户 RBAC 权限",
                              "Inherit account RBAC permissions at runtime",
                            ),
                        [t("权限范围", "Permission scope")]:
                          result.token?.resource_scopes,
                      }}
                    />
                    {!!result.warnings?.length && (
                      <div className="alert warning" role="alert">
                        <strong>
                          {t("后端授权提示", "Backend authorization notices")}
                        </strong>
                        <ul>
                          {result.warnings.map((warning: string, i: number) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : mode === "detail" &&
                  moduleId === "tokens" &&
                  result &&
                  typeof result === "object" ? (
                  <TokenDetails
                    value={result}
                    item={item}
                    spec={spec}
                    teams={teams}
                  />
                ) : mode === "detail" &&
                  moduleId === "tools" &&
                  result &&
                  typeof result === "object" ? (
                  <ToolDetails value={result} />
                ) : (
                  <RecordDetails value={result} />
                )}
                {mode === "detail" && (
                  <details>
                    <summary>
                      {t(
                        "查看原始数据（敏感字段已隐藏）",
                        "View raw data (sensitive fields hidden)",
                      )}
                    </summary>
                    <pre>{JSON.stringify(safeDisplay(result), null, 2)}</pre>
                  </details>
                )}
              </section>
            )}
          </div>
          <div className="dialog-footer">
            {moduleId === "tokens" &&
              mode === "create" &&
              result === undefined && (
                <TokenPermissionSummary scope={value.scope} />
              )}
            {mode === "detail" &&
              !loading &&
              detailActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="button secondary"
                  onClick={action.onSelect}
                >
                  {action.label}
                </button>
              ))}
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
                  ? t("正在处理…", "Processing…")
                  : mode === "create"
                    ? moduleId === "tokens"
                      ? t("创建 API Key", "Create API Key")
                      : t(`创建${noun}`, `Create ${noun}`)
                    : mode === "edit"
                      ? t("保存修改", "Save changes")
                      : title}
              </button>
            )}
          </div>
        </form>
      </TokenPermissionContext.Provider>
    </dialog>
  );
}

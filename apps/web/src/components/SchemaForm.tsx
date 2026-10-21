import { useContext, useState } from "react";
import { SessionContext, useText } from "../session";
import {
  canonicalField,
  englishFieldLabel,
  associationHelp,
} from "../resource-copy.mjs";
import { TokenPermissionPicker } from "./TokenPermissions";
import {
  ReferenceInput,
  PermissionPicker,
  ResourcePicker,
} from "./ReferenceInput";
import { enrichField, fieldCopy } from "../resource-model.mjs";
import { resolveSchema } from "../../../../packages/api-client/contract.mjs";
import type { JsonRecord } from "../../../../packages/api-client";

export function SchemaForm({
  schema,
  spec,
  value,
  onChange,
  all = false,
  fieldErrors = {},
}: {
  schema: JsonRecord;
  spec: JsonRecord;
  value: JsonRecord;
  onChange: (v: JsonRecord) => void;
  all?: boolean;
  fieldErrors?: Record<string, string>;
}) {
  const s = resolveSchema(schema, spec);
  const session = useContext(SessionContext);
  const t = useText();
  const [advanced, setAdvanced] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = Object.entries(s.properties || {}).filter(
    ([, v]: any) =>
      !v.readOnly &&
      (session.user?.is_admin || !/admin only/i.test(v.description || "")),
  ) as [string, JsonRecord][];
  const common = [
    "name",
    "description",
    "email",
    "password",
    "url",
    "visibility",
    "team_id",
    "server_id",
    "expires_in_days",
    "scope",
    "permissions",
    "model_id",
    "provider_type",
    "base_url",
    "api_key",
    "role_id",
    "user_email",
    "is_active",
    "enabled",
  ];
  const visible =
    advanced || all
      ? fields
      : fields.filter(
          ([key]) => s.required?.includes(key) || common.includes(key),
        );
  function update(key: string, next: unknown) {
    if (s.title === "AuthenticationValues" && key === "authType") {
      setDrafts({});
      setErrors({});
      onChange(next === undefined ? {} : { authType: next });
      return;
    }
    const copy = { ...value };
    if (key === "scope" && typeof next === "string" && s.properties?.role_id) {
      delete copy.role_id;
      if (next !== "team") delete copy.scope_id;
    }
    if (next === undefined) delete copy[key];
    else copy[key] = next;
    onChange(copy);
  }
  if (!fields.length)
    return (
      <label className="field full">
        JSON
        <textarea
          aria-label="JSON body"
          rows={10}
          value={drafts.root ?? JSON.stringify(value, null, 2)}
          onChange={(e) => {
            setDrafts({ root: e.target.value });
            try {
              const next = JSON.parse(e.target.value);
              onChange(next);
              setErrors({});
            } catch {
              setErrors({ root: "json" });
            }
          }}
          required
        />
        {errors.root && (
          <span className="error-text">
            {t("JSON 格式错误", "Invalid JSON")}
          </span>
        )}
        <input
          className="validation-proxy"
          value={errors.root || ""}
          onChange={() => {}}
          pattern="^$"
          tabIndex={-1}
          aria-label="JSON validation"
        />
      </label>
    );
  return (
    <div className="schema-form">
      {visible.map(([key, original]) => {
        const canonical = canonicalField(key);
        const field = enrichField(key, original, spec);
        const required =
          s.required?.includes(key) ||
          (s.title === "AuthenticationValues" &&
            ((value.authType === "basic" &&
              ["username", "password"].includes(key)) ||
              (value.authType === "bearer" && key === "token")));
        const complex =
          field.type === "object" || field.type === "array" || field.properties;
        const copy =
          (fieldCopy as Record<string, string[]>)[key] ||
          (fieldCopy as Record<string, string[]>)[canonical];
        const title =
          key === "scope" && field.type === "string"
            ? t("角色范围", "Role scope")
            : session.en
              ? englishFieldLabel(key, field.title)
              : copy?.[0] || field.title || key;
        const help = session.en
          ? field.description?.split("\n")[0]
          : copy?.[1] || field.description?.split("\n")[0];
        const current = value[key];
        const auth = value.authType || value.auth_type;
        if (s.title === "AuthenticationValues" && key === "authType")
          field.enum = ["none", "basic", "bearer", "authheaders"];
        if (
          s.title === "AuthenticationValues" &&
          ["username", "password", "token", "authValue"].includes(key)
        ) {
          if (
            key === "authValue" ||
            (key === "token" ? auth !== "bearer" : auth !== "basic")
          )
            return null;
        }
        const authFields: Record<string, string[]> = {
          basic: [
            "authUsername",
            "authPassword",
            "auth_username",
            "auth_password",
          ],
          bearer: ["authToken", "auth_token"],
          authheaders: [
            "authHeaderKey",
            "authHeaderValue",
            "authHeaders",
            "auth_headers",
            "auth_header_key",
            "auth_header_value",
          ],
          query_param: [
            "authQueryParamKey",
            "authQueryParamValue",
            "auth_query_param_key",
            "auth_query_param_value",
          ],
          oauth: ["oauthConfig", "oauth_config"],
        };
        const credentialField = Object.values(authFields).flat().includes(key);
        if (credentialField && !authFields[auth]?.includes(key)) return null;
        if (
          [
            "associated_tools",
            "associated_resources",
            "associated_prompts",
            "associated_a2a_agents",
            "plugin_ids",
          ].includes(canonical)
        )
          return (
            <div
              className="field full"
              key={key}
              role="group"
              aria-label={title}
            >
              <span>{title}</span>
              <ResourcePicker
                name={canonical}
                spec={spec}
                value={current || []}
                onChange={(v) => update(key, v)}
              />
              <small className="field-help">
                {
                  (associationHelp as Record<string, string[]>)[canonical]?.[
                    session.en ? 1 : 0
                  ]
                }
              </small>
            </div>
          );
        if (["arguments", "members"].includes(key) && field.type === "array")
          return (
            <div className="field full" key={key}>
              <span>{title}</span>
              <small className="field-help">{help}</small>
              {(current || []).map((row: JsonRecord, i: number) => (
                <div className="repeat-row" key={i}>
                  <SchemaForm
                    schema={field.items}
                    spec={spec}
                    value={row}
                    all
                    onChange={(next) =>
                      update(
                        key,
                        current.map((v: JsonRecord, n: number) =>
                          n === i ? next : v,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      update(
                        key,
                        current.filter((_: unknown, n: number) => n !== i),
                      )
                    }
                  >
                    {t("移除此项", "Remove item")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() => update(key, [...(current || []), {}])}
              >
                {key === "arguments"
                  ? t("添加参数", "Add argument")
                  : t("添加成员", "Add member")}
              </button>
            </div>
          );
        if (key === "permissions" && field.type === "array")
          return (
            <div className="field full" key={key}>
              <span>
                {title}
                {required && <b className="required"> *</b>}
              </span>
              {s.title === "TokenScopeRequest" ? (
                <TokenPermissionPicker
                  value={Array.isArray(current) ? current : []}
                  onChange={(next) => update(key, next)}
                />
              ) : (
                <PermissionPicker
                  value={Array.isArray(current) ? current : []}
                  restricted={s.title === "TokenScopeRequest"}
                  onChange={(next) => update(key, next)}
                />
              )}
            </div>
          );
        if (
          field.properties &&
          !field.additionalProperties &&
          [
            "tool",
            "resource",
            "prompt",
            "gateway",
            "server",
            "agent",
            "scope",
            "llm",
            "auth",
          ].includes(key)
        )
          return (
            <fieldset className="nested-fields full" key={key}>
              <legend>
                {title}
                {required ? " *" : ""}
              </legend>
              <SchemaForm
                schema={field}
                spec={spec}
                value={current || {}}
                all={key === "scope" ? false : all}
                onChange={(next) => update(key, next)}
              />
            </fieldset>
          );
        return (
          <label
            key={key}
            className={`field ${complex || key === "description" ? "full" : ""}`}
          >
            <span>
              {title}
              {required && <b className="required"> *</b>} <small>{key}</small>
            </span>
            {[
              "team_id",
              "teamId",
              "scope_id",
              "server_id",
              "role_id",
              "inherits_from",
            ].includes(key) ? (
              <ReferenceInput
                name={key}
                scope={key === "role_id" ? value.scope : undefined}
                value={current || ""}
                required={!!required}
                onChange={(next) => update(key, next)}
              />
            ) : field.enum ? (
              <select
                aria-label={key}
                value={current ?? ""}
                required={required}
                onChange={(e) => update(key, e.target.value || undefined)}
              >
                <option value="">—</option>
                {field.enum.map((option: any) => (
                  <option
                    key={option}
                    value={option}
                    disabled={field["x-panel-disabled-values"]?.includes(
                      option,
                    )}
                  >
                    {String(option)}
                    {key === "visibility"
                      ? (
                          {
                            private: t(" · 仅自己", " · Owner only"),
                            team: t(" · 所属团队", " · Team"),
                            public: t(
                              " · 所有获准用户",
                              " · All authorized users",
                            ),
                          } as Record<string, string>
                        )[option]
                      : ""}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <select
                aria-label={key}
                value={current === undefined ? "" : String(current)}
                required={required}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value === ""
                      ? undefined
                      : e.target.value === "true",
                  )
                }
              >
                <option value="">{t("默认", "Default")}</option>
                <option value="true">{t("是", "Yes")}</option>
                <option value="false">{t("否", "No")}</option>
              </select>
            ) : field.type === "array" &&
              (resolveSchema(field.items, spec).type === "string" ||
                [
                  "tags",
                  "ip_restrictions",
                  "passthroughHeaders",
                  "passthrough_headers",
                ].includes(key)) ? (
              <textarea
                aria-label={key}
                rows={3}
                placeholder={t("每行一项", "One item per line")}
                value={
                  drafts[key] ??
                  (current || [])
                    .map((v: any) =>
                      typeof v === "string" ? v : v.label || v.id,
                    )
                    .join("\n")
                }
                onChange={(e) => {
                  setDrafts((v) => ({ ...v, [key]: e.target.value }));
                  update(
                    key,
                    e.target.value
                      .split("\n")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  );
                }}
              />
            ) : complex ? (
              <textarea
                aria-label={key}
                aria-invalid={!!(errors[key] || fieldErrors[key])}
                rows={key === "scope" ? 6 : 3}
                placeholder={field.type === "array" ? "[ ]" : "{ }"}
                value={
                  drafts[key] ??
                  (current === undefined
                    ? ""
                    : JSON.stringify(current, null, 2))
                }
                required={required}
                onChange={(e) => {
                  const text = e.target.value;
                  setDrafts((v) => ({ ...v, [key]: text }));
                  try {
                    if (!text.trim()) update(key, undefined);
                    else update(key, JSON.parse(text));
                    setErrors((v) => ({ ...v, [key]: "" }));
                  } catch {
                    setErrors((v) => ({
                      ...v,
                      [key]: "json",
                    }));
                  }
                }}
              />
            ) : ["description", "content", "template"].includes(key) ? (
              <textarea
                aria-label={key}
                rows={key === "description" ? 2 : 8}
                value={current ?? ""}
                required={required}
                maxLength={field.maxLength}
                onChange={(e) => update(key, e.target.value || undefined)}
              />
            ) : (
              <input
                aria-label={key}
                type={
                  /password|secret|api_key|^token$|auth.?token|auth.?value|auth.?header.?value|auth.?query.?param.?value|client.?key/i.test(
                    key,
                  )
                    ? "password"
                    : ["integer", "number"].includes(field.type)
                      ? "number"
                      : field.format === "email"
                        ? "email"
                        : "text"
                }
                value={current ?? ""}
                required={required}
                min={field.minimum}
                max={field.maximum}
                step={field.type === "number" ? "any" : undefined}
                minLength={field.minLength}
                maxLength={field.maxLength}
                pattern={field.pattern}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value === ""
                      ? undefined
                      : ["integer", "number"].includes(field.type)
                        ? Number(e.target.value)
                        : e.target.value,
                  )
                }
              />
            )}
            {(errors[key] || fieldErrors[key]) && (
              <span className="error-text" role="alert">
                {errors[key]
                  ? t("JSON 格式错误", "Invalid JSON")
                  : fieldErrors[key]}
              </span>
            )}
            {complex && (
              <input
                className="validation-proxy"
                value={errors[key] || fieldErrors[key] || ""}
                onChange={() => {}}
                pattern="^$"
                tabIndex={-1}
                aria-label={`${key} validation`}
              />
            )}
            {(copy?.[1] || field.description) && (
              <small className="field-help">
                {key === "scope" && field.type === "string"
                  ? t(
                      "global：全局；team：团队；personal：个人。分配角色时须匹配此范围。",
                      "global, team or personal. The assigned role must match this scope.",
                    )
                  : help}
              </small>
            )}
          </label>
        );
      })}
      {visible.length < fields.length && (
        <button
          className="text-button full"
          type="button"
          onClick={() => setAdvanced(true)}
        >
          {t("更多限制与高级配置", "Advanced options")}
        </button>
      )}
    </div>
  );
}

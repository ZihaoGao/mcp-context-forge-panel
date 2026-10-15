import { useContext, useState } from "react";
import { SessionContext } from "../session";
import { ReferenceInput, PermissionPicker } from "./ReferenceInput";
import { resolveSchema } from "../../../../packages/api-client/contract.mjs";
import type { JsonRecord } from "../../../../packages/api-client";

export function SchemaForm({
  schema,
  spec,
  value,
  onChange,
}: {
  schema: JsonRecord;
  spec: JsonRecord;
  value: JsonRecord;
  onChange: (v: JsonRecord) => void;
}) {
  const s = resolveSchema(schema, spec);
  const session = useContext(SessionContext);
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
  const visible = advanced
    ? fields
    : fields.filter(
        ([key]) => s.required?.includes(key) || common.includes(key),
      );
  function update(key: string, next: unknown) {
    const copy = { ...value };
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
              setErrors({ root: "JSON 格式错误 / Invalid JSON" });
            }
          }}
          required
        />
        {errors.root && <span className="error-text">{errors.root}</span>}
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
        const field = resolveSchema(original, spec);
        const required = s.required?.includes(key);
        const complex =
          field.type === "object" || field.type === "array" || field.properties;
        const title = field.title || key;
        const current = value[key];
        if (key === "permissions" && field.type === "array")
          return (
            <div className="field full" key={key}>
              <span>
                {title}
                {required && <b className="required"> *</b>}
              </span>
              <PermissionPicker
                value={Array.isArray(current) ? current : []}
                restricted={s.title === "TokenScopeRequest"}
                onChange={(next) => update(key, next)}
              />
              {s.title === "TokenScopeRequest" && (
                <small className="field-help">
                  未选择时，Key 在运行时继承账户的 RBAC
                  权限。选择具体权限可进一步限制访问。 / Empty selection
                  inherits account permissions.
                </small>
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
            {["team_id", "scope_id", "server_id", "role_id"].includes(key) ? (
              <ReferenceInput
                name={key}
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
                  <option key={option} value={option}>
                    {String(option)}
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
                <option value="">默认 / Default</option>
                <option value="true">是 / Yes</option>
                <option value="false">否 / No</option>
              </select>
            ) : complex ? (
              <textarea
                aria-label={key}
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
                      [key]: "JSON 格式错误 / Invalid JSON",
                    }));
                  }
                }}
              />
            ) : key === "description" ? (
              <textarea
                aria-label={key}
                rows={2}
                value={current ?? ""}
                required={required}
                maxLength={field.maxLength}
                onChange={(e) => update(key, e.target.value || undefined)}
              />
            ) : (
              <input
                aria-label={key}
                type={
                  /password|secret|api_key|auth_value/i.test(key)
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
            {errors[key] && <span className="error-text">{errors[key]}</span>}
            {complex && (
              <input
                className="validation-proxy"
                value={errors[key] || ""}
                onChange={() => {}}
                pattern="^$"
                tabIndex={-1}
                aria-label={`${key} validation`}
              />
            )}
            {field.description && (
              <small className="field-help">
                {field.description.split("\n")[0]}
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
          展开全部 {fields.length} 个字段 / All fields
        </button>
      )}
    </div>
  );
}

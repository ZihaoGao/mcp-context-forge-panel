import { useEffect, useRef, useState } from "react";
import type { JsonRecord } from "../../../../packages/api-client";
import { inputSchema, inputDefaults } from "../tool-test.mjs";

export function JsonInput({
  value,
  onChange,
  label = "arguments JSON",
}: {
  value: unknown;
  onChange: (value: any) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(() =>
    JSON.stringify(value === undefined ? {} : value, null, 2),
  );
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const serialized = JSON.stringify(value === undefined ? {} : value);
  useEffect(() => {
    setDraft((current) => {
      try {
        if (JSON.stringify(JSON.parse(current)) === serialized) return current;
      } catch {
        /* An external value change replaces the old draft. */
      }
      return JSON.stringify(JSON.parse(serialized), null, 2);
    });
    setInvalid(false);
    input.current?.setCustomValidity("");
  }, [serialized]);
  return (
    <label className="field full">
      <span>{label}</span>
      <textarea
        ref={input}
        aria-label={label}
        rows={8}
        value={draft}
        required
        onChange={(event) => {
          setDraft(event.target.value);
          try {
            const next = JSON.parse(event.target.value);
            event.target.setCustomValidity("");
            setInvalid(false);
            onChange(next);
          } catch {
            event.target.setCustomValidity("Invalid JSON");
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <span className="error-text" role="alert">
          JSON 格式错误 / Invalid JSON
        </span>
      )}
    </label>
  );
}

/** Generic tool input controls deliberately avoid resource-name and permission heuristics. */
export function ToolInputForm({
  schema: original,
  root,
  value,
  onChange,
  path = "arguments",
  required = true,
  en = false,
  depth = 0,
}: {
  schema: JsonRecord;
  root: JsonRecord;
  value: any;
  onChange: (value: any) => void;
  path?: string;
  required?: boolean;
  en?: boolean;
  depth?: number;
}) {
  const schema = inputSchema(original, root);
  const t = (zh: string, english: string) => (en ? english : zh);
  const label = (
    <span>
      {schema.title || path.split(".").at(-1)}
      {required ? " *" : ""} <small>{path}</small>
    </span>
  );
  const help = schema.description && (
    <small className="field-help">{schema.description}</small>
  );
  const complex =
    schema.$ref ||
    schema.oneOf ||
    schema.anyOf ||
    schema.allOf ||
    Array.isArray(schema.type) ||
    depth > 7;
  if (
    complex ||
    (!schema.type &&
      !schema.properties &&
      !schema.enum &&
      schema.const === undefined)
  )
    return (
      <div className="field full">
        {label}
        {help}
        <JsonInput label={path} value={value} onChange={onChange} />
      </div>
    );
  if (schema.enum || schema.const !== undefined) {
    const choices = schema.enum || [schema.const];
    return (
      <label className="field">
        {label}
        <select
          aria-label={path}
          required={required}
          value={value === undefined ? "" : JSON.stringify(value)}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : JSON.parse(event.target.value),
            )
          }
        >
          <option value="">—</option>
          {choices.map((option: unknown, index: number) => (
            <option key={index} value={JSON.stringify(option)}>
              {typeof option === "string" ? option : JSON.stringify(option)}
            </option>
          ))}
        </select>
        {help}
      </label>
    );
  }
  if (schema.type === "object" || schema.properties) {
    if (!schema.properties || Object.keys(schema.properties).length === 0)
      return (
        <div className="field full">
          {help}
          <JsonInput label={path} value={value} onChange={onChange} />
        </div>
      );
    return (
      <fieldset className="nested-fields full">
        <legend>{label}</legend>
        {help}
        {!required && value === undefined ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange(inputDefaults(schema, root) ?? {})}
          >
            {t("填写此对象", "Include object")}
          </button>
        ) : (
          <>
            <div className="schema-form">
              {Object.entries(schema.properties).map(([name, child]) => (
                <ToolInputForm
                  key={name}
                  schema={child as JsonRecord}
                  root={root}
                  value={value?.[name]}
                  path={`${path}.${name}`}
                  required={schema.required?.includes(name) || false}
                  en={en}
                  depth={depth + 1}
                  onChange={(next) => {
                    const copy = { ...value };
                    if (next === undefined) delete copy[name];
                    else copy[name] = next;
                    onChange(copy);
                  }}
                />
              ))}
            </div>
            {!required && (
              <button
                type="button"
                className="text-button"
                onClick={() => onChange(undefined)}
              >
                {t("省略此对象", "Omit object")}
              </button>
            )}
          </>
        )}
      </fieldset>
    );
  }
  if (schema.type === "array") {
    if (!schema.items || Array.isArray(schema.items) || schema.prefixItems)
      return (
        <div className="field full">
          {label}
          {help}
          <JsonInput label={path} value={value ?? []} onChange={onChange} />
        </div>
      );
    const rows = Array.isArray(value) ? value : [];
    return (
      <fieldset className="nested-fields full">
        <legend>{label}</legend>
        {help}
        {rows.map((row: unknown, index: number) => (
          <div className="repeat-row" key={index}>
            <ToolInputForm
              schema={schema.items}
              root={root}
              value={row}
              path={`${path}[${index + 1}]`}
              en={en}
              depth={depth + 1}
              onChange={(next) =>
                onChange(rows.map((item, i) => (i === index ? next : item)))
              }
            />
            <button
              type="button"
              className="text-button"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              {t("移除此项", "Remove item")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={
            schema.maxItems !== undefined && rows.length >= schema.maxItems
          }
          onClick={() => {
            const item = inputSchema(schema.items, root);
            onChange([
              ...rows,
              inputDefaults(item, root) ??
                (item.type === "string"
                  ? ""
                  : item.type === "boolean"
                    ? false
                    : null),
            ]);
          }}
        >
          {t("添加一项", "Add item")}
        </button>
        {!required && value !== undefined && (
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(undefined)}
          >
            {t("省略此数组", "Omit array")}
          </button>
        )}
      </fieldset>
    );
  }
  if (schema.type === "boolean")
    return (
      <label className="field">
        {label}
        <select
          aria-label={path}
          required={required}
          value={value === undefined ? "" : String(value)}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : event.target.value === "true",
            )
          }
        >
          <option value="">—</option>
          <option value="true">{t("是", "Yes")}</option>
          <option value="false">{t("否", "No")}</option>
        </select>
        {help}
      </label>
    );
  if (["string", "number", "integer"].includes(schema.type)) {
    const numeric = schema.type !== "string";
    return (
      <label className="field">
        {label}
        <input
          aria-label={path}
          type={numeric ? "number" : "text"}
          required={required}
          value={value ?? ""}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === "integer" ? 1 : "any"}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? required && !numeric
                  ? ""
                  : undefined
                : numeric
                  ? event.target.valueAsNumber
                  : event.target.value,
            )
          }
        />
        {help}
      </label>
    );
  }
  return (
    <div className="field full">
      {label}
      {help}
      <JsonInput label={path} value={value} onChange={onChange} />
    </div>
  );
}

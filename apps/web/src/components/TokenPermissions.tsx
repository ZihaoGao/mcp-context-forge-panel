import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { SessionContext, useText } from "../session";
import { permitted, request } from "../../../../packages/api-client";
import { PermissionPicker } from "./ReferenceInput";

export const TokenPermissionContext = createContext({
  mode: "inherit",
  setMode: (_mode: string) => {},
});

export function TokenPermissionPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useText();
  const { mode, setMode } = useContext(TokenPermissionContext);
  const { permissions } = useContext(SessionContext);
  const catalog = useQuery({
    queryKey: ["available-permissions"],
    queryFn: () => request("/v1/rbac/permissions/available"),
    retry: false,
  });
  function template(values: string[]) {
    setMode("custom");
    onChange(values.filter((p) => permitted(permissions, p)));
  }
  return (
    <div className="token-permissions">
      <label className="field">
        <span>{t("授权方式", "Authorization mode")}</span>
        <select
          aria-label={t("授权方式", "Authorization mode")}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            onChange([]);
          }}
        >
          <option value="inherit">
            {t("继承账户权限", "Inherit account permissions")}
          </option>
          <option value="custom">
            {t("自定义权限", "Custom permissions")}
          </option>
        </select>
      </label>
      <p className="field-help">
        {mode === "inherit"
          ? t(
              "此 Key 在运行时继承账户的 RBAC 权限，账户角色变化会影响它的权限。它不代表没有权限；服务器、IP 等限制仍然生效。",
              "This key inherits account RBAC permissions at runtime. Role changes affect it. This does not mean no permissions; server, IP and other limits still apply.",
            )
          : t(
              "仅允许下方所选权限，并始终受账户 RBAC 权限约束。至少选择一项，空选不会创建 Key。",
              "Only selected permissions are allowed, within the account's RBAC permissions. Select at least one permission to create a key.",
            )}
      </p>
      {mode === "custom" && (
        <>
          <div className="picker-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => template(["tools.read", "tools.execute"])}
            >
              {t("调用工具", "Call tools")}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!catalog.data}
              onClick={() =>
                template(
                  (catalog.data?.all_permissions || []).filter((p: string) =>
                    p.endsWith(".read"),
                  ),
                )
              }
            >
              {t("只读访问", "Read-only access")}
            </button>
          </div>
          <PermissionPicker value={value} onChange={onChange} restricted />
          {!value.length && (
            <p className="error-text">
              {t(
                "请至少选择一项权限，或明确选择“继承账户权限”。",
                "Select a permission, or explicitly choose Inherit account permissions.",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function TokenPermissionSummary({
  scope,
}: {
  scope?: Record<string, any>;
}) {
  const { mode } = useContext(TokenPermissionContext);
  const t = useText();
  const permissions = scope?.permissions || [];
  return (
    <div className="permission-summary" role="status">
      <strong>
        {t("有效权限：", "Effective permissions: ")}
        {mode === "inherit"
          ? t("继承账户 RBAC 权限", "Inherit account RBAC permissions")
          : permissions.length
            ? t(
                `自定义 ${permissions.length} 项，与账户权限取交集`,
                `${permissions.length} custom permissions, intersected with account permissions`,
              )
            : t(
                "尚未选择权限，无法创建",
                "No permissions selected; cannot create",
              )}
      </strong>
      {mode === "custom" && permissions.length > 0 && (
        <small>{permissions.join("、")}</small>
      )}
      <small>
        {t("服务器范围：", "Server scope: ")}
        {scope?.server_id || t("未额外限制", "No additional restriction")}
        {t(
          "；IP、时间和用量限制以填写的配置为准。",
          "; IP, time and usage limits follow your configuration.",
        )}
      </small>
    </div>
  );
}

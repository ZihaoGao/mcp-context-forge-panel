import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listItems } from "../../../../packages/api-client/contract.mjs";
import {
  request,
  permitted,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext } from "../session";
export function ReferenceInput({
  name,
  value,
  required,
  onChange,
}: {
  name: string;
  value: string;
  required: boolean;
  onChange: (next: string | undefined) => void;
}) {
  const { user } = useContext(SessionContext);
  const endpoint =
    name === "server_id"
      ? "/v1/servers?limit=100&include_pagination=true"
      : name === "role_id"
        ? "/v1/rbac/roles"
        : "/v1/teams/?limit=500";
  const data = useQuery({
    queryKey: ["reference-options", endpoint],
    queryFn: () => request(endpoint),
    enabled: !!user,
    retry: false,
  });
  return (
    <>
      <input
        aria-label={name}
        list={"reference-" + name}
        required={required}
        value={value || ""}
        placeholder="选择或输入 ID / Select or enter ID"
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      <datalist id={"reference-" + name}>
        {listItems(data.data).map((item: JsonRecord) => (
          <option key={item.id} value={item.id}>
            {item.name || item.email}
          </option>
        ))}
      </datalist>
    </>
  );
}
export function PermissionPicker({
  value,
  onChange,
  restricted,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  restricted: boolean;
}) {
  const { user, permissions } = useContext(SessionContext);
  const [filter, setFilter] = useState("");
  const catalog = useQuery({
    queryKey: ["available-permissions"],
    queryFn: () => request("/v1/rbac/permissions/available"),
    enabled: !!user,
    retry: false,
  });
  const options: string[] = catalog.data?.all_permissions || [];
  const allowed = options.filter(
    (permission) => !restricted || permitted(permissions, permission),
  );
  return (
    <div className="permission-picker">
      <input
        aria-label="Filter permission choices"
        placeholder="搜索权限 / Search permissions"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="permission-choices">
        {[...new Set([...allowed, ...value])]
          .filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
          .map((permission) => (
            <label className="check-label" key={permission}>
              <input
                type="checkbox"
                checked={value.includes(permission)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, permission]
                      : value.filter((p) => p !== permission),
                  )
                }
              />
              <code>{permission}</code>
            </label>
          ))}
      </div>
      <small>{value.length} 项已选择 / selected</small>
      {catalog.isError && (
        <small className="error-text">
          权限目录加载失败 / Failed to load permissions
        </small>
      )}
    </div>
  );
}

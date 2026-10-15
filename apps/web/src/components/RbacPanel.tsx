import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserPlus, Search, Trash2 } from "lucide-react";
import {
  request,
  displayError,
  type JsonRecord,
} from "../../../../packages/api-client";
import { listItems } from "../../../../packages/api-client/contract.mjs";
import { ActionDialog, type Operation } from "./ActionDialog";
import { findOperation } from "./DataPage";

export function RbacPanel({
  spec,
  team,
  en = false,
}: {
  spec: JsonRecord;
  team: string;
  en?: boolean;
}) {
  const [tab, setTab] = useState("assignments");
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState("");
  const [operation, setOperation] = useState<Operation>();
  const [preset, setPreset] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const roleCatalog = useQuery({
    queryKey: ["role-catalog"],
    queryFn: () => request("/v1/rbac/roles?active_only=false"),
    retry: false,
  });
  const roleNames = new Map(
    listItems(roleCatalog.data).map((role: JsonRecord) => [role.id, role.name]),
  );
  const assignments = useQuery({
    queryKey: ["assignments", target, team],
    queryFn: () =>
      request(
        `/v1/rbac/users/${encodeURIComponent(target)}/roles${team ? "?scope=team&scope_id=" + encodeURIComponent(team) : ""}`,
      ),
    enabled: !!target,
    retry: false,
  });
  const permissions = useQuery({
    queryKey: ["available-permissions"],
    queryFn: () => request("/v1/rbac/permissions/available"),
    enabled: tab === "permissions",
    retry: false,
  });
  const entries =
    permissions.data?.permissions_by_resource ||
    permissions.data?.permissions ||
    permissions.data?.all_permissions ||
    {};
  const groups = Array.isArray(entries) ? { Permissions: entries } : entries;
  function assign() {
    setPreset({ user_email: target || email });
    setOperation(
      findOperation(spec, "/v1/rbac/users/{user_email}/roles", "POST"),
    );
  }
  return (
    <section className="panel rbac-panel">
      <div className="section-heading">
        <div className="title-with-icon">
          <ShieldCheck size={20} />
          <h3>{en ? "Access control" : "访问控制"}</h3>
        </div>
        <div className="segmented">
          <button
            className={tab === "assignments" ? "active" : ""}
            onClick={() => setTab("assignments")}
          >
            {en ? "User roles" : "用户角色"}
          </button>
          <button
            className={tab === "permissions" ? "active" : ""}
            onClick={() => setTab("permissions")}
          >
            {en ? "Permission catalog" : "权限目录"}
          </button>
        </div>
      </div>
      {tab === "assignments" ? (
        <>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setTarget(email);
            }}
          >
            <label className="search-field">
              <Search size={17} />
              <input
                required
                type="email"
                aria-label="User email"
                placeholder={en ? "User email" : "输入用户邮箱，查询角色分配"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="button secondary">
              {en ? "Look up" : "查询"}
            </button>
            <button type="button" className="button primary" onClick={assign}>
              <UserPlus size={16} />
              {en ? "Assign role" : "分配角色"}
            </button>
          </form>
          {assignments.error && (
            <div className="alert error">{displayError(assignments.error)}</div>
          )}
          {target &&
            !assignments.isPending &&
            !listItems(assignments.data).length && (
              <p className="muted">
                {en ? "No role assignments." : "暂无角色分配。"}
              </p>
            )}
          <div className="assignment-list">
            {listItems(assignments.data).map((r: JsonRecord) => (
              <div key={r.id || `${r.role_id}-${r.team_id}`}>
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {r.role_name ||
                      r.role?.name ||
                      roleNames.get(r.role_id) ||
                      r.role_id}
                  </strong>
                  <small>
                    {r.scope || r.role?.scope} ·{" "}
                    {r.scope_id || (en ? "Global" : "全局")}
                  </small>
                </div>
                <button
                  className="icon-button danger-text"
                  aria-label="Revoke role"
                  onClick={() => {
                    setPreset({
                      user_email: target,
                      role_id: r.role_id,
                      scope: r.scope,
                      ...(r.scope_id ? { scope_id: r.scope_id } : {}),
                    });
                    setOperation(
                      findOperation(
                        spec,
                        "/v1/rbac/users/{user_email}/roles/{role_id}",
                        "DELETE",
                      ),
                    );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search permissions"
              placeholder={en ? "Search permissions…" : "搜索权限…"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {permissions.error && (
            <div className="alert error">{displayError(permissions.error)}</div>
          )}
          <div className="permission-catalog">
            {Object.entries(groups).map(([group, values]) => (
              <section key={group}>
                <h4>{group}</h4>
                {(Array.isArray(values)
                  ? values
                  : Object.entries(values as any).map(
                      ([name, description]) => ({ name, description }),
                    )
                )
                  .filter((p: any) =>
                    JSON.stringify(p)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p: any, i: number) => (
                    <div key={i}>
                      <code>
                        {typeof p === "string"
                          ? p
                          : p.permission || p.name || p.id}
                      </code>
                      <small>
                        {typeof p === "string" ? "" : p.description}
                      </small>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
      {operation && (
        <ActionDialog
          operation={operation}
          spec={spec}
          preset={preset}
          onClose={() => setOperation(undefined)}
          onSuccess={() => {
            void assignments.refetch();
          }}
          en={en}
        />
      )}
    </section>
  );
}

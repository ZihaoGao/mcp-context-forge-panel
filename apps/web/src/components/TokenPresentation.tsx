import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  permitted,
  request,
  ApiError,
  type JsonRecord,
} from "../../../../packages/api-client";
import { SessionContext, useText } from "../session";
import { tokenState } from "../token-display.mjs";

export function TokenStatus({ token }: { token: JsonRecord }) {
  const t = useText();
  const state = tokenState(token);
  return (
    <span
      className={`badge ${state === "revoked" ? "danger" : state === "disabled" ? "neutral" : "success"}`}
    >
      <span className="status-dot" />
      {state === "revoked"
        ? t("已撤销", "Revoked")
        : state === "disabled"
          ? t("已停用", "Disabled")
          : t("可用", "Available")}
    </span>
  );
}

function ScopeReference({
  kind,
  id,
  spec,
  teams,
}: {
  kind: "team" | "server";
  id?: string | null;
  spec: JsonRecord;
  teams: JsonRecord[];
}) {
  const t = useText();
  const { permissions, user } = useContext(SessionContext);
  const path =
    kind === "team" ? "/v1/teams/{team_id}" : "/v1/servers/{server_id}";
  const endpoint = spec.paths?.[path]?.get ? path : path + "/";
  const operation = spec.paths?.[endpoint]?.get;
  const knownName =
    kind === "team" ? teams.find((team) => team.id === id)?.name : undefined;
  const mayRead =
    !!operation &&
    operation["x-panel-available"] !== false &&
    (!operation["x-panel-admin"] || user?.is_admin) &&
    permitted(permissions, operation["x-panel-permission"] || `${kind}s.read`);
  const reference = useQuery({
    queryKey: ["token-scope-reference", kind, id],
    queryFn: async ({ signal }) => {
      try {
        return await request(
          endpoint.replace(/\{[^}]+\}/, encodeURIComponent(id!)),
          { signal },
        );
      } catch (error) {
        // Cache inaccessible/missing names too, so switching layout or opening
        // details does not keep requesting the same forbidden/deleted resource.
        if (error instanceof ApiError && [403, 404].includes(error.status))
          return null;
        throw error;
      }
    },
    enabled: !!id && !knownName && mayRead,
    staleTime: 60000,
    retry: false,
  });
  const name =
    knownName ||
    (mayRead && !reference.isError ? reference.data?.name : undefined);
  return (
    <span
      className="badge neutral"
      title={
        id
          ? `${name ? name + "\n" : ""}${t(kind === "team" ? "团队 ID" : "服务器 ID", kind === "team" ? "Team ID" : "Server ID")}: ${id}`
          : undefined
      }
    >
      {!id
        ? kind === "team"
          ? t("未指定团队", "No team specified")
          : t("未限定服务器", "No server restriction")
        : `${kind === "team" ? t("团队", "Team") : t("服务器", "Server")}: ${name || (mayRead && reference.isFetching ? t("加载中…", "Loading…") : t("名称不可用", "Name unavailable"))}`}
    </span>
  );
}

export function TokenScope({
  token,
  spec,
  teams = [],
}: {
  token: JsonRecord;
  spec: JsonRecord;
  teams?: JsonRecord[];
}) {
  return (
    <div className="token-scope">
      <ScopeReference
        kind="team"
        id={token.team_id}
        spec={spec}
        teams={teams}
      />
      <ScopeReference
        kind="server"
        id={token.server_id}
        spec={spec}
        teams={teams}
      />
    </div>
  );
}

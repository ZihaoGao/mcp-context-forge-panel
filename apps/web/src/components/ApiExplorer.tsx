import { useContext, useMemo, useState } from "react";
import { SessionContext } from "../session";
import { permitted } from "../../../../packages/api-client";
import { Search, ArrowUpRight, Braces } from "lucide-react";
import { operations } from "../../../../packages/api-client/contract.mjs";
import type { JsonRecord } from "../../../../packages/api-client";
import { ActionDialog, type Operation } from "./ActionDialog";

export function ApiExplorer({
  spec,
  filter = "",
  en = false,
}: {
  spec: JsonRecord;
  filter?: string;
  en?: boolean;
}) {
  const [search, setSearch] = useState("");
  const session = useContext(SessionContext);
  const canExecute = (op: Operation) =>
    permitted(session.permissions, op["x-panel-permission"]) &&
    (!op["x-panel-admin"] || session.user?.is_admin);
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Operation>();
  const [showExcluded, setShowExcluded] = useState(false);
  const all = useMemo(() => operations(spec) as Operation[], [spec]);
  const scoped = all.filter(
    (o) =>
      !filter ||
      o.path.includes(filter) ||
      o.tags?.some((t: string) =>
        t.toLowerCase().includes(filter.toLowerCase()),
      ),
  );
  const tags = [
    ...new Set(scoped.flatMap((o) => o.tags || ["Other"])),
  ].sort() as string[];
  const visible = scoped.filter(
    (o) =>
      (showExcluded || o.classification.kind !== "excluded") &&
      (!tag || o.tags?.includes(tag)) &&
      `${o.method} ${o.path} ${o.summary}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="api-explorer">
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search API"
            placeholder={en ? "Search actions, paths…" : "搜索操作、接口路径…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="API group"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">{en ? "All groups" : "所有分组"}</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
          />
          {en ? "Show exclusions" : "显示排除项"}
        </label>
        <span className="muted">
          {visible.length} {en ? "actions" : "个操作"}
        </span>
      </div>
      <div className="api-list">
        {visible.length ? (
          visible.map((op) => (
            <button
              key={op.method + op.path}
              className="api-row"
              onClick={() => setSelected(op)}
              disabled={
                op.classification.kind === "excluded" ||
                op["x-panel-available"] === false ||
                !canExecute(op)
              }
              title={
                op["x-panel-available"] === false
                  ? `${en ? "Not enabled: " : "当前未启用："}${op["x-panel-feature"] || "backend feature flag"}`
                  : undefined
              }
            >
              <span className={`method ${op.method.toLowerCase()}`}>
                {op.method}
              </span>
              <div>
                <strong>{op.summary || op.operationId}</strong>
                <code>{op.path}</code>
              </div>
              <span className="badge neutral">
                {op.classification.kind === "excluded"
                  ? op.classification.reason
                  : op["x-panel-available"] === false
                    ? en
                      ? "Not enabled"
                      : "未启用"
                    : !canExecute(op)
                      ? en
                        ? "Permission required"
                        : "权限不足"
                      : op.tags?.[0]}
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))
        ) : (
          <div className="empty">
            <Braces size={30} />
            <h3>{en ? "No matching actions" : "没有匹配的操作"}</h3>
          </div>
        )}
      </div>
      {selected && (
        <ActionDialog
          operation={selected}
          spec={spec}
          onClose={() => setSelected(undefined)}
          onSuccess={() => {}}
          en={en}
        />
      )}
    </section>
  );
}

import { useState } from "react";
import { resourceTags } from "../list-model.mjs";

export function ResourceTags({ tags, en }: { tags: unknown; en: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const labels = resourceTags(tags);
  if (!labels.length) return null;
  return (
    <div className="resource-tags" aria-label={en ? "Tags" : "标签"}>
      {(expanded ? labels : labels.slice(0, 3)).map((tag: string) => (
        <span className="badge neutral" key={tag}>
          {tag}
        </span>
      ))}
      {labels.length > 3 && (
        <button
          type="button"
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? en
              ? "Show fewer tags"
              : "收起标签"
            : en
              ? `Show ${labels.length - 3} more tags`
              : `展开其余 ${labels.length - 3} 个标签`}
        </button>
      )}
    </div>
  );
}

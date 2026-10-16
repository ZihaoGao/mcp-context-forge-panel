function numeric(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function formatNumber(value, en = false) {
  const number = numeric(value);
  return number === undefined
    ? "—"
    : new Intl.NumberFormat(en ? "en-GB" : "zh-CN", {
        maximumFractionDigits: 2,
      }).format(number);
}

export function formatDuration(value, en = false) {
  const number = numeric(value);
  if (number === undefined || number < 0) return "—";
  return `${number > 0 && number < 0.01 ? "<0.01" : formatNumber(number, en)} ms`;
}

export function utcTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim();
  // v1.0.11 stores UTC. SQLite may return timestamps without an offset.
  const zoned =
    /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(raw) &&
    !/(Z|[+-]\d\d:\d\d)$/i.test(raw)
      ? raw + "Z"
      : raw;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function formatTimestamp(value, en = false, timeZone) {
  const iso = utcTimestamp(value);
  if (!iso) return "—";
  return new Intl.DateTimeFormat(en ? "en-GB" : "zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).format(new Date(iso));
}

export function formatOperationalValue(value, key, en = false) {
  if (
    /(^|_)duration_ms$/.test(key) ||
    /^p(?:50|90|95|99)(?:_duration_ms)?$/.test(key)
  )
    return formatDuration(value, en);
  if (/^(timestamp|start_time|end_time|created_at|updated_at)$/.test(key))
    return formatTimestamp(value, en);
  if (key === "error_rate")
    return numeric(value) === undefined ? "—" : `${formatNumber(value, en)}%`;
  if (typeof value === "number") return formatNumber(value, en);
  return undefined;
}

export function metricRows(value, kind) {
  if (!value || !Array.isArray(value.buckets)) return [];
  return value.buckets.map((timestamp, i) =>
    kind === "percentiles"
      ? {
          timestamp,
          p50: value.p50?.[i] ?? null,
          p95: value.p95?.[i] ?? null,
          p99: value.p99?.[i] ?? null,
        }
      : {
          timestamp,
          request_count: value.values?.[i] ?? null,
          success_count: value.success_count?.[i] ?? null,
          error_count: value.error_count?.[i] ?? null,
        },
  );
}

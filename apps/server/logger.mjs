const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };
export const ERROR_LOG_BYTES = 8192;

export function normalizeLogLevel(value = "info") {
  const level = String(value).trim().toLowerCase();
  const normalized = level === "warning" ? "warn" : level;
  if (!Object.hasOwn(levels, normalized))
    throw new Error("LOG_LEVEL must be debug, info, warn, error or silent");
  return normalized;
}

export function logPath(raw = "/") {
  try {
    const parts = new URL(raw, "http://panel").pathname.split("/");
    for (let i = 0; i < parts.length; i++) {
      const segment = decodeURIComponent(parts[i]).toLowerCase();
      if (
        ["reset-password", "accept-invitation", "navigate"].includes(segment) &&
        parts[i + 1]
      )
        parts[++i] = "[redacted]";
      if (
        segment === "invitations" &&
        decodeURIComponent(parts[i + 2] || "").toLowerCase() === "accept"
      )
        parts[i + 1] = "[redacted]";
    }
    return parts.join("/").slice(0, 1024);
  } catch {
    return "[invalid path]";
  }
}

function cleanText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        const url = new URL(raw);
        return url.origin + logPath(url.pathname);
      } catch {
        return "[redacted URL]";
      }
    })
    .replace(/\/[^\s<>"']*\?[^\s<>"']*/g, (raw) => logPath(raw))
    .replace(/\bBearer\s+[^\s,"';}]+/gi, "Bearer [redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted JWT]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted key]")
    .replace(
      /\b(password|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|session[_-]?id|state|code|auth[_-]?(?:token|value|header[_-]?value)|client[_-]?secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 1024);
}

function safeValue(value, depth = 0) {
  if (depth > 6) return "[depth limit]";
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => safeValue(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, v]) => [
          key,
          /password|secret|credential|authorization|cookie|token|api[_-]?key|auth[_-]?value|private[_-]?key|^input$|^headers$|^body$/i.test(
            key,
          )
            ? "[redacted]"
            : safeValue(v, depth + 1),
        ]),
    );
  return value;
}

export function errorInfo(error) {
  return {
    name: error?.name || "Error",
    code: error?.code || error?.cause?.code,
    message: error?.message || "Unknown error",
  };
}

export function createLogger({
  level = "info",
  write,
  now = () => new Date(),
} = {}) {
  const threshold = levels[normalizeLogLevel(level)];
  const sink =
    write ||
    ((line, severity) =>
      (levels[severity] >= levels.warn ? process.stderr : process.stdout).write(
        line,
      ));
  return Object.fromEntries(
    Object.keys(levels)
      .filter((key) => key !== "silent")
      .map((severity) => [
        severity,
        (event, fields = {}) => {
          if (levels[severity] < threshold) return;
          const line = `${now().toISOString()} ${severity.toUpperCase()} ${event.replace(/[^a-zA-Z0-9._-]/g, "_")} ${JSON.stringify(safeValue(fields))}\n`;
          sink(line, severity);
        },
      ]),
  );
}

// Retain diagnostic fields, never echoed request input, context or whole bodies.
export function backendErrorSummary(value, depth = 0) {
  if (depth > 4) return "[depth limit]";
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value))
    return value.slice(0, 10).map((v) => backendErrorSummary(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) =>
        [
          "detail",
          "message",
          "error",
          "code",
          "type",
          "reason",
          "errors",
          "loc",
          "msg",
        ].includes(key),
      )
      .map(([key, v]) => [key, backendErrorSummary(v, depth + 1)]),
  );
}

function errorBodyMode(headers) {
  const type = String(headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== "application/json" && !type.endsWith("+json")) return "non_json";
  if (headers["content-encoding"] && headers["content-encoding"] !== "identity")
    return "encoded";
  if (Number(headers["content-length"]) > ERROR_LOG_BYTES) return "too_large";
  return "json";
}

function parseErrorBody(chunks) {
  try {
    return {
      summary: backendErrorSummary(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      ),
    };
  } catch {
    return { detail_unavailable: "invalid_json" };
  }
}

// Observe a bounded prefix without buffering, replacing or delaying the proxy.
export function observeBackendError(stream, emit) {
  const mode = errorBodyMode(stream.headers);
  if (mode !== "json") {
    emit({ detail_unavailable: mode });
    return;
  }
  let size = 0;
  let finished = false;
  const chunks = [];
  function finish(fields) {
    if (finished) return;
    finished = true;
    stream.removeListener("data", collect);
    emit(fields);
  }
  function collect(chunk) {
    size += chunk.length;
    if (size > ERROR_LOG_BYTES)
      return finish({ detail_unavailable: "too_large" });
    chunks.push(Buffer.from(chunk));
  }
  stream.on("data", collect);
  stream.once("end", () => finish(parseErrorBody(chunks)));
  stream.once("aborted", () => finish({ detail_unavailable: "incomplete" }));
}

// Used only when the panel will discard a failed server-side fetch response.
export async function readBackendError(response) {
  const mode = errorBodyMode(Object.fromEntries(response.headers));
  if (mode !== "json") {
    response.body?.cancel().catch(() => {});
    return { detail_unavailable: mode };
  }
  const reader = response.body?.getReader();
  if (!reader) return { detail_unavailable: "empty" };
  const chunks = [];
  let size = 0;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Log body timeout")), 1000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) return parseErrorBody(chunks);
      size += value.length;
      if (size > ERROR_LOG_BYTES) return { detail_unavailable: "too_large" };
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { detail_unavailable: "incomplete" };
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
}

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import httpProxy from "http-proxy";
import { readConfig, upstreamPath } from "./config.mjs";
import { clientIp } from "./client-ip.mjs";
import { mcpSseTransform } from "./sse.mjs";
import {
  createLogger,
  errorInfo,
  logPath,
  backendErrorSummary,
  observeBackendError,
  readBackendError,
} from "./logger.mjs";

const COOKIE = "cf_panel_session";
const TYPES = {
  ".json": "application/json",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
function cookies(raw = "") {
  return Object.fromEntries(
    raw
      .split(";")
      .map((p) => p.trim().split(/=(.*)/s))
      .filter((p) => p[0])
      .map(([k, v]) => [k, v || ""]),
  );
}
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 64 * 1024)
      throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected JSON object");
    return parsed;
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
export function createPanelServer(config = readConfig(), options = {}) {
  const logger = options.logger || createLogger({ level: config.logLevel });
  const requestLogs = new WeakMap();
  function beginRequest(req, protocol = "http") {
    const entry = {
      request_id: randomUUID(),
      method: req.method,
      path: logPath(req.url),
      client_ip: clientIp(req, config.trustedProxies),
      protocol,
      started: process.hrtime.bigint(),
    };
    requestLogs.set(req, entry);
    logger.debug(`${protocol}.request`, requestFields(req));
    return entry;
  }
  function requestFields(req) {
    const entry = requestLogs.get(req);
    return entry
      ? {
          request_id: entry.request_id,
          method: entry.method,
          path: entry.path,
          client_ip: entry.client_ip,
        }
      : {};
  }
  function backendFields(req, endpoint = req.url, method = req.method) {
    return {
      ...requestFields(req),
      backend_method: method,
      backend: config.upstream.origin,
      backend_path: logPath(endpoint),
    };
  }
  function httpError(req, status, endpoint, method) {
    logger[status >= 500 ? "error" : "warn"]("backend.http_error", {
      ...backendFields(req, endpoint, method),
      status,
    });
  }
  function errorDetail(
    req,
    status,
    fields,
    endpoint = req.url,
    method = req.method,
  ) {
    logger[status >= 500 ? "error" : "warn"]("backend.error_detail", {
      ...backendFields(req, endpoint, method),
      status,
      ...fields,
    });
  }
  async function backendFetch(req, endpoint, init = {}) {
    const fields = backendFields(req, endpoint, init.method || "GET");
    logger.debug("backend.request", fields);
    try {
      const response = await fetch(new URL(endpoint, config.upstream.origin), {
        ...init,
        headers: {
          ...init.headers,
          "X-Request-ID": requestLogs.get(req)?.request_id,
        },
      });
      if (response.status >= 400)
        httpError(req, response.status, endpoint, init.method || "GET");
      return response;
    } catch (error) {
      requestLogs.get(req).failure = "backend_connection_error";
      requestLogs.get(req).diagnosticLogged = true;
      logger.error("backend.connection_error", {
        ...fields,
        error: errorInfo(error),
      });
      throw error;
    }
  }
  async function backendJson(
    req,
    response,
    endpoint = response.url,
    method = req.method,
  ) {
    try {
      const result = await response.json();
      if (response.status >= 400)
        errorDetail(
          req,
          response.status,
          { summary: backendErrorSummary(result) },
          endpoint,
          method,
        );
      return result;
    } catch (error) {
      requestLogs.get(req).diagnosticLogged = true;
      logger.error("backend.invalid_response", {
        ...backendFields(req, endpoint, method),
        status: response.status,
        reason: "invalid_json",
        error: { name: error.name },
      });
      throw new Error("Invalid JSON response from backend");
    }
  }
  function discardedBackendError(req, response, endpoint, method = "GET") {
    if (response.status >= 400)
      readBackendError(response)
        .then((fields) =>
          errorDetail(req, response.status, fields, endpoint, method),
        )
        .catch(() =>
          errorDetail(
            req,
            response.status,
            { detail_unavailable: "incomplete" },
            endpoint,
            method,
          ),
        );
  }
  const webRoot = path.resolve(options.webRoot || "dist/web");
  const compressedAssets = new Map();
  const proxy = httpProxy.createProxyServer({
    target: config.upstream.origin,
    changeOrigin: true,
    ws: true,
    ignorePath: false,
    xfwd: false,
  });
  const sessions = new Map();
  const navigation = new Map();
  const reap = setInterval(() => {
    for (const [key, session] of sessions)
      if (session.expires <= Date.now()) sessions.delete(key);
    for (const [key, entry] of navigation)
      if (entry.expires <= Date.now()) navigation.delete(key);
  }, 60000);
  reap.unref();
  function sessionFor(req) {
    const id = cookies(req.headers.cookie)[COOKIE];
    const session = sessions.get(id);
    if (session && session.expires > Date.now()) return session;
    if (id) sessions.delete(id);
    return undefined;
  }
  function issueSession(token, seconds, res, mode = "interactive") {
    if (sessions.size >= 10000)
      throw Object.assign(new Error("Session capacity reached"), {
        status: 503,
      });
    const id = randomBytes(32).toString("base64url");
    let remaining = Number(seconds) || 3600;
    // Authentication was performed by the backend. Decode only for expiry;
    // this is not used as a substitute for signature validation.
    try {
      const claim = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
      if (Number.isFinite(claim.exp))
        remaining = Math.min(
          remaining,
          Math.floor(claim.exp - Date.now() / 1000),
        );
    } catch {
      /* Opaque validated tokens retain the backend-provided TTL. */
    }
    if (remaining <= 0)
      throw Object.assign(new Error("Backend token expired"), { status: 401 });
    const age = Math.max(1, Math.min(remaining, 86400));
    sessions.set(id, { token, mode, expires: Date.now() + age * 1000 });
    res.setHeader("Set-Cookie", sessionCookie(id, age));
  }
  const sessionCookie = (token, maxAge) =>
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=${config.prefix || "/"}; Max-Age=${maxAge}${config.secure ? "; Secure" : ""}`;
  const expectedOrigin = config.publicOrigin;
  function forwardedHeaders(req) {
    return {
      "X-Forwarded-For": clientIp(req, config.trustedProxies),
      "X-Real-IP": clientIp(req, config.trustedProxies),
      "X-Forwarded-Proto": new URL(expectedOrigin).protocol.slice(0, -1),
      "X-Forwarded-Host": new URL(expectedOrigin).host,
    };
  }
  function sameOrigin(req) {
    return req.headers.origin === expectedOrigin;
  }
  function proxyRequest(req) {
    const callerIp = clientIp(req, config.trustedProxies);
    const parsed = cookies(req.headers.cookie);
    const panelIdentity =
      req.headers["x-panel-request"] === "1" && !req.headers.authorization
        ? sessionFor(req)
        : undefined;
    if (
      req.headers["x-panel-request"] === "1" &&
      !req.headers.authorization &&
      sessionFor(req)
    )
      req.headers.authorization = `Bearer ${sessionFor(req).token}`;
    req.headers.cookie = Object.entries(parsed)
      .filter(([key]) => ![COOKIE, "jwt_token", "access_token"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    // The legacy Chat connection endpoint explicitly reads this backend cookie.
    // Supply it only for an authenticated panel call, never to external clients.
    if (
      panelIdentity &&
      new URL(req.url, "http://panel").pathname ===
        `${config.prefix}/v1/llmchat/connect`
    )
      req.headers.cookie += `${req.headers.cookie ? "; " : ""}jwt_token=${panelIdentity.token}`;
    delete req.headers["x-panel-request"];
    delete req.headers.forwarded;
    for (const key of Object.keys(req.headers))
      if (key.startsWith("x-forwarded-")) delete req.headers[key];
    const publicUrl = new URL(expectedOrigin);
    req.headers["x-forwarded-proto"] = publicUrl.protocol.slice(0, -1);
    req.headers["x-forwarded-host"] = publicUrl.host;
    req.headers["x-forwarded-prefix"] = config.prefix;
    req.headers["x-forwarded-for"] = callerIp;
    req.headers["x-real-ip"] = callerIp;
    req.headers["x-request-id"] = requestLogs.get(req)?.request_id;
    const incoming = new URL(req.url, "http://panel");
    req.url =
      upstreamPath(
        config,
        incoming.pathname.slice(config.prefix.length) || "/",
      ) + incoming.search;
    logger.debug("backend.request", backendFields(req));
  }
  proxy.on("proxyRes", (proxyRes, req, res) => {
    const entry = requestLogs.get(req);
    proxyRes.headers["x-request-id"] = entry?.request_id;
    if (proxyRes.statusCode >= 400) {
      httpError(req, proxyRes.statusCode);
      observeBackendError(proxyRes, (fields) =>
        errorDetail(req, proxyRes.statusCode, fields),
      );
    }
    let responseFailed = false;
    const responseError = (error) => {
      if (responseFailed || res.destroyed || res.writableEnded) return;
      responseFailed = true;
      entry.failure = "backend_response_aborted";
      logger.error("backend.response_aborted", {
        ...backendFields(req),
        status: proxyRes.statusCode,
        ...(error ? { error: errorInfo(error) } : {}),
      });
      res.destroy();
    };
    proxyRes.once("aborted", () => responseError());
    proxyRes.once("error", responseError);
    res.once("close", () => {
      if (!res.writableEnded) proxyRes.destroy();
    });
    proxyRes.headers["cache-control"] = "no-store";
    const location = proxyRes.headers.location;
    if (location) {
      const resolved = new URL(location, config.upstream);
      if (resolved.origin === config.upstream.origin) {
        const root = config.upstream.pathname.replace(/\/$/, "");
        if (
          !root ||
          resolved.pathname === root ||
          resolved.pathname.startsWith(root + "/")
        )
          proxyRes.headers.location =
            expectedOrigin +
            config.prefix +
            resolved.pathname.slice(root.length) +
            resolved.search +
            resolved.hash;
      }
    }
    if (proxyRes.headers["set-cookie"])
      proxyRes.headers["set-cookie"] = proxyRes.headers["set-cookie"].map((c) =>
        c
          .replace(/;\s*Domain=[^;]*/gi, "")
          .replace(/;\s*Path=[^;]*/gi, `; Path=${config.prefix || "/"}`),
      );
    if (req.rewriteMcpSse) {
      const rewrite =
        String(proxyRes.headers["content-type"]).includes(
          "text/event-stream",
        ) && !proxyRes.headers["content-encoding"];
      if (rewrite) delete proxyRes.headers["content-length"];
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      if (rewrite) {
        const stream = mcpSseTransform(config);
        stream.on("error", (error) => {
          entry.failure = "sse_transform_error";
          logger.error("proxy.sse_error", {
            ...requestFields(req),
            error: errorInfo(error),
          });
          res.destroy();
        });
        proxyRes.pipe(stream).pipe(res);
      } else proxyRes.pipe(res);
    }
  });
  proxy.on("error", (error, req, res) => {
    if (res.destroyed || req.aborted) {
      logger.debug("proxy.client_closed", {
        ...requestFields(req),
        error: errorInfo(error),
      });
      return;
    }
    requestLogs.get(req).failure = "backend_connection_error";
    logger.error("backend.connection_error", {
      ...backendFields(req),
      error: errorInfo(error),
    });
    if ("writeHead" in res && !res.headersSent)
      json(res, 502, { detail: "Backend unavailable" });
    else res.destroy();
  });
  const server = http.createServer(async (req, res) => {
    const entry = beginRequest(req);
    res.setHeader("X-Request-ID", entry.request_id);
    let logged = false;
    function access(completed) {
      if (logged) return;
      logged = true;
      const status = completed || res.headersSent ? res.statusCode : 499;
      const level =
        entry.failure || status >= 500
          ? "error"
          : completed && status >= 400
            ? "warn"
            : "info";
      logger[level]("http.access", {
        ...requestFields(req),
        status,
        duration_ms:
          Math.round(Number(process.hrtime.bigint() - entry.started) / 1e3) /
          1e3,
        completed,
        ...(entry.failure ? { failure: entry.failure } : {}),
      });
    }
    res.once("finish", () => access(true));
    res.once("close", () => access(res.writableFinished));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    let url;
    try {
      url = new URL(req.url, "http://panel");
    } catch {
      logger.warn("http.invalid_url", requestFields(req));
      return json(res, 400, { detail: "Invalid request URL" });
    }
    if (url.pathname === "/" && ["GET", "HEAD"].includes(req.method)) {
      res.writeHead(302, {
        Location: `${config.prefix}/app/`,
        "Cache-Control": "no-store",
      });
      return res.end();
    }
    if (
      config.prefix &&
      url.pathname !== config.prefix &&
      !url.pathname.startsWith(config.prefix + "/")
    )
      return json(res, 404, { detail: "Not found" });
    const local = url.pathname.slice(config.prefix.length) || "/";
    const hasSession = Boolean(cookies(req.headers.cookie)[COOKIE]);
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (
      ((local.startsWith("/_panel/") && unsafe) ||
        (hasSession && req.headers["x-panel-request"] === "1" && unsafe)) &&
      !sameOrigin(req)
    )
      return json(res, 403, {
        detail: {
          code: "ORIGIN_MISMATCH",
          message: "Same-origin request required",
          login_url: `${expectedOrigin}${config.prefix}/app/`,
        },
      });
    try {
      if (local === "/_panel/config.js" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-store",
        });
        return res.end(
          `window.__PANEL_CONFIG__=${JSON.stringify({ prefix: config.prefix, version: "1.0.11", publicOrigin: expectedOrigin })};`,
        );
      }
      if (local === "/_panel/session" && req.method === "GET") {
        const session = sessionFor(req);
        if (!session) return json(res, 401, { detail: "Session required" });
        return json(res, 200, { mode: session.mode });
      }
      if (local === "/_panel/login" && req.method === "POST") {
        const input = await body(req);
        const response = await backendFetch(
          req,
          new URL(
            upstreamPath(config, "/v1/auth/email/login"),
            config.upstream.origin,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...forwardedHeaders(req),
            },
            body: JSON.stringify({
              email: input.email,
              password: input.password,
            }),
            signal: AbortSignal.timeout(30000),
            redirect: "manual",
          },
        );
        const result = await backendJson(req, response);
        if (!response.ok)
          return json(res, response.status, {
            detail: result.detail || "Login failed",
          });
        if (
          typeof result.access_token !== "string" ||
          !/^[A-Za-z0-9._~-]+$/.test(result.access_token)
        ) {
          logger.error("backend.invalid_response", {
            ...backendFields(req, response.url),
            reason: "missing_or_invalid_access_token",
          });
          return json(res, 502, {
            detail: "Invalid backend authentication response",
          });
        }
        issueSession(result.access_token, result.expires_in, res);
        return json(res, 200, { user: result.user });
      }
      if (local === "/_panel/token-login" && req.method === "POST") {
        const input = await body(req);
        if (
          typeof input.token !== "string" ||
          !/^[A-Za-z0-9._~-]+$/.test(input.token)
        )
          return json(res, 400, { detail: "Invalid token" });
        const response = await backendFetch(
          req,
          new URL(
            upstreamPath(config, "/v1/auth/email/me"),
            config.upstream.origin,
          ),
          {
            headers: { Authorization: `Bearer ${input.token}` },
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok) {
          discardedBackendError(req, response, response.url);
          return json(res, response.status, {
            detail: "Token authentication failed",
          });
        }
        // Imported credentials are borrowed: disconnect must never revoke them,
        // even when the supplied JWT happens to be an interactive session token.
        issueSession(input.token, 3600, res, "token");
        return json(res, 200, {
          user: await backendJson(req, response, response.url, "GET"),
        });
      }
      if (local === "/_panel/refresh" && req.method === "POST") {
        const session = sessionFor(req);
        if (!session) return json(res, 401, { detail: "Session required" });
        if (session.mode === "token")
          return json(res, 403, {
            detail:
              "Token connections cannot be refreshed. Reconnect with a valid token.",
          });
        const token = session.token;
        const response = await backendFetch(
          req,
          new URL(
            upstreamPath(config, "/v1/auth/refresh"),
            config.upstream.origin,
          ),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
            redirect: "manual",
          },
        );
        if (!response.ok) {
          discardedBackendError(req, response, response.url, "POST");
          return json(res, response.status, {
            detail: "Session could not be refreshed",
          });
        }
        const result = await backendJson(req, response);
        if (
          typeof result.access_token !== "string" ||
          !/^[A-Za-z0-9._~-]+$/.test(result.access_token)
        ) {
          logger.error("backend.invalid_response", {
            ...backendFields(req, response.url),
            reason: "missing_or_invalid_access_token",
          });
          return json(res, 502, {
            detail: "Invalid backend authentication response",
          });
        }
        sessions.delete(cookies(req.headers.cookie)[COOKIE]);
        issueSession(result.access_token, result.expires_in, res);
        return json(res, 200, { ok: true });
      }
      if (local === "/_panel/logout" && req.method === "POST") {
        const session = sessionFor(req);
        sessions.delete(cookies(req.headers.cookie)[COOKIE]);
        res.setHeader("Set-Cookie", sessionCookie("", 0));
        if (session?.mode === "interactive") {
          const response = await backendFetch(
            req,
            new URL(
              upstreamPath(config, "/v1/auth/logout"),
              config.upstream.origin,
            ),
            {
              method: "POST",
              headers: { Authorization: `Bearer ${session.token}` },
              signal: AbortSignal.timeout(10000),
              redirect: "manual",
            },
          );
          if (!response.ok && response.status !== 401) {
            discardedBackendError(req, response, response.url, "POST");
            return json(res, 502, {
              detail: "Local session cleared; backend revocation failed",
            });
          }
        }
        return json(res, 200, { ok: true });
      }
      if (local === "/_panel/navigation" && req.method === "POST") {
        if (!sessionFor(req))
          return json(res, 401, { detail: "Session required" });
        const input = await body(req);
        if (
          typeof input.path !== "string" ||
          !/^\/(oauth|vault)\/authorize\/[^/?]+(?:\?[^#]*)?$/.test(input.path)
        )
          return json(res, 400, {
            detail: "Unsupported authorization endpoint",
          });
        if (navigation.size >= 1000)
          return json(res, 503, { detail: "Navigation capacity reached" });
        const ticket = randomBytes(32).toString("base64url");
        navigation.set(ticket, {
          session: cookies(req.headers.cookie)[COOKIE],
          target: input.path,
          expires: Date.now() + 60000,
        });
        return json(res, 200, {
          url: `${config.prefix}/_panel/navigate/${ticket}`,
        });
      }
      if (local.startsWith("/_panel/navigate/") && req.method === "GET") {
        const ticket = local.split("/").pop();
        const entry = navigation.get(ticket);
        if (
          !entry ||
          entry.expires <= Date.now() ||
          entry.session !== cookies(req.headers.cookie)[COOKIE] ||
          !sessionFor(req)
        )
          return json(res, 404, { detail: "Navigation expired" });
        navigation.delete(ticket);
        req.url = config.prefix + entry.target;
        req.headers["x-panel-request"] = "1";
        proxyRequest(req);
        proxy.web(req, res);
        return;
      }
      if (local.startsWith("/_panel/"))
        return json(res, 404, { detail: "Not found" });
      if (local.startsWith("/v1/auth/sso/callback/") && req.method === "GET") {
        const callback = await backendFetch(
          req,
          new URL(
            upstreamPath(config, local) + url.search,
            config.upstream.origin,
          ),
          {
            headers: {
              Cookie: Object.entries(cookies(req.headers.cookie))
                .filter(
                  ([key]) =>
                    ![COOKIE, "jwt_token", "access_token"].includes(key),
                )
                .map(([key, value]) => `${key}=${value}`)
                .join("; "),
              "X-Forwarded-Proto": new URL(expectedOrigin).protocol.slice(
                0,
                -1,
              ),
              "X-Forwarded-Host": new URL(expectedOrigin).host,
            },
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          },
        );
        const authCookie = callback.headers
          .getSetCookie()
          .find((c) => /^(jwt_token|access_token)=/.test(c));
        const token = authCookie
          ?.split(";")[0]
          .split("=")
          .slice(1)
          .join("=")
          .replace(/^"|"$/g, "");
        if (token && /^[A-Za-z0-9._~-]+$/.test(token)) {
          const validated = await backendFetch(
            req,
            new URL(
              upstreamPath(config, "/v1/auth/email/me"),
              config.upstream.origin,
            ),
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10000),
            },
          );
          if (validated.ok) {
            issueSession(token, 3600, res);
            res.writeHead(302, { Location: `${config.prefix}/app/#dashboard` });
            return res.end();
          }
          discardedBackendError(req, validated, validated.url);
        }
        discardedBackendError(req, callback, callback.url);
        res.writeHead(302, { Location: `${config.prefix}/app/#sso-error` });
        return res.end();
      }
      if (local === "/" || local === "/app") {
        res.writeHead(302, { Location: `${config.prefix}/app/` });
        return res.end();
      }
      if (
        req.method === "GET" &&
        /^\/(?:admin\/)?(?:accept-invitation|reset-password|forgot-password)(\/|$)/.test(
          local,
        )
      ) {
        res.writeHead(302, {
          Location:
            config.prefix + "/app" + local.replace(/^\/admin/, "") + url.search,
        });
        return res.end();
      }
      if (local.startsWith("/app/")) {
        if (!["GET", "HEAD"].includes(req.method))
          return json(res, 405, { detail: "Method not allowed" });
        let name = decodeURIComponent(local.slice(5));
        if (!name) name = "index.html";
        if (
          /^(?:accept-invitation\/[^/]+|reset-password\/[^/]+|forgot-password|register|login)\/?$/.test(
            name,
          )
        )
          name = "index.html";
        const file = path.resolve(webRoot, name);
        if (!file.startsWith(webRoot + path.sep))
          return json(res, 404, { detail: "Not found" });
        const metadata = await stat(file).catch(() => null);
        if (!metadata?.isFile()) return json(res, 404, { detail: "Not found" });
        let contents = await readFile(file);
        if (name === "index.html")
          contents = Buffer.from(
            contents
              .toString()
              .replace(
                "<!-- PANEL_CONFIG -->",
                `<base href="${config.prefix}/app/"><script src="${config.prefix}/_panel/config.js"></script>`,
              ),
          );
        if (
          /\bgzip\b/.test(req.headers["accept-encoding"] || "") &&
          contents.length > 1024
        ) {
          const key = file + ":" + metadata.mtimeMs;
          let zipped =
            name !== "index.html" ? compressedAssets.get(key) : undefined;
          if (!zipped) {
            zipped = gzipSync(contents);
            if (name !== "index.html") {
              if (compressedAssets.size > 40) compressedAssets.clear();
              compressedAssets.set(key, zipped);
            }
          }
          contents = zipped;
          res.setHeader("Content-Encoding", "gzip");
          res.setHeader("Vary", "Accept-Encoding");
        }
        res.writeHead(200, {
          "Content-Type": name.endsWith(".html")
            ? "text/html; charset=utf-8"
            : TYPES[path.extname(name)] || "application/octet-stream",
          "Cache-Control": name.startsWith("assets/")
            ? "public,max-age=31536000,immutable"
            : "no-store",
          "Content-Security-Policy":
            "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        });
        return res.end(req.method === "HEAD" ? undefined : contents);
      }
      if (decodeURIComponent(local).startsWith("/_internal/"))
        return json(res, 404, { detail: "Not found" });
      if (
        req.headers["x-panel-request"] === "1" &&
        !req.headers.authorization &&
        !sessionFor(req) &&
        !local.startsWith("/v1/auth/")
      )
        return json(res, 401, { detail: "Panel session expired" });
      if (
        req.headers["x-panel-request"] === "1" &&
        !req.headers.authorization &&
        hasSession &&
        !sessionFor(req)
      )
        return json(res, 401, { detail: "Panel session expired" });
      proxyRequest(req);
      req.rewriteMcpSse = /\/sse\/?$/.test(
        new URL(req.url, "http://panel").pathname,
      );
      if (req.rewriteMcpSse) req.headers["accept-encoding"] = "identity";
      proxy.web(req, res, { selfHandleResponse: req.rewriteMcpSse });
    } catch (error) {
      const status = error.status || 502;
      if (status >= 500) entry.failure ||= "request_error";
      if (!entry.diagnosticLogged)
        logger[status >= 500 ? "error" : "warn"]("http.request_error", {
          ...requestFields(req),
          status,
          error: errorInfo(error),
        });
      if (!res.headersSent)
        json(res, status, {
          detail: error.status
            ? error.message
            : "Request could not be completed",
        });
      else res.destroy();
    }
  });
  proxy.on("proxyReqWs", (outgoing, req) => {
    outgoing.once("upgrade", (upstream) => {
      upstream.headers["x-request-id"] = requestLogs.get(req).request_id;
      requestLogs.get(req).wsStatus = upstream.statusCode;
      logger.info("ws.open", {
        ...requestFields(req),
        status: upstream.statusCode,
      });
    });
    outgoing.once("response", (upstream) => {
      upstream.headers["x-request-id"] = requestLogs.get(req).request_id;
      // http-proxy writes this rejection directly to the raw client socket.
      // IncomingMessage has already removed chunk framing; delimit by close.
      delete upstream.headers["transfer-encoding"];
      delete upstream.headers.trailer;
      upstream.headers.connection = "close";
      requestLogs.get(req).wsStatus = upstream.statusCode;
      if (upstream.statusCode >= 400) {
        httpError(req, upstream.statusCode);
        observeBackendError(upstream, (fields) =>
          errorDetail(req, upstream.statusCode, fields),
        );
      }
    });
  });
  server.on("upgrade", (req, socket, head) => {
    const entry = beginRequest(req, "ws");
    socket.once("close", () => {
      const level =
        entry.failure || entry.wsStatus >= 500
          ? "error"
          : entry.rejected || entry.wsStatus >= 400
            ? "warn"
            : "info";
      logger[level]("ws.access", {
        ...requestFields(req),
        status: entry.wsStatus || null,
        duration_ms:
          Math.round(Number(process.hrtime.bigint() - entry.started) / 1e3) /
          1e3,
        upgraded: entry.wsStatus === 101,
        ...(entry.failure ? { failure: entry.failure } : {}),
        ...(entry.rejected ? { rejected: entry.rejected } : {}),
      });
    });
    let local;
    try {
      local = decodeURIComponent(new URL(req.url, "http://panel").pathname);
    } catch {
      entry.rejected = "invalid_path";
      return socket.destroy();
    }
    if (
      (config.prefix && !local.startsWith(config.prefix + "/")) ||
      local.startsWith(`${config.prefix}/_internal/`) ||
      local.startsWith(`${config.prefix}/_panel/`) ||
      local.startsWith(`${config.prefix}/app/`)
    ) {
      entry.rejected = "private_path";
      return socket.destroy();
    }
    // Browser WebSockets cannot set the explicit session opt-in header.
    delete req.headers["x-panel-request"];
    proxyRequest(req);
    proxy.ws(req, socket, head);
  });
  server.on("close", () => {
    clearInterval(reap);
    sessions.clear();
    navigation.clear();
    proxy.close();
  });
  return server;
}

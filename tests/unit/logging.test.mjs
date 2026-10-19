import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createPanelServer } from "../../apps/server/server.mjs";
import { readConfig } from "../../apps/server/config.mjs";
import {
  createLogger,
  logPath,
  ERROR_LOG_BYTES,
} from "../../apps/server/logger.mjs";

function capture(level = "debug") {
  const lines = [];
  const logger = createLogger({ level, write: (line) => lines.push(line) });
  return {
    logger,
    lines,
    records: () =>
      lines.map((line) => {
        const match =
          /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (DEBUG|INFO|WARN|ERROR) ([\w.-]+) (.*)\n$/.exec(
            line,
          );
        assert.ok(match, "one ISO-prefixed record per line");
        return {
          time: match[1],
          level: match[2],
          event: match[3],
          ...JSON.parse(match[4]),
        };
      }),
  };
}
async function fixture(t, handler, level = "debug") {
  const logs = capture(level);
  const backend = http.createServer(handler);
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const panel = createPanelServer(
    readConfig({
      APP_ROOT_PATH: "/forge",
      BACKEND_URL: `http://127.0.0.1:${backend.address().port}/internal`,
      PUBLIC_ORIGIN: "http://localhost:3000",
    }),
    { logger: logs.logger },
  );
  panel.listen(0, "127.0.0.1");
  await once(panel, "listening");
  const origin = `http://127.0.0.1:${panel.address().port}`;
  t.after(async () => {
    panel.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all(
      [panel, backend].map(
        (server) => new Promise((resolve) => server.close(() => resolve())),
      ),
    );
  });
  return { ...logs, backend, panel, origin };
}
function call(origin, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + path, { method, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
      });
      const finish = (aborted = false) =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          aborted,
        });
      res.once("end", () => finish());
      res.once("aborted", () => finish(true));
      res.on("error", () => finish(true));
    });
    req.once("error", reject);
    req.end(body);
  });
}
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
async function logged(logs, predicate) {
  for (let i = 0; i < 100; i++) {
    const record = logs.records().find(predicate);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("expected log record was not emitted");
}

test("logger levels, ISO prefix, single-line output and credential redaction", () => {
  const logs = capture("INFO");
  logs.logger.debug("hidden");
  logs.logger.info("access", {
    message: "line one\nline two",
    password: "fake-password",
    cookie: "fake-cookie",
    detail:
      'password="fake-detail" authToken=fake-token {"api_key":"fake-api-key"} Bearer fake-bearer https://name:fake-userinfo@example.com/path?code=fake-query /callback?session_id=fake-session state=fake-state code=fake-code',
  });
  logs.logger.warn("warning");
  logs.logger.error("failure");
  assert.deepEqual(
    logs.records().map((r) => r.level),
    ["INFO", "WARN", "ERROR"],
  );
  const output = logs.lines.join("");
  for (const secret of [
    "fake-password",
    "fake-cookie",
    "fake-detail",
    "fake-token",
    "fake-api-key",
    "fake-bearer",
    "fake-userinfo",
    "fake-query",
    "fake-session",
    "fake-state",
    "fake-code",
  ])
    assert.ok(!output.includes(secret), secret);
  assert.equal(readConfig({}).logLevel, "info");
  assert.equal(readConfig({ LOG_LEVEL: "WARNING" }).logLevel, "warn");
  assert.throws(() => readConfig({ LOG_LEVEL: "verbose" }), /LOG_LEVEL/);
  const silent = capture("silent");
  silent.logger.error("hidden");
  assert.equal(silent.lines.length, 0);
  const errors = capture("error");
  errors.logger.info("hidden");
  errors.logger.warn("hidden");
  errors.logger.error("shown");
  assert.deepEqual(
    errors.records().map((r) => r.event),
    ["shown"],
  );
  for (const path of [
    "/forge/app/reset-password/fake-path",
    "/forge/accept-invitation/fake-path",
    "/forge/_panel/navigate/fake-path",
    "/forge/v1/teams/invitations/fake-path/%61ccept",
  ])
    assert.ok(!logPath(path + "?token=fake-query").includes("fake-"));
});

test("an invalid configured log level fails startup with an ISO-formatted error", () => {
  const child = spawnSync(process.execPath, ["apps/server/index.mjs"], {
    env: { ...process.env, LOG_LEVEL: "invalid-test-level" },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(child.status, 1);
  assert.match(
    child.stderr,
    /^\d{4}-\d\d-\d\dT\S+Z ERROR server.start_failed /,
  );
  assert.match(child.stderr, /LOG_LEVEL must be/);
});

test("access logs use public paths and generated request IDs, with trusted client IP and no query or credentials", async (t) => {
  let backendRequest;
  const logs = await fixture(t, (req, res) => {
    backendRequest = req;
    json(res, 200, { ok: true });
  });
  const response = await call(logs.origin, "/forge/v1/tools?token=fake-query", {
    headers: {
      "X-Request-ID": "fake-caller-id",
      Authorization: "Bearer fake-auth",
      Cookie: "fake-cookie",
      "X-Forwarded-For": "203.0.113.9",
    },
  });
  assert.equal(response.status, 200);
  const record = await logged(logs, (r) => r.event === "http.access");
  assert.equal(record.path, "/forge/v1/tools");
  assert.equal(record.status, 200);
  assert.equal(record.completed, true);
  assert.ok(record.duration_ms >= 0);
  assert.equal(record.client_ip, "127.0.0.1");
  assert.match(record.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers["x-request-id"], record.request_id);
  assert.equal(backendRequest.headers["x-request-id"], record.request_id);
  assert.equal(backendRequest.url, "/internal/v1/tools?token=fake-query");
  assert.ok(!logs.lines.join("").includes("fake-"));
  await call(
    logs.origin,
    "/forge/app/reset-password/fake-path?token=fake-reset",
  );
  await logged(logs, (r) => r.path.includes("[redacted]"));
  assert.ok(!logs.lines.join("").includes("fake-path"));
});

test("backend HTTP failures record bounded sanitized diagnostics and leave response bytes unchanged", async (t) => {
  const payload = {
    detail: [
      {
        type: "value_error",
        loc: ["body", "password"],
        msg: "password=fake-echo is invalid",
        input: "fake-input",
        ctx: { credential: "fake-context" },
      },
    ],
    token: "fake-token",
  };
  const logs = await fixture(t, (_req, res) => json(res, 500, payload));
  const response = await call(
    logs.origin,
    "/forge/v1/tools?api_key=fake-query",
  );
  assert.equal(response.text, JSON.stringify(payload));
  const detail = await logged(logs, (r) => r.event === "backend.error_detail");
  assert.equal(detail.level, "ERROR");
  assert.equal(detail.backend_path, "/internal/v1/tools");
  assert.equal(detail.summary.detail[0].type, "value_error");
  assert.deepEqual(detail.summary.detail[0].loc, ["body", "password"]);
  for (const secret of [
    "fake-echo",
    "fake-input",
    "fake-context",
    "fake-token",
    "fake-query",
  ])
    assert.ok(!logs.lines.join("").includes(secret));
  const access = await logged(logs, (r) => r.event === "http.access");
  assert.equal(access.level, "ERROR");
  assert.equal(access.status, 500);
  assert.equal(access.request_id, detail.request_id);
});

test("warn suppresses successful access while retaining client and backend 4xx diagnostics", async (t) => {
  const logs = await fixture(
    t,
    (req, res) =>
      json(res, req.url.includes("denied") ? 403 : 200, {
        detail: "Permission denied",
      }),
    "warn",
  );
  await call(logs.origin, "/forge/success");
  assert.equal(logs.lines.length, 0);
  const denied = await call(logs.origin, "/forge/denied");
  assert.equal(denied.status, 403);
  const access = await logged(logs, (r) => r.event === "http.access");
  assert.equal(access.level, "WARN");
  assert.equal(
    logs.records().find((r) => r.event === "backend.error_detail").summary
      .detail,
    "Permission denied",
  );
  await call(logs.origin, "/outside");
  assert.ok(
    logs
      .records()
      .some(
        (r) =>
          r.event === "http.access" && r.status === 404 && r.level === "WARN",
      ),
  );
});

test("upstream transport failures and server-side fetch timeouts emit correlated error records", async (t) => {
  const logs = await fixture(t, (_req, res) => json(res, 200, {}));
  await new Promise((resolve) => logs.backend.close(resolve));
  const response = await call(logs.origin, "/forge/v1/tools");
  assert.equal(response.status, 502);
  const error = await logged(
    logs,
    (r) => r.event === "backend.connection_error",
  );
  assert.equal(error.error.code, "ECONNREFUSED");
  assert.equal(error.request_id, response.headers["x-request-id"]);
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("Backend timeout", "TimeoutError");
  });
  const timeout = await call(logs.origin, "/forge/_panel/login", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: "fake-request-password" }),
  });
  assert.equal(timeout.status, 502);
  assert.ok(
    logs
      .records()
      .some(
        (r) =>
          r.event === "backend.connection_error" &&
          r.error.name === "TimeoutError",
      ),
  );
  assert.ok(!logs.lines.join("").includes("fake-request-password"));
  assert.ok(!logs.records().some((r) => r.event === "http.request_error"));
});

test("control-plane fetch errors include backend details and malformed auth JSON cannot leak its input", async (t) => {
  let invalid = false;
  const logs = await fixture(t, (_req, res) => {
    if (invalid) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("fake-unlabelled-json-secret");
    }
    json(res, 401, { detail: "Token expired", access_token: "fake-echo" });
  });
  const options = {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: "fake-input-token" }),
  };
  const denied = await call(logs.origin, "/forge/_panel/token-login", options);
  assert.equal(denied.status, 401);
  const detail = await logged(logs, (r) => r.event === "backend.error_detail");
  assert.equal(detail.backend_method, "GET");
  assert.equal(detail.backend_path, "/internal/v1/auth/email/me");
  assert.equal(detail.summary.detail, "Token expired");
  invalid = true;
  const malformed = await call(logs.origin, "/forge/_panel/login", options);
  assert.equal(malformed.status, 502);
  assert.ok(
    logs
      .records()
      .some(
        (r) =>
          r.event === "backend.invalid_response" && r.reason === "invalid_json",
      ),
  );
  for (const secret of [
    "fake-echo",
    "fake-input-token",
    "fake-unlabelled-json-secret",
  ])
    assert.ok(!logs.lines.join("").includes(secret));
});

test("oversized, non-JSON and compressed errors skip bodies without changing proxy responses", async (t) => {
  const big = JSON.stringify({ detail: "x".repeat(ERROR_LOG_BYTES * 2) });
  const logs = await fixture(t, (req, res) => {
    if (req.url.endsWith("/html")) {
      res.writeHead(500, { "Content-Type": "text/html" });
      return res.end("<p>fake-html-secret</p>");
    }
    if (req.url.endsWith("/encoded")) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      });
      return res.end("fake-encoded-secret");
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(big);
  });
  assert.equal((await call(logs.origin, "/forge/large")).text, big);
  assert.equal(
    (await call(logs.origin, "/forge/html")).text,
    "<p>fake-html-secret</p>",
  );
  assert.equal(
    (await call(logs.origin, "/forge/encoded")).text,
    "fake-encoded-secret",
  );
  const reasons = logs
    .records()
    .filter((r) => r.event === "backend.error_detail")
    .map((r) => r.detail_unavailable);
  assert.deepEqual(reasons, ["too_large", "non_json", "encoded"]);
  assert.ok(!logs.lines.join("").includes("fake-"));
});

test("discarded authentication error summaries do not delay the client response", async (t) => {
  const logs = await fixture(t, (_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.write('{"detail":');
  });
  const started = performance.now();
  const response = await call(logs.origin, "/forge/_panel/token-login", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: "fake-discarded-token" }),
  });
  assert.equal(response.status, 401);
  assert.ok(
    performance.now() - started < 500,
    "client response must not wait for an unfinished error body",
  );
  logs.backend.closeAllConnections();
  const detail = await logged(logs, (r) => r.event === "backend.error_detail");
  assert.equal(detail.detail_unavailable, "incomplete");
});

test("upstream streaming interruption is an error while client cancellation is not", async (t) => {
  const logs = await fixture(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    if (req.url.endsWith("/broken")) setTimeout(() => res.destroy(), 10);
  });
  const broken = await call(logs.origin, "/forge/broken");
  assert.equal(broken.status, 200);
  assert.equal(broken.aborted, true);
  const error = await logged(
    logs,
    (r) => r.event === "backend.response_aborted",
  );
  const failedAccess = await logged(
    logs,
    (r) => r.event === "http.access" && r.request_id === error.request_id,
  );
  assert.equal(failedAccess.level, "ERROR");
  assert.equal(failedAccess.status, 200);
  assert.equal(failedAccess.completed, false);
  await new Promise((resolve, reject) => {
    const req = http.get(logs.origin + "/forge/client-cancel", (res) => {
      res.once("data", () => {
        res.destroy();
        resolve();
      });
      res.on("error", () => {});
    });
    req.once("error", reject);
  });
  const cancelled = await logged(
    logs,
    (r) => r.event === "http.access" && r.path.endsWith("client-cancel"),
  );
  assert.equal(cancelled.level, "INFO");
  assert.equal(cancelled.completed, false);
  assert.ok(
    !logs
      .records()
      .some(
        (r) => r.request_id === cancelled.request_id && r.level === "ERROR",
      ),
  );
});

test(
  "WebSocket handshake and close are logged with a shared request ID",
  { timeout: 3000 },
  async (t) => {
    const logs = await fixture(t, (_req, res) => json(res, 404, {}));
    logs.backend.on("upgrade", (req, socket) => {
      const accept = createHash("sha1")
        .update(
          req.headers["sec-websocket-key"] +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on("data", () => socket.end());
    });
    let responseId;
    await new Promise((resolve, reject) => {
      const req = http.get(logs.origin + "/forge/socket?token=fake-ws-token", {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (res, socket) => {
        responseId = res.headers["x-request-id"];
        socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
        socket.on("close", resolve);
        socket.on("error", reject);
      });
      req.on("error", reject);
    });
    const open = await logged(logs, (r) => r.event === "ws.open");
    const closed = await logged(logs, (r) => r.event === "ws.access");
    assert.equal(open.status, 101);
    assert.equal(closed.status, 101);
    assert.equal(closed.upgraded, true);
    assert.equal(open.request_id, closed.request_id);
    assert.equal(responseId, open.request_id);
    assert.ok(!logs.lines.join("").includes("fake-ws-token"));
  },
);

test("rejected backend WebSocket handshakes include diagnostics and an access status", async (t) => {
  const logs = await fixture(t, (_req, res) =>
    json(res, 503, { detail: "Socket backend unavailable" }),
  );
  const response = await call(logs.origin, "/forge/socket", {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
    },
  });
  assert.equal(response.status, 503);
  const access = await logged(logs, (r) => r.event === "ws.access");
  assert.equal(access.status, 503);
  assert.equal(access.level, "ERROR");
  assert.equal(access.upgraded, false);
  assert.equal(response.headers["x-request-id"], access.request_id);
  const detail = await logged(logs, (r) => r.event === "backend.error_detail");
  assert.equal(detail.summary.detail, "Socket backend unavailable");
});

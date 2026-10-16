import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createPanelServer } from "../../apps/server/server.mjs";
import { readConfig, normalizePrefix } from "../../apps/server/config.mjs";

let upstream, panel, origin, lastRequest, browserCookie;
let streamClosed;
const publicOrigin = "http://localhost:3000";
before(async () => {
  upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    lastRequest = { url: req.url, headers: req.headers, body };
    if (
      req.url === "/backend/v1/auth/email/login" ||
      req.url === "/backend/v1/auth/refresh"
    ) {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          access_token: "signed.session.jwt",
          expires_in: 3600,
          user: { email: "user@example.com" },
        }),
      );
    }
    if (req.url === "/backend/endless") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      const interval = setInterval(() => res.write("data: next\n\n"), 20);
      res.once("close", () => {
        clearInterval(interval);
        streamClosed?.();
      });
      return;
    }
    if (req.url.startsWith("/backend/v1/auth/sso/callback/")) {
      res.writeHead(302, {
        Location: "/backend/admin/",
        "Set-Cookie": "jwt_token=signed.sso.jwt; HttpOnly; Path=/",
      });
      return res.end();
    }
    if (req.url === "/backend/stream") {
      res.setHeader("Content-Type", "text/event-stream");
      res.flushHeaders();
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: last\n\n"), 200);
      return;
    }
    if (req.url === "/backend/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      return res.end(
        'event: endpoint\ndata: /backend/message?session_id=test\n\nevent: message\ndata: {"content":"unchanged"}\n\n',
      );
    }
    if (req.url === "/backend/redirect") {
      res.writeHead(307, {
        Location: "/backend/v1/tools?a=1",
        "Set-Cookie": "csrf=test; Domain=internal; Path=/backend",
      });
      return res.end();
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(lastRequest));
  });
  upstream.on("upgrade", (req, socket) => {
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const message = Buffer.from(req.url);
    socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
    socket.on("data", () => socket.end());
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  panel = createPanelServer(
    readConfig({
      APP_ROOT_PATH: "/forge",
      BACKEND_URL: `http://127.0.0.1:${upstream.address().port}/backend`,
      PUBLIC_ORIGIN: publicOrigin,
    }),
  );
  panel.listen(0, "127.0.0.1");
  await once(panel, "listening");
  origin = `http://127.0.0.1:${panel.address().port}`;
  const login = await fetch(origin + "/forge/_panel/login", {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json" },
    body: "{}",
  });
  browserCookie = login.headers.get("set-cookie").split(";")[0];
});
after(async () => {
  panel.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([
    new Promise((r) => panel.close(r)),
    new Promise((r) => upstream.close(r)),
  ]);
});
test("validates deployment prefixes and fixed upstream", () => {
  assert.equal(normalizePrefix("/forge/"), "/forge");
  assert.equal(normalizePrefix("/"), "");
  for (const value of ["//evil", "/foo?token=a", "/a/../b", "relative"])
    assert.throws(() => normalizePrefix(value));
  assert.throws(() => readConfig({ BACKEND_URL: "file:///private" }));
});
test("maps public prefix to independent upstream root and retains query/protocol headers", async () => {
  const r = await fetch(origin + "/forge/v1/tools?q=a%2Fb", {
    headers: {
      Authorization: "Bearer caller",
      "Mcp-Session-Id": "session-42",
      "MCP-Protocol-Version": "2025-06-18",
      "X-Forwarded-Host": "attacker",
    },
  });
  const data = await r.json();
  assert.equal(data.url, "/backend/v1/tools?q=a%2Fb");
  assert.equal(data.headers.authorization, "Bearer caller");
  assert.equal(data.headers["mcp-session-id"], "session-42");
  assert.equal(data.headers["x-forwarded-host"], "localhost:3000");
});
test("login sets HttpOnly scoped cookie and does not expose JWT", async () => {
  const response = await fetch(origin + "/forge/_panel/login", {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "not-logged" }),
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Lax; Path=\/forge/,
  );
  assert.equal((await response.json()).access_token, undefined);
  assert.equal(lastRequest.url, "/backend/v1/auth/email/login");
});
test("browser session requires explicit opt-in; external bearer wins; panel cookie never leaks upstream", async () => {
  const cookie = browserCookie + "; csrf=csrf-value";
  const plain = await (
    await fetch(origin + "/forge/v1/tools", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(plain.headers.authorization, undefined);
  assert.equal(plain.headers.cookie, "csrf=csrf-value");
  const browser = await (
    await fetch(origin + "/forge/v1/tools", {
      headers: { Cookie: cookie, "X-Panel-Request": "1" },
    })
  ).json();
  assert.equal(browser.headers.authorization, "Bearer signed.session.jwt");
  const external = await (
    await fetch(origin + "/forge/v1/tools", {
      headers: {
        Cookie: cookie,
        "X-Panel-Request": "1",
        Authorization: "Bearer external.jwt",
      },
    })
  ).json();
  assert.equal(external.headers.authorization, "Bearer external.jwt");
});
test("rejects cross-origin and missing-origin browser mutations before hitting backend", async () => {
  for (const source of ["", "https://attacker.example"]) {
    const r = await fetch(origin + "/forge/v1/tokens", {
      method: "POST",
      headers: {
        Cookie: "cf_panel_session=jwt",
        "X-Panel-Request": "1",
        ...(source ? { Origin: source } : {}),
      },
    });
    assert.equal(r.status, 403);
    const login = await fetch(origin + "/forge/_panel/login", {
      method: "POST",
      headers: source ? { Origin: source } : {},
    });
    assert.equal(login.status, 403);
  }
  const external = await fetch(origin + "/forge/v1/tokens", {
    method: "POST",
    headers: { Authorization: "Bearer external.jwt" },
  });
  assert.equal(external.status, 200);
});
test("keeps streaming incremental and rewrites only upstream redirects/cookies", async () => {
  const response = await fetch(origin + "/forge/stream");
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
  const second = await reader.read();
  assert.match(new TextDecoder().decode(second.value), /last/);
  await reader.cancel();
  const redirect = await fetch(origin + "/forge/redirect", {
    redirect: "manual",
  });
  assert.equal(
    redirect.headers.get("location"),
    publicOrigin + "/forge/v1/tools?a=1",
  );
  assert.equal(redirect.headers.get("set-cookie"), "csrf=test; Path=/forge");
});
test("SSE HTTP proxy rewrites the MCP message endpoint for the public prefix", async () => {
  const response = await fetch(origin + "/forge/sse");
  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    'event: endpoint\ndata: /forge/message?session_id=test\n\nevent: message\ndata: {"content":"unchanged"}\n\n',
  );
});
test("blocks private routes, deployment escapes and serves runtime config", async () => {
  for (const url of [
    "/v1/tools",
    "/forgex/v1/tools",
    "/forge/_internal/mcp/rpc",
    "/forge/%5finternal/mcp/rpc",
    "/forge/_panel/unknown",
  ])
    assert.equal((await fetch(origin + url)).status, 404, url);
  const config = await fetch(origin + "/forge/_panel/config.js");
  assert.equal(config.headers.get("cache-control"), "no-store");
  assert.match(await config.text(), /"prefix":"\/forge"/);
});

test("root redirects into the prefixed console and origin errors identify the configured entry", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await fetch(origin + "/", { method, redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/forge/app/");
  }
  const response = await fetch(origin + "/forge/_panel/login", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3000",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.deepEqual((await response.json()).detail, {
    code: "ORIGIN_MISMATCH",
    message: "Same-origin request required",
    login_url: publicOrigin + "/forge/app/",
  });
});
test("logout clears cookie and revokes upstream session; refresh rotates without exposing token", async () => {
  const headers = { Origin: publicOrigin, Cookie: browserCookie };
  const refresh = await fetch(origin + "/forge/_panel/refresh", {
    method: "POST",
    headers,
  });
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).access_token, undefined);
  assert.match(refresh.headers.get("set-cookie"), /HttpOnly/);
  headers.Cookie = refresh.headers.get("set-cookie").split(";")[0];
  const logout = await fetch(origin + "/forge/_panel/logout", {
    method: "POST",
    headers,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(lastRequest.url, "/backend/v1/auth/logout");
  assert.equal(lastRequest.headers.authorization, "Bearer signed.session.jwt");
  const replay = await fetch(origin + "/forge/v1/tools", {
    headers: { Cookie: headers.Cookie, "X-Panel-Request": "1" },
  });
  assert.equal(replay.status, 401);
});
test("WebSocket upgrades retain public path mapping", async () => {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/forge/ws");
  const [event] = await once(ws, "message");
  assert.equal(event.data, "/backend/ws");
  ws.close();
  await once(ws, "close");
});
test("client cancellation closes the upstream streaming response", async () => {
  const closed = new Promise((resolve) => {
    streamClosed = resolve;
  });
  const response = await fetch(origin + "/forge/endless");
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.race([
    closed,
    new Promise((_, reject) => {
      const t = setTimeout(
        () => reject(new Error("Upstream stream remained open")),
        1000,
      );
      t.unref();
    }),
  ]);
});
test("SSO callback creates an opaque session and redirects into the new console", async () => {
  const response = await fetch(
    origin + "/forge/v1/auth/sso/callback/provider?code=one&state=two",
    { redirect: "manual", headers: { Cookie: "sso_session_id=binding" } },
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/forge/app/#dashboard");
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(!cookie.includes("signed.sso.jwt"));
  const data = await (
    await fetch(origin + "/forge/v1/tools", {
      headers: { Cookie: cookie.split(";")[0], "X-Panel-Request": "1" },
    })
  ).json();
  assert.equal(data.headers.authorization, "Bearer signed.sso.jwt");
});
test("encoded private WebSocket routes are rejected", async () => {
  const ws = new WebSocket(
    origin.replace("http:", "ws:") + "/forge/%5finternal/mcp/transport",
  );
  await once(ws, "error");
});
test("rejects non-object login bodies and caps session lifetime at validated JWT expiry", async () => {
  for (const body of ["null", "[]", '"text"']) {
    const response = await fetch(origin + "/forge/_panel/login", {
      method: "POST",
      headers: { Origin: publicOrigin, "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, 400);
  }
  const jwt = (exp) =>
    "header." +
    Buffer.from(JSON.stringify({ exp })).toString("base64url") +
    ".signature";
  const tokenLogin = (token) =>
    fetch(origin + "/forge/_panel/token-login", {
      method: "POST",
      headers: { Origin: publicOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  const short = await tokenLogin(jwt(Math.floor(Date.now() / 1000) + 15));
  assert.equal(short.status, 200);
  const age = Number(short.headers.get("set-cookie").match(/Max-Age=(\d+)/)[1]);
  assert.ok(age > 0 && age <= 15);
  const expired = await tokenLogin(jwt(Math.floor(Date.now() / 1000) - 15));
  assert.equal(expired.status, 401);
});
test("browser authorization navigation is same-origin, fixed-upstream, session-bound and one-time", async () => {
  const login = await fetch(origin + "/forge/_panel/login", {
    method: "POST",
    headers: { Origin: publicOrigin, "Content-Type": "application/json" },
    body: "{}",
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = {
    Origin: publicOrigin,
    "Content-Type": "application/json",
    Cookie: cookie,
  };
  for (const target of [
    "https://attacker.example",
    "/_internal/mcp/rpc",
    "/v1/servers",
  ])
    assert.equal(
      (
        await fetch(origin + "/forge/_panel/navigation", {
          method: "POST",
          headers,
          body: JSON.stringify({ path: target }),
        })
      ).status,
      400,
    );
  const created = await fetch(origin + "/forge/_panel/navigation", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "/oauth/authorize/gateway" }),
  });
  const { url } = await created.json();
  assert.equal((await fetch(origin + url)).status, 404);
  const authorized = await fetch(origin + url, { headers: { Cookie: cookie } });
  assert.equal(authorized.status, 200);
  assert.equal(
    (await authorized.json()).headers.authorization,
    "Bearer signed.session.jwt",
  );
  assert.equal(
    (await fetch(origin + url, { headers: { Cookie: cookie } })).status,
    404,
  );
});

import http from "node:http";
import { once } from "node:events";
export async function createFixtureServices() {
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/mcp") {
      if (req.method === "GET" || req.method === "DELETE") {
        res.writeHead(405);
        return res.end();
      }
      if (body.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      let result = {};
      if (body.method === "initialize")
        result = {
          protocolVersion: body.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "panel-test-fixture", version: "1.0.0" },
        };
      if (body.method === "tools/list") result = { tools: [] };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "panel-fixture",
              object: "model",
              owned_by: "integration-test",
            },
          ],
        }),
      );
    }
    if (req.url === "/v1/chat/completions") {
      const message = "Hello from the integration fixture.";
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (delta, finish_reason = null) =>
          "data: " +
          JSON.stringify({
            id: "chatcmpl-panel",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "panel-fixture",
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n";
        res.write(chunk({ role: "assistant", content: "Hello from " }));
        setTimeout(() => {
          res.write(chunk({ content: "the integration fixture." }));
          res.write(chunk({}, "stop"));
          res.end("data: [DONE]\n\n");
        }, 50);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          id: "chatcmpl-panel",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "panel-fixture",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: message },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 7, total_tokens: 11 },
        }),
      );
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

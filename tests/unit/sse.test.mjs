import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpSseTransform } from "../../apps/server/sse.mjs";
const config = {
  prefix: "/forge",
  upstream: new URL("http://backend:4444/internal"),
};
async function transform(chunks) {
  const stream = mcpSseTransform(config);
  const output = [];
  stream.on("data", (chunk) => output.push(chunk));
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await new Promise((resolve) => stream.on("end", resolve));
  return Buffer.concat(output).toString();
}
test("rewrites MCP endpoint announcements across split chunks and independent roots", async () => {
  const output = await transform([
    "event: end",
    "point\ndata: /internal/message?session_id=abc\n\n",
    'event: token\ndata: {"content":"/internal/unchanged"}\n\n',
  ]);
  assert.equal(
    output,
    'event: endpoint\ndata: /forge/message?session_id=abc\n\nevent: token\ndata: {"content":"/internal/unchanged"}\n\n',
  );
});
test("does not double-prefix endpoints or alter third-party announcements and multibyte data", async () => {
  const text =
    "event: endpoint\ndata: /forge/message\n\nevent: endpoint\ndata: https://other.example/message\n\nevent: token\ndata: 你好\n\n";
  const bytes = Buffer.from(text);
  assert.equal(
    await transform([...bytes].map((value) => Buffer.from([value]))),
    text,
  );
});

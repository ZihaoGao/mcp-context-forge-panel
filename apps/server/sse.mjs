import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

// Only MCP's legacy endpoint announcement contains a URL to translate.
// Token, tool and JSON-RPC events remain byte-for-byte unchanged.
export function mcpSseTransform(config) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  function rewrite(event) {
    if (!/^event:[ \t]*endpoint[ \t]*\r?$/m.test(event)) return event;
    return event.replace(
      /^data:[ \t]*(\S+)[ \t]*(\r?)$/m,
      (line, value, carriage) => {
        try {
          const endpoint = new URL(value, config.upstream);
          if (endpoint.origin !== config.upstream.origin) return line;
          const root = config.upstream.pathname.replace(/\/$/, "");
          let pathname = endpoint.pathname;
          if (
            config.prefix &&
            (pathname === config.prefix ||
              pathname.startsWith(config.prefix + "/"))
          )
            return line;
          if (root && (pathname === root || pathname.startsWith(root + "/")))
            pathname = pathname.slice(root.length);
          return `data: ${config.prefix}${pathname}${endpoint.search}${endpoint.hash}${carriage}`;
        } catch {
          return line;
        }
      },
    );
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const end = match.index + match[0].length;
        const event = pending.slice(0, end);
        pending = pending.slice(end);
        this.push(rewrite(event));
      }
      // Do not hold arbitrarily large events waiting for a separator.
      if (Buffer.byteLength(pending) > 65536) {
        this.push(pending);
        pending = "";
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (pending) this.push(pending);
      callback();
    },
  });
}

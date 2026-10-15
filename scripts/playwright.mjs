import { spawn } from "node:child_process";
import path from "node:path";
const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH || path.resolve(".cache/browsers"),
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));

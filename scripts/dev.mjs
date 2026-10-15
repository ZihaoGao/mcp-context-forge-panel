import { spawn } from "node:child_process";
const build = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--watch",
    "--config",
    "apps/web/vite.config.ts",
    "--configLoader",
    "runner",
  ],
  { stdio: "inherit" },
);
const server = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "--watch", "apps/server/index.mjs"],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    build.kill();
    server.kill();
  });

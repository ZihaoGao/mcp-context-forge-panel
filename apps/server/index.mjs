import { readConfig } from "./config.mjs";
import { createPanelServer } from "./server.mjs";
const config = readConfig();
const server = createPanelServer(config);
server.listen(config.port, config.host, () =>
  console.log(
    `ContextForge Panel: ${config.publicOrigin}${config.prefix}/app/`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));

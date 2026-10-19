import { readConfig } from "./config.mjs";
import { createPanelServer } from "./server.mjs";
import { createLogger, errorInfo } from "./logger.mjs";

try {
  const config = readConfig();
  const logger = createLogger({ level: config.logLevel });
  const server = createPanelServer(config, { logger });
  server.on("error", (error) => {
    logger.error("server.error", { error: errorInfo(error) });
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () =>
    logger.info("server.started", {
      host: config.host,
      port: server.address().port,
      public_url: `${config.publicOrigin}${config.prefix}/app/`,
      log_level: config.logLevel,
    }),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      logger.info("server.stopping", { signal });
      server.close(() => {
        logger.info("server.stopped");
        process.exit(0);
      });
    });
} catch (error) {
  createLogger({ level: "error" }).error("server.start_failed", {
    error: errorInfo(error),
  });
  process.exitCode = 1;
}

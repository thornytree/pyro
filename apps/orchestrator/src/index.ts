import { createApp } from "./app.ts";
import { loadEnvironment, readConfig } from "./config.ts";

try {
  loadEnvironment();
  const config = readConfig();
  const server = createApp(config).listen(config.port, config.host, () => {
    console.log(`Orchestrator listening on http://${config.host}:${config.port}`);
    console.log("Required source credentials are configured. Health: GET /health; data: GET /tiles?lat=34.05&long=-118.25");
  });
  server.on("error", error => {
    console.error(`Could not start orchestrator (${error.name}). Check HOST, PORT and whether the port is in use.`);
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Server initialization failed.");
  process.exitCode = 1;
}

const { startServer } = require("./src/app");

const server = startServer();

function shutdown(signal) {
  console.log(`${signal} received; finishing active requests before shutdown.`);
  server.close((error) => {
    if (error) {
      console.error(`Graceful shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

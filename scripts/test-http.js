const http = require("node:http");
const { randomInt } = require("node:crypto");

async function listenForTest(target = http.createServer()) {
  const server = typeof target === "function" ? http.createServer(target) : target;
  // Some hosts allocate ephemeral ports that fetch and browsers block (e.g. 2049).
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => { server.off("error", failed); server.off("listening", ready); };
        const failed = error => { cleanup(); reject(error); };
        const ready = () => { cleanup(); resolve(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(randomInt(32768, 65536), "127.0.0.1");
      });
      return server;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === 19) throw error;
    }
  }
}

module.exports = { listenForTest };

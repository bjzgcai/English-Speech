// Keep UI identity tests independent of the host's free-memory pressure.
// Resource-pressure behavior is covered separately in queue.test.js.
if (process.env.NODE_ENV !== "test") throw new Error("Browser fixture is test-only.");
require("node:os").freemem = () => 2 * 1024 ** 3;

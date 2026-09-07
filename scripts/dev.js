const { spawn } = require("node:child_process");
const children = ["server.js", "worker.js"].map(file => spawn(process.execPath, ["--watch", file], { stdio: "inherit", env: process.env }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", code => { if (!stopping && code) { process.exitCode = code; stop(); } });

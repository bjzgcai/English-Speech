const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const path = require("node:path");
test("real media traverses upload, durable queue, worker, ownership and history", { timeout: 60000 }, async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "../scripts/load-benchmark.js"), "--users=4", "--duration=2", "--timeout=45"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert.equal(code, 0, output);
});
for (const [name, flag] of [["guest media completes the full workflow without DingTalk configuration", "--guests"], ["downstream scoring failure retains the valid owned video", "--fail-scoring"], ["invalid media becomes a failed job without a playable recording", "--invalid-media"]]) {
  test(name, { timeout: 60000 }, async () => {
    const child = spawn(process.execPath, [path.join(__dirname, "../scripts/load-benchmark.js"), "--users=1", "--duration=2", "--timeout=45", flag], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    const code = await new Promise(resolve => child.on("exit", resolve));
    assert.equal(code, 0, output);
  });
}

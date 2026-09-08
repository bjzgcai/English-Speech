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
for (const [name, ...flags] of [
  ["the six-CPU profile processes a burst with configured worker and model limits", "--capacity-profile", "--users=8", "--model-delay=500"],
  ["guest media completes the full workflow without DingTalk configuration", "--guests"],
  ["downstream scoring failure retains the valid owned video", "--fail-scoring"],
  ["invalid media becomes a failed job without a playable recording", "--invalid-media"],
  ["browser WebM completes under two FFmpeg slots", "--webm", "--ffmpeg-concurrency=2"],
  ["silent recordings complete with zero and do not call ASR", "--silent"],
  ["standalone audio reweights visual delivery", "--audio-only", "--standalone"],
  ["answers reject missing camera tracks", "--audio-only"],
  ["answers reject missing microphone tracks", "--no-audio"],
  ["a failed question service still permits the saved owned fallback to be answered", "--fail-question"],
  ["a repeated model JSON response still completes a scored recording", "--repeat-json"],
  ["a killed worker recovers checkpoints and missing artifacts without losing the recording", "--restart-at=scoring", "--drop-artifacts", "--model-delay=500"],
]) {
  test(name, { timeout: 60000 }, async () => {
    const child = spawn(process.execPath, [path.join(__dirname, "../scripts/load-benchmark.js"), ...flags, "--users=1", "--duration=2", "--timeout=45"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    const code = await new Promise(resolve => child.on("exit", resolve));
    assert.equal(code, 0, output);
  });
}

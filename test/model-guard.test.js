const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Queue } = require("../src/queue");
const { ModelGuard, tokenReservation } = require("../src/model-guard");
const { modelFetch, setModelQueue } = require("../src/processing");

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-guard-"));
  const file = path.join(dir, "queue.sqlite");
  const queue = new Queue(file, { health: () => null });
  let now = 1000000;
  const guard = new ModelGuard(queue, { now: () => now });
  t.after(() => { queue.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { queue, guard, file, advance: ms => { now += ms; } };
}
test("internal concurrency is shared across ASR, question generation and connections", t => {
  const { queue, guard, file } = setup(t);
  const second = new Queue(file);
  t.after(() => second.close());
  const other = new ModelGuard(second, { now: () => 1000000 });
  assert.ok(guard.acquire("question", 1000, 45000).id);
  assert.ok(other.acquire("transcription", 0, 120000).id);
  assert.ok(other.acquire("transcription", 0, 120000).id);
  assert.equal(guard.acquire("question", 1000, 45000).reason, "concurrency");
  assert.equal(queue.get("SELECT count(*) AS n FROM model_requests").n, 3);
});
test("simultaneous processes cannot exceed the shared internal ceiling", async t => {
  const { file, queue } = setup(t);
  const children = Array.from({ length: 8 }, () => spawn(process.execPath, ["-e", `
    const { Queue } = require('./src/queue');
    const { ModelGuard } = require('./src/model-guard');
    const queue = new Queue(process.argv[1]);
    new ModelGuard(queue).acquire('question', 1000, 45000);
    queue.close();
  `, file], { cwd: path.resolve(__dirname, ".."), stdio: "ignore" }));
  const codes = await Promise.all(children.map(child => new Promise(resolve => child.on("exit", resolve))));
  assert.deepEqual(codes, Array(8).fill(0));
  assert.equal(queue.get("SELECT count(*) AS n FROM model_requests").n, 2);
});
test("rolling requests and conservative tokens survive restart and expire", t => {
  const { queue, guard, advance } = setup(t);
  for (let i = 0; i < 20; i++) {
    const permit = guard.acquire("question", 1000, 45000);
    assert.ok(permit.id);
    guard.finish(permit.id, { status: 200, tokens: 100 });
  }
  const restarted = new ModelGuard(queue, { now: () => 1000000 });
  assert.equal(restarted.acquire("question", 1000, 45000).reason, "quota");
  advance(60001);
  const large = guard.acquire("question", 119500, 45000);
  assert.ok(large.id);
  guard.finish(large.id, { status: 200 });
  assert.equal(guard.acquire("question", 1000, 45000).reason, "quota");
  advance(60001);
  assert.ok(guard.acquire("question", 1000, 45000).id);
  assert.throws(() => guard.acquire("question", 120001, 45000), /token budget/);
});
test("429 cooldown honors server delay, rejects stale success and allows one recovery probe", t => {
  const { queue, guard, advance } = setup(t);
  const first = guard.acquire("question", 1000, 45000);
  const stale = guard.acquire("question", 1000, 45000);
  guard.finish(first.id, { status: 429, retryMs: 90000 });
  guard.finish(stale.id, { status: 200 });
  assert.equal(Number(queue.setting("circuitUntil")), 1090000);
  assert.equal(guard.acquire("transcription", 0, 120000).waitMs, 90000);
  advance(90001);
  const probe = guard.acquire("question", 1000, 45000);
  assert.ok(probe.id);
  assert.equal(guard.acquire("transcription", 0, 120000).reason, "concurrency");
  guard.finish(probe.id, { status: 200, tokens: 1500 });
  assert.equal(Number(queue.setting("circuitUntil")), 0);
  assert.ok(guard.acquire("transcription", 0, 120000).id);
});
test("three network failures open a circuit; canceled calls and restart leases retain budget", t => {
  const { guard, advance } = setup(t);
  for (let i = 0; i < 3; i++) {
    const permit = guard.acquire("scoring", 1000, 1000);
    guard.finish(permit.id, { status: 0 });
  }
  assert.equal(guard.acquire("scoring", 1000, 1000).reason, "circuit");
  advance(60001);
  const lost = guard.acquire("scoring", 1000, 1000);
  assert.ok(lost.id);
  assert.equal(guard.acquire("scoring", 1000, 1000).reason, "concurrency");
  advance(6001);
  const replacement = guard.acquire("scoring", 1000, 1000);
  assert.ok(replacement.id);
  guard.finish(replacement.id, { canceled: true });
  assert.equal(guard.metrics().find(row => row.scope === "scoring").failures, 3);
  assert.ok(guard.metrics().find(row => row.scope === "scoring").tokens >= 2000);
});
test("question fetch persists throttling without a worker and fails fast after restart", async t => {
  const { queue } = setup(t);
  const original = global.fetch;
  t.after(() => { global.fetch = original; setModelQueue(null); });
  setModelQueue(queue);
  let calls = 0;
  global.fetch = async () => { calls++; return new Response("busy", { status: 429, headers: { "Retry-After": "90" } }); };
  const options = { body: JSON.stringify({ messages: [{ content: "A test question" }], max_tokens: 1024 }) };
  await assert.rejects(modelFetch("http://test", options, "question"), { code: "MODEL_BUSY" });
  setModelQueue(null);
  setModelQueue(queue);
  await assert.rejects(modelFetch("http://test", options, "question"), { code: "MODEL_BUSY" });
  assert.equal(calls, 1);
  assert.ok(Number(queue.setting("circuitUntil")) > Date.now() + 80000);
  assert.equal(queue.get("SELECT count(*) AS n FROM model_requests").n, 1);
});
test("token reservations cover UTF-8 text, output limits and image frames", () => {
  const options = { body: JSON.stringify({ max_tokens: 1024, messages: [{ content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,ignored" } }] }] }) };
  assert.equal(tokenReservation(options, "question"), 32 + 5 + 4096 + 1024);
  assert.equal(tokenReservation({}, "transcription"), 0);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Queue } = require("../src/queue");
const { context, modelFetch } = require("../src/processing");
function setup(t) {
  const queue = new Queue(":memory:", { health: () => null });
  const admission = queue.enter("owner"); const { grant } = queue.grant("owner"); queue.beginUpload("owner", grant);
  queue.accept(crypto.randomUUID(), "owner", admission.id, {});
  const task = { ...queue.claim(), queue, signal: new AbortController().signal };
  const original = global.fetch;
  t.after(() => { global.fetch = original; queue.close(); });
  return task;
}
test("upstream retries persist and successful responses are replayed from checkpoints", async t => {
  const task = setup(t);
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return calls === 1 ? new Response("temporarily busy", { status: 429, headers: { "Retry-After": "0" } }) : new Response(JSON.stringify({ text: "A completed transcript" }));
  };
  await context.run(task, async () => {
    assert.equal((await (await modelFetch("http://test", {}, "transcription", "chunk-1")).json()).text, "A completed transcript");
    assert.equal((await (await modelFetch("http://test", {}, "transcription", "chunk-1")).json()).text, "A completed transcript");
  });
  assert.equal(calls, 2);
  assert.equal(task.queue.get("SELECT count FROM attempts").count, 2);
  assert.ok(JSON.parse(task.queue.get("SELECT checkpoint FROM jobs").checkpoint).network["chunk-1"]);
});
test("retry exhaustion after restart does not issue an extra upstream request", async t => {
  const task = setup(t);
  task.queue.run("INSERT INTO attempts(job,key,count) VALUES(?,?,3)", task.id, "scoring");
  let calls = 0; global.fetch = async () => { calls++; return new Response("{}"); };
  await assert.rejects(context.run(task, () => modelFetch("http://test", {}, "scoring")), /retry limit/);
  assert.equal(calls, 0);
});
test("nontransient upstream validation failures are not retried", async t => {
  const task = setup(t);
  let calls = 0; global.fetch = async () => { calls++; return new Response("invalid", { status: 400 }); };
  const response = await context.run(task, () => modelFetch("http://test", {}, "transcription"));
  assert.equal(response.status, 400); assert.equal(calls, 1);
});

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const { Queue } = require("../src/queue");
const { Semaphore } = require("../src/processing");
function fixture(t, options = {}) {
  let time = 1000000;
  const q = new Queue(":memory:", { health: () => null, now: () => time, ...options });
  t.after(() => q.close());
  return { q, advance: ms => { time += ms; } };
}
function submit(q, owner) {
  const admission = q.enter(owner);
  const { grant } = q.grant(owner);
  q.beginUpload(owner, grant);
  const id = crypto.randomUUID();
  q.accept(id, owner, admission.id, { record: { id } });
  return id;
}
test("admits exactly 50 owners, preserves FIFO and deduplicates tabs", t => {
  const { q } = fixture(t);
  const rows = Array.from({ length: 100 }, (_, i) => q.enter(`owner-${i}`));
  assert.equal(rows.filter(r => r.state === "admitted").length, 50);
  assert.equal(rows[50].queuePosition, 1);
  assert.equal(q.enter("owner-0").id, rows[0].id);
  q.release("owner-0");
  assert.equal(q.admission("owner-50").state, "admitted");
  assert.equal(q.admission("owner-51").queuePosition, 1);
});
test("waiting room overflow is bounded, but existing owners can still heartbeat", t => {
  const { q } = fixture(t, { capacity: 1, waiting: 2 });
  q.enter("a"); q.enter("b"); q.enter("c");
  assert.throws(() => q.enter("d"), error => error.status === 429);
  assert.equal(q.enter("b").queuePosition, 1);
});
test("resource pressure suspends admission without blocking existing submissions", t => {
  let pressure = null;
  const { q } = fixture(t, { health: () => pressure });
  q.enter("a"); pressure = "Disk pressure";
  assert.equal(q.enter("b").state, "waiting");
  assert.ok(q.grant("a").grant);
});
test("only four upload grants exist and expired or foreign grants cannot upload", t => {
  const { q, advance } = fixture(t);
  for (let i = 0; i < 5; i++) q.enter(`u${i}`);
  const grants = Array.from({ length: 4 }, (_, i) => q.grant(`u${i}`).grant);
  assert.throws(() => q.grant("u4"), error => error.status === 429);
  assert.throws(() => q.beginUpload("u1", grants[0]), error => error.status === 409);
  q.beginUpload("u0", grants[0]); advance(31000);
  assert.throws(() => q.beginUpload("u1", grants[1]), error => error.status === 409);
  assert.ok(q.grant("u4").grant);
  assert.equal(q.get("SELECT uploading FROM admissions WHERE owner='u0'").uploading, 1);
});
test("abandoned reservations expire but accepted jobs survive browser absence", t => {
  const { q, advance } = fixture(t);
  q.enter("abandoned"); const id = submit(q, "accepted");
  advance(181000); q.transaction(() => q.sweep());
  assert.equal(q.admission("abandoned"), null);
  assert.equal(q.admission("accepted").state, "submitted");
  assert.equal(q.status(id, "accepted").state, "queued");
});
test("submission is idempotent and ownership is enforced", t => {
  const { q } = fixture(t);
  const id = submit(q, "a");
  assert.equal(q.accept(id, "a", "old", {}).id, id);
  assert.throws(() => q.accept(id, "b", "old", {}));
  assert.equal(q.status(id, "b"), null);
});
test("expired worker leases recover checkpoints and reject stale completions", t => {
  const { q, advance } = fixture(t);
  const id = submit(q, "a");
  const first = q.claim();
  q.checkpoint(id, first.token, { transcription: "saved transcript" });
  advance(31000);
  const second = q.claim();
  assert.equal(second.id, id);
  assert.equal(second.checkpoint.transcription, "saved transcript");
  assert.notEqual(second.token, first.token);
  assert.equal(q.finish(id, first.token, { evaluation: { status: "completed" } }), false);
  assert.equal(q.finish(id, second.token, { evaluation: { status: "completed" } }), true);
  assert.equal(q.admission("a"), null);
});

test("job claiming honors the configured pipeline capacity above four", t => {
  const previous = process.env.WORKER_CONCURRENCY;
  process.env.WORKER_CONCURRENCY = "8";
  t.after(() => { if (previous === undefined) delete process.env.WORKER_CONCURRENCY; else process.env.WORKER_CONCURRENCY = previous; });
  const { q } = fixture(t);
  for (let i = 0; i < 9; i++) submit(q, `claim-${i}`);
  for (let i = 0; i < 8; i++) assert.ok(q.claim(), `Pipeline ${i + 1} must be usable`);
  assert.equal(q.claim(), null);
});
test("cancellation tombstones prevent late acceptance and late worker results", t => {
  const { q } = fixture(t);
  const id = submit(q, "a"); const job = q.claim();
  assert.equal(q.cancel(id, "b"), false);
  assert.equal(q.cancel(id, "a"), true);
  assert.equal(q.finish(id, job.token, { evaluation: { status: "completed" } }), false);
  assert.throws(() => q.accept(id, "a", "old", {}));
  const early = crypto.randomUUID(); q.cancel(early, "a");
  assert.throws(() => q.accept(early, "a", "old", {}));
});
test("estimates need measurements, include queued work and react to retry delays", t => {
  const { q } = fixture(t);
  const first = submit(q, "a"); const second = submit(q, "b");
  assert.equal(q.status(first, "a").estimatedRemainingSeconds, null);
  for (const stage of ["normalized", "media", "transcription", "scoring"]) for (let i = 0; i < 3; i++) q.sample(stage, 10000);
  const before = q.status(first, "a").estimatedRemainingSeconds;
  assert.equal(before.low, 40);
  assert.ok(q.status(second, "b").estimatedRemainingSeconds.low > before.low);
  q.run("UPDATE jobs SET retry_at=? WHERE id=?", 1100000, first);
  assert.ok(q.status(first, "a").estimatedRemainingSeconds.low >= 140);
});
test("resource semaphore enforces concurrency and removes canceled waiters", async () => {
  const gate = new Semaphore(2);
  let active = 0; let peak = 0;
  await Promise.all(Array.from({ length: 50 }, () => gate.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
  })));
  assert.equal(peak, 2); assert.equal(gate.active, 0);
  const controller = new AbortController(); controller.abort(new Error("Canceled"));
  await assert.rejects(gate.run(async () => {}, controller.signal));
  assert.equal(gate.active, 0);
});

test("stage metrics separate pipeline versions and duration classes with nearest-rank percentiles", t => {
  const { q } = fixture(t);
  for (let i = 1; i <= 10; i++) q.sample("normalized", i * 100, "long");
  q.sample("normalized", 5000, "short");
  q.run("INSERT INTO samples(stage,category,duration,created) VALUES('normalized','long',90000,?)", q.now());
  const rows = q.metrics().stages;
  const current = rows.find(row => row.pipeline === "fused-v1" && row.category === "long");
  assert.equal(current.samples, 10);
  assert.equal(current.p50Ms, 500);
  assert.equal(current.p90Ms, 900);
  assert.equal(rows.find(row => row.pipeline === "legacy").p90Ms, 90000);
});

test("estimates follow the actual worker's FFmpeg capacity", t => {
  const { q } = fixture(t);
  const first = submit(q, "a");
  const second = submit(q, "b");
  for (const stage of ["normalized", "media", "transcription", "scoring"]) for (let i = 0; i < 3; i++) q.sample(stage, 10000);
  q.setting("workerResources", JSON.stringify({ ffmpeg: { limit: 1 } }));
  const serial = q.status(second, "b").estimatedRemainingSeconds.low;
  q.setting("workerResources", JSON.stringify({ ffmpeg: { limit: 2 } }));
  assert.ok(q.status(second, "b").estimatedRemainingSeconds.low < serial);
  assert.equal(q.status(first, "a").estimatedRemainingSeconds.low, 40);
});

test("estimates use reported model and pipeline limits above the old hardcoded capacity", t => {
  const { q } = fixture(t);
  const jobs = Array.from({ length: 8 }, (_, i) => submit(q, `capacity-${i}`));
  for (const stage of ["normalized", "media", "transcription", "scoring"]) for (let i = 0; i < 3; i++) q.sample(stage, stage === "scoring" ? 60000 : 1000);
  q.setting("workerResources", JSON.stringify({ ffmpeg: { limit: 3 }, scoring: { limit: 2 }, transcription: { limit: 3 }, pipelines: { limit: 4 } }));
  const old = q.status(jobs[7], "capacity-7").estimatedRemainingSeconds.low;
  q.setting("workerResources", JSON.stringify({ ffmpeg: { limit: 3 }, scoring: { limit: 4 }, transcription: { limit: 3 }, pipelines: { limit: 8 } }));
  assert.ok(q.status(jobs[7], "capacity-7").estimatedRemainingSeconds.low < old);
});

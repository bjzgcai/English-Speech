const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AlertStore, applySample, rulesFor, readMonitorStatus, GiB, MiB } = require("../src/monitoring");
const { DingSender, deliverPending } = require("../src/ding-alerts");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-monitor-"));
  const file = path.join(dir, "alerts.sqlite");
  const store = new AlertStore(file);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, file };
}
function healthy(at = 1000000) {
  return { at, disks: [{ device: "1", data: true, paths: ["/data", "/backups"], available: 64 * GiB, usedPercent: 31 }],
    memoryAvailable: 2 * GiB, cpuPercent: 15, services: [{ name: "englisheval", active: true, memoryCurrent: 100 * MiB, memoryMax: 512 * MiB, oom: false }],
    health: { ok: true, latencyMs: 30 }, errors: [], queue: { reservedBytes: 25 * GiB, outstanding: 50, waiting: 0, workerHeartbeat: at, circuitUntil: 0, paused: false } };
}
const events = store => store.db.prepare("SELECT * FROM events ORDER BY created,rowid").all();
function samples(store, from, to, mutate = () => {}) {
  for (let at = from; at <= to; at += 30000) { const sample = healthy(at); mutate(sample); applySample(store, sample); }
}

test("50 admitted users alone produce no alert; disk reservations and backup thresholds apply", t => {
  const { store } = fixture(t);
  samples(store, 1000000, 1600000);
  assert.equal(events(store).length, 0);
  const sample = healthy(); sample.disks[0].available = 35 * GiB - 1;
  assert.equal(rulesFor(sample, false).find(rule => rule.key === "disk:1").warn, true);
  sample.disks[0].available = 30 * GiB;
  assert.equal(rulesFor(sample, false).find(rule => rule.key === "disk:1").critical, true);
  sample.disks[0].data = false;
  assert.equal(rulesFor(sample, false).find(rule => rule.key === "disk:1").critical, false);
});
test("sustained warning, escalation and recovery notify exactly once with hysteresis", t => {
  const { store, file } = fixture(t);
  samples(store, 1000000, 1120000, s => { s.memoryAvailable = 700 * MiB; });
  assert.deepEqual(events(store).map(e => e.level), [1]);
  samples(store, 1150000, 1210000, s => { s.memoryAvailable = 400 * MiB; });
  assert.deepEqual(events(store).map(e => e.level), [1, 2]);
  samples(store, 1240000, 1450000, s => { s.memoryAvailable = 900 * MiB; });
  assert.equal(events(store).length, 2);
  samples(store, 1480000, 1720000);
  assert.deepEqual(events(store).map(e => e.level), [1, 2, 0]);
  assert.equal(readMonitorStatus(file, 1720000).alerts.length, 0);
});
test("critical-only service and queue read failures wait sixty seconds without premature warning", t => {
  const { store } = fixture(t);
  const bad = s => { s.services[0].active = false; s.queue = null; };
  samples(store, 1000000, 1030000, bad);
  assert.equal(events(store).length, 0);
  samples(store, 1060000, 1060000, bad);
  assert.deepEqual(events(store).map(e => e.key).sort(), ["queue-read", "service:englisheval"]);
  assert.ok(events(store).every(e => e.level === 2));
});
test("maintenance suppresses service failures but not host pressure and expires", t => {
  const { store } = fixture(t); store.set("maintenanceUntil", 1100000);
  const bad = s => { s.services[0].active = false; s.memoryAvailable = 400 * MiB; };
  samples(store, 1000000, 1090000, bad);
  assert.deepEqual(events(store).map(e => e.key), ["memory"]);
  samples(store, 1120000, 1180000, bad);
  assert.ok(events(store).some(e => e.key === "service:englisheval"));
});
test("lost samples do not imply recovery; restart preserves incidents and marks in-flight sends unknown", t => {
  const { store, file } = fixture(t);
  samples(store, 1000000, 1060000, s => { s.memoryAvailable = 400 * MiB; });
  store.db.prepare("UPDATE events SET status='sending'").run();
  const restarted = new AlertStore(file); restarted.recoverDelivery();
  try {
    samples(restarted, 1300000, 1300000);
    assert.equal(readMonitorStatus(file, 1300000).alerts.find(a => a.key === "memory").level, 2);
    assert.ok(events(restarted).some(e => e.key === "monitor-gap"));
    assert.equal(events(restarted)[0].status, "unknown");
    samples(restarted, 1330000, 1480000);
    assert.equal(events(restarted).filter(e => e.key === "memory" && e.level === 0).length, 1);
  } finally { restarted.close(); }
});
test("CPU saturation waits five minutes and requires a slow health response for escalation", t => {
  const { store } = fixture(t);
  samples(store, 1000000, 1300000, s => { s.cpuPercent = 99; });
  assert.deepEqual(events(store).map(e => e.level), [1]);
  samples(store, 1330000, 1630000, s => { s.cpuPercent = 99; s.health.latencyMs = 1500; });
  assert.deepEqual(events(store).map(e => e.level), [1, 2]);
});
test("waiting room and upstream sustained limits; OOM alerts immediately", t => {
  const { store } = fixture(t);
  samples(store, 1000000, 1120000, s => { s.queue.waiting = 160; s.queue.circuitUntil = s.at + 10000; });
  assert.deepEqual(events(store).map(e => e.key).sort(), ["upstream", "waiting-room"]);
  samples(store, 1150000, 1180000, s => { s.queue.waiting = 200; });
  const sample = healthy(1210000); sample.services[0].oom = true; applySample(store, sample);
  assert.ok(events(store).some(e => e.key === "waiting-room" && e.level === 2));
  assert.ok(events(store).some(e => e.key === "service-memory:englisheval" && e.level === 2));
});
test("unavailable metrics freeze incident recovery", t => {
  const { store, file } = fixture(t);
  samples(store, 1000000, 1060000, s => { s.memoryAvailable = 400 * MiB; });
  samples(store, 1090000, 1450000, s => { s.memoryAvailable = null; s.errors = ["host_resources_unreadable"]; });
  assert.equal(readMonitorStatus(file, 1450000).alerts.find(a => a.key === "memory").level, 2);
});

function senderWith(responses, calls = []) {
  return new DingSender({ clientId: "test-app", clientSecret: "synthetic-secret", robotCode: "test-robot", userId: "synthetic-owner",
    now: () => 1000000, fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); const response = responses.shift(); if (response instanceof Error) throw response; return response; } });
}
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const token = () => response({ accessToken: "synthetic-token", expireIn: 7200 });
test("DING uses application credentials, exact recipient and app channel; token is cached", async () => {
  const calls = []; const sender = senderWith([token(), response({ openDingId: "ding-1" }), response({ openDingId: "ding-2" })], calls);
  assert.equal((await sender.send("synthetic alert")).status, "sent");
  assert.equal((await sender.send("synthetic recovery")).status, "sent");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].body.receiverUserIdList, ["synthetic-owner"]);
  assert.equal(calls[1].body.remindType, 1);
});
for (const [name, value, expected] of [
  ["throttling", response({ code: "toomuch.msg" }, 429, { "Retry-After": "120" }), "retry"],
  ["permissions", response({ code: "Forbidden.AccessDenied.AccessTokenPermissionDenied" }, 403), "failed"],
  ["quota", response({ code: "ding.serverquota.insufficient" }, 400), "failed"],
  ["timeout", new Error("synthetic timeout"), "unknown"],
  ["server failure", response({ code: "system.error" }, 500), "unknown"],
  ["missing receipt", response({}), "unknown"],
  ["recipient failure", response({ openDingId: "ding-3", failedList: { invalid: ["synthetic-owner"] } }), "failed"],
]) test(`DING ${name} is recorded accurately`, async () => {
  const result = await senderWith([token(), value]).send("synthetic alert");
  assert.equal(result.status, expected);
  if (name === "throttling") assert.equal(result.retryMs, 120000);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-token/);
});
test("persisted retries honor server delays, cap at three, and unknown sends are not retried", async t => {
  const { store } = fixture(t);
  samples(store, 1000000, 1030000, s => { s.memoryAvailable = 400 * MiB; });
  let time = 1030000; let count = 0;
  const sender = { send: async () => { count++; return { status: "retry", retryMs: 120000 }; } };
  await deliverPending(store, sender, () => time, () => 0);
  await deliverPending(store, sender, () => time, () => 0);
  assert.equal(count, 1);
  time += 120000; await deliverPending(store, sender, () => time, () => 0);
  time += 120000; await deliverPending(store, sender, () => time, () => 0);
  assert.equal(events(store)[0].status, "failed"); assert.equal(count, 3);
  store.db.prepare("UPDATE events SET status='unknown'").run();
  time += 120000; await deliverPending(store, sender, () => time, () => 0);
  assert.equal(count, 3);
});

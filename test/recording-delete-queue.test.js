// Deleting a recording must also cancel a still-pending queue job for the same
// submission: otherwise the projection re-appends the record the owner just
// deleted (the 2026-10-12 徐林凯 resurrection incident). Terminal jobs must be
// left untouched.
const { listenForTest } = require("../scripts/test-http");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-delete-queue-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATA_DIR: dataDir, SESSION_SECRET: "delete-queue-test-secret",
  DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", DINGTALK_CORP_ID: "",
  COOKIE_SECURE: "false", QUEUE_ENABLED: "true", PARTNER_API_KEY: "delete-queue-test-partner",
});
const { app } = require("../src/app");
const config = require("../src/config");
const { Queue } = require("../src/queue");
const { appendJsonLine } = require("../src/storage");

let server;
let base;
let owner;
const queue = new Queue(config.queueFile);

test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;

  // A guest session owns the seeded answers.
  const code = crypto.randomUUID().toUpperCase();
  appendJsonLine(config.invitationsMetadataFile, {
    id: uuid(),
    hash: crypto.createHash("sha256").update(code).digest("hex"),
  });
  const redeem = await fetch(base + "/api/invitation/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "Delete Queue Tester" }),
  });
  assert.equal(redeem.status, 200);
  const cookie = redeem.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const me = await fetch(base + "/api/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  owner = { cookie, openId: (await me.json()).user.openId };
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  queue.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function uuid() {
  return crypto.randomUUID();
}

function authHeaders() {
  return { Cookie: owner.cookie, "X-Expected-Owner": owner.openId };
}

function seedRecord(id) {
  appendJsonLine(config.metadataFile, {
    id,
    submissionId: id,
    hasVideo: false,
    filename: null,
    bytes: 0,
    startedAt: "2026-10-12T10:00:00.000Z",
    finishedAt: "2026-10-12T10:01:00.000Z",
    openId: owner.openId,
    user: { openId: owner.openId, name: "Delete Queue Tester" },
    profile: { name: "Delete Queue Tester", role: "student" },
    question: { question: "Describe your favourite city.", focus: "fluency", expectedDurationSeconds: 60 },
    evaluation: { status: "completed", overallScore: 80, rubric: {}, summary: "ok" },
  });
}

function seedJob(id, state) {
  queue.run(
    "INSERT INTO jobs(id,owner,admission,state,created,updated,payload) VALUES(?,?,?,?,?,?,?)",
    id, owner.openId, uuid(), state, Date.now(), Date.now(),
    JSON.stringify({ inputPath: null, record: { id, filename: null } }),
  );
}

function jobState(id) {
  return queue.get("SELECT state FROM jobs WHERE id=?", id)?.state;
}

test("deleting a recording cancels a queued job for the same submission", async () => {
  const id = uuid();
  seedRecord(id);
  seedJob(id, "queued");

  const removed = await fetch(base + `/api/recordings/${id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(removed.status, 200);
  const data = await removed.json();
  assert.equal(data.ok, true);
  assert.equal(data.removedRecordCount, 1);
  assert.equal(data.canceledJob, true);
  assert.equal(jobState(id), "canceled");
});

test("deleting a recording cancels a failed job so its result cannot be re-projected", async () => {
  const id = uuid();
  seedRecord(id);
  seedJob(id, "failed");

  const removed = await fetch(base + `/api/recordings/${id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).canceledJob, true);
  assert.equal(jobState(id), "canceled");
});

test("deleting a recording leaves a completed job untouched", async () => {
  const id = uuid();
  seedRecord(id);
  seedJob(id, "completed");

  const removed = await fetch(base + `/api/recordings/${id}`, { method: "DELETE", headers: authHeaders() });
  assert.equal(removed.status, 200);
  const data = await removed.json();
  assert.equal(data.removedRecordCount, 1);
  assert.equal(data.canceledJob, false);
  assert.equal(jobState(id), "completed");
});

const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-review-"));
Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: data, QUEUE_ENABLED: "true",
  SESSION_SECRET: "review-test-session", DINGTALK_APP_KEY: "test", DINGTALK_APP_SECRET: "test",
  DINGTALK_CORP_ID: "test", DINGTALK_ALERT_ROBOT_CODE: "", DINGTALK_ALERT_USER_ID: "" });
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine, readJsonLines } = require("../src/storage");
const { Queue } = require("../src/queue");
const processing = require("../src/processing");
const queue = new Queue(config.queueFile, { health: () => null });
let server, base;
test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  queue.close();
  fs.rmSync(data, { recursive: true, force: true });
});
function call(owner, route, body, extra = {}) {
  return fetch(base + route, { method: body === undefined ? "GET" : "POST",
    headers: { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: owner, name: "Synthetic member" })}`,
      "X-Expected-Owner": owner, "Content-Type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function prepare(owner) {
  await call(owner, "/api/privacy-consent", { privacyAgreed: true, sensitiveInfoAgreed: true });
  queue.enter(owner);
  const questionId = crypto.randomUUID();
  appendJsonLine(config.questionsMetadataFile, { id: questionId, openId: owner, profile: {}, question: { question: "A test question" } });
  return { "X-Submission-Id": crypto.randomUUID(), "X-Question-Id": questionId, "X-Upload-Grant": queue.grant(owner).grant };
}

test("queued uploads enforce attempt and video quotas before accepting media", async () => {
  for (const [route, count, code] of [["/api/save-answer", 100, "ATTEMPT_QUOTA_EXCEEDED"], ["/api/evaluate-video", 10, "VIDEO_QUOTA_EXCEEDED"]]) {
    const owner = crypto.randomUUID();
    const headers = await prepare(owner);
    for (let i = 0; i < count; i++) appendJsonLine(config.metadataFile, { id: crypto.randomUUID(), openId: owner, questionId: route.endsWith("save-answer") ? "test" : null, hasVideo: true });
    const response = await call(owner, route, {}, headers);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, code);
    assert.equal(queue.get("SELECT uploading FROM admissions WHERE owner=?", owner).uploading, 0);
  }
});

test("quotas include terminal queue results before history projection, without double counting", async () => {
  const owner = crypto.randomUUID();
  const headers = await prepare(owner);
  for (let i = 0; i < 9; i++) appendJsonLine(config.metadataFile, { id: crypto.randomUUID(), openId: owner, hasVideo: true });
  const id = crypto.randomUUID();
  const record = { id, openId: owner, hasVideo: true, evaluation: { status: "completed" } };
  queue.run("INSERT INTO jobs(id,owner,admission,state,created,updated,payload,result) VALUES(?,?,?,'completed',?,?,?,?)",
    id, owner, "previous", Date.now(), Date.now(), JSON.stringify({ record }), JSON.stringify(record));
  const response = await call(owner, "/api/evaluate-video", {}, headers);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).quota.videos, 10);
  appendJsonLine(config.metadataFile, record);
  const projected = await call(owner, "/api/evaluate-video", {}, headers);
  assert.equal((await projected.json()).quota.videos, 10);
  const replay = await call(owner, "/api/evaluate-video", {}, { "X-Submission-Id": id });
  assert.equal(replay.status, 200, "An accepted submission stays idempotent after reaching the quota");
});

test("comment moderation uses a guarded model kind and hides the original blocked version", async t => {
  let kind;
  t.mock.method(processing, "modelFetch", async (_url, _options, requestKind) => {
    kind = requestKind;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"blocked":true}' } }] }));
  });
  const response = await call("comment-owner", "/api/comments", { page: "prepare", content: "Synthetic moderation fixture" });
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  for (let i = 0; i < 20 && !readJsonLines(config.commentsMetadataFile).some(row => row.id === comment.id && row.moderationStatus === "blocked"); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(kind, "question");
  const publicComments = await (await fetch(base + "/api/comments?page=prepare")).json();
  assert.equal(publicComments.comments.some(row => row.id === comment.id), false);
});

test("in-app and existing signed sessions can manage their own invitations", async () => {
  const response = await call("legacy-signed-owner", "/api/invitation-codes", {});
  assert.equal(response.status, 201);
  const { record } = await response.json();
  const own = await (await call("legacy-signed-owner", "/api/invitation-codes")).json();
  assert.ok(own.codes.some(row => row.id === record.id));
  const other = await (await call("other-signed-owner", "/api/invitation-codes")).json();
  assert.ok(other.codes.every(row => row.id !== record.id));
});

test("standalone videos and posters remain private unless the member explicitly shares", async () => {
  const id = crypto.randomUUID();
  const record = { id, openId: "private-member", sourceType: "upload", filename: `${id}.mp4`, finishedAt: new Date().toISOString(), evaluation: { status: "completed", rubric: {} } };
  fs.writeFileSync(path.join(config.recordingsDir, record.filename), Buffer.alloc(16));
  fs.mkdirSync(path.join(config.artifactsDir, id, "frames"), { recursive: true });
  fs.writeFileSync(path.join(config.artifactsDir, id, "frames", "frame-001.jpg"), Buffer.alloc(16));
  appendJsonLine(config.metadataFile, record);
  const gallery = await (await fetch(base + "/api/public-evaluations")).json();
  assert.ok(gallery.evaluations.every(row => row.id !== id));
  for (const asset of ["video", "poster"]) assert.equal((await fetch(`${base}/api/public-evaluations/${id}/${asset}`)).status, 404);
  assert.equal((await call("private-member", `/api/recordings/${id}/video`)).status, 200);
  assert.ok(testHelpers.publicEvaluationForClient({ ...record, publiclyShared: true }));
  assert.equal(testHelpers.publicEvaluationForClient({ ...record, publiclyShared: true, openId: `guest:${crypto.randomUUID()}` }), null);
});

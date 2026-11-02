const { listenForTest } = require("../scripts/test-http");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-camera-required-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATA_DIR: dataDir,
  SESSION_SECRET: "camera-required-test-secret",
  DINGTALK_CLIENT_ID: "",
  DINGTALK_CLIENT_SECRET: "",
  DINGTALK_CORP_ID: "",
  COOKIE_SECURE: "false",
  QUEUE_ENABLED: "false",
  INTERNAL_LLM_API_KEY: "",
});
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine, readJsonLines } = require("../src/storage");
const { runMedia } = require("../src/processing");

let server;
let base;
let fixture;

test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
  fixture = path.join(dataDir, "audio-only.mp4");
  await runMedia([
    "-v", "error",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:a", "aac", "-t", "1",
    fixture,
  ]);
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function ownerHeaders(owner) {
  return {
    Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: owner, name: "Camera rule member" })}`,
    "X-Expected-Owner": owner,
  };
}

async function prepare(owner, question) {
  const headers = ownerHeaders(owner);
  const consent = await fetch(base + "/api/privacy-consent", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
  });
  assert.equal(consent.status, 201);
  const questionId = crypto.randomUUID();
  appendJsonLine(config.questionsMetadataFile, {
    id: questionId,
    openId: owner,
    profile: { name: "Camera rule member" },
    question,
  });
  return { headers, questionId, submissionId: crypto.randomUUID() };
}

async function upload(prepared) {
  const body = new FormData();
  body.append("video", await fs.openAsBlob(fixture, { type: "video/mp4" }), "answer.mp4");
  body.append("questionId", prepared.questionId);
  body.append("submissionId", prepared.submissionId);
  return fetch(base + "/api/save-answer", {
    method: "POST",
    headers: prepared.headers,
    body,
  });
}

test("synchronous game saves reject audio-only answers for groups 1 and 2", async () => {
  for (const [group, question] of [
    ["g1", { question: "Group 1 answer", challengeId: "weekly-2026-11-02", requiresCamera: true }],
    ["g2 legacy", { question: "Group 2 answer", challengeId: "weekly-2026-09-28-g2" }],
  ]) {
    const owner = `camera-${group.replace(/\W/g, "-")}-${crypto.randomUUID()}`;
    const prepared = await prepare(owner, question);
    const response = await upload(prepared);
    assert.equal(response.status, 400, group);
    assert.deepEqual(await response.json(), {
      error: "Camera video is required for Group 1 and Group 2 weekly tasks.",
      code: "CAMERA_REQUIRED",
    });
    assert.equal(readJsonLines(config.metadataFile).some(record => record.id === prepared.submissionId), false);
  }
});

test("synchronous game saves still accept audio-only group 3 answers", async () => {
  const owner = `camera-g3-${crypto.randomUUID()}`;
  const prepared = await prepare(owner, {
    question: "Group 3 answer",
    challengeId: "weekly-2026-11-02-g3",
    requiresCamera: false,
  });
  const response = await upload(prepared);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, prepared.submissionId);
  assert.equal(readJsonLines(config.metadataFile).some(record => record.id === prepared.submissionId), true);
});

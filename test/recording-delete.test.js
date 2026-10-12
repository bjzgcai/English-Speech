const { listenForTest } = require("../scripts/test-http");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-delete-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATA_DIR: dataDir, SESSION_SECRET: "delete-test-secret",
  DINGTALK_CLIENT_ID: "", DINGTALK_CLIENT_SECRET: "", DINGTALK_CORP_ID: "",
  COOKIE_SECURE: "false", QUEUE_ENABLED: "false", PARTNER_API_KEY: "delete-test-partner",
});
const { app } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine } = require("../src/storage");

let server;
let base;
let currentChallengeId = null;
let inviter;

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
    body: JSON.stringify({ code, name: "Delete Tester" }),
  });
  assert.equal(redeem.status, 200);
  const cookie = redeem.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const me = await fetch(base + "/api/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  const meData = await me.json();
  inviter = { cookie, openId: meData.user.openId };

  const board = await leaderboardScores(inviter);
  currentChallengeId = board.challenge.id;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function uuid() {
  return crypto.randomUUID();
}

// Seeds a completed game answer owned by the given openId.
function seedCompletedAnswer({ openId, score, finishedAt, figureExtension = null }) {
  const id = uuid();
  const record = {
    id,
    submissionId: null,
    hasVideo: false,
    filename: null,
    bytes: 0,
    startedAt: finishedAt,
    finishedAt,
    openId,
    user: { openId, name: "Delete Tester" },
    profile: { name: "Delete Tester", role: "student" },
    question: {
      question: "Describe your favourite city.",
      focus: "fluency",
      expectedDurationSeconds: 60,
      challengeId: currentChallengeId,
      figure: figureExtension
        ? { src: `/api/user-figures/${id}.${figureExtension}`, alt: "task figure", caption: "" }
        : null,
    },
    evaluation: {
      status: "completed",
      overallScore: score,
      rubric: {},
      summary: "ok",
    },
  };
  appendJsonLine(config.metadataFile, record);
  if (figureExtension) {
    fs.mkdirSync(config.userFiguresDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(config.userFiguresDir, `${id}.${figureExtension}`), "png");
  }
  return id;
}

function authHeaders(person, extra = {}) {
  return {
    Cookie: person.cookie,
    "X-Expected-Owner": person.openId,
    ...extra,
  };
}

async function leaderboardScores(person) {
  const response = await fetch(base + "/api/game/leaderboard", { headers: authHeaders(person) });
  assert.equal(response.status, 200);
  return response.json();
}

test("deleting the best answer makes the leaderboard fall back to the remaining highest score", async () => {
  const bestId = seedCompletedAnswer({ openId: inviter.openId, score: 92, finishedAt: "2026-10-05T10:00:00.000Z" });
  seedCompletedAnswer({ openId: inviter.openId, score: 88, finishedAt: "2026-10-06T10:00:00.000Z" });

  let history = await (await fetch(base + "/api/recordings", { headers: authHeaders(inviter) })).json();
  assert.equal(history.recordings.length, 2);

  let board = await leaderboardScores(inviter);
  assert.ok(board.entries.some((entry) => entry.score === 92), "best score 92 should be ranked");
  assert.ok(!board.entries.some((entry) => entry.score === 88), "lower score should not be ranked yet");

  const removed = await fetch(base + `/api/recordings/${bestId}`, {
    method: "DELETE",
    headers: authHeaders(inviter),
  });
  assert.equal(removed.status, 200);
  const removedData = await removed.json();
  assert.equal(removedData.ok, true);
  assert.equal(removedData.removedRecordCount, 1);

  history = await (await fetch(base + "/api/recordings", { headers: authHeaders(inviter) })).json();
  assert.equal(history.recordings.length, 1);
  assert.notEqual(history.recordings[0].id, bestId);

  board = await leaderboardScores(inviter);
  assert.ok(board.entries.some((entry) => entry.score === 88), "remaining 88 should now be ranked");
  assert.ok(!board.entries.some((entry) => entry.score === 92), "deleted 92 must disappear from the leaderboard");
});

test("delete rejects missing, foreign, and already-removed recordings", async () => {
  const foreignId = seedCompletedAnswer({ openId: "guest:not-the-inviter", score: 70, finishedAt: "2026-10-07T10:00:00.000Z" });

  const missing = await fetch(base + `/api/recordings/${uuid()}`, {
    method: "DELETE",
    headers: authHeaders(inviter),
  });
  assert.equal(missing.status, 404);

  const foreign = await fetch(base + `/api/recordings/${foreignId}`, {
    method: "DELETE",
    headers: authHeaders(inviter),
  });
  assert.equal(foreign.status, 404);

  const malformed = await fetch(base + "/api/recordings/not-a-uuid", {
    method: "DELETE",
    headers: authHeaders(inviter),
  });
  assert.equal(malformed.status, 400);
});

test("deleting an answer also removes its learner figure file", async () => {
  const withFigure = seedCompletedAnswer({
    openId: inviter.openId,
    score: 75,
    finishedAt: "2026-10-08T10:00:00.000Z",
    figureExtension: "png",
  });
  const figurePath = path.join(config.userFiguresDir, `${withFigure}.png`);
  assert.ok(fs.existsSync(figurePath));

  const removed = await fetch(base + `/api/recordings/${withFigure}`, {
    method: "DELETE",
    headers: authHeaders(inviter),
  });
  assert.equal(removed.status, 200);
  assert.ok(!fs.existsSync(figurePath), "figure file should be removed with the record");
});

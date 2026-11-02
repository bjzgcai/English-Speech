// 张鳐 joined the course late and still has to answer group 2's lesson 1, which
// the normal /game page cannot produce because it always serves the current
// week. These tests pin the private make-up page to that one challenge, prove
// the gate (openId allow-list with a transitional name fallback), and prove the
// resulting answer lands on the group 2 lesson 1 board.
const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-catchup-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATA_DIR: data,
  QUEUE_ENABLED: "false",
  SESSION_SECRET: "catchup-test-session",
  DINGTALK_CLIENT_ID: "test",
  DINGTALK_CLIENT_SECRET: "test",
  DINGTALK_CORP_ID: "test",
});
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine, readJsonLines } = require("../src/storage");
const game = require("../src/game");

const PINNED_ID = "weekly-2026-09-28-g2";
const LEARNER_NAME = "张鳐";
// 吴衍标 plays the same make-up lesson, so the page answers to both names.
const SECOND_LEARNER_NAME = "吴衍标";

let server;
let base;
test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(data, { recursive: true, force: true });
});

function sessionHeaders(name, openId = crypto.randomUUID()) {
  return { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId, name })}` };
}

// requireVisitor makes every mutation carry the caller's own identity.
function mutationHeaders(name, openId) {
  return { ...sessionHeaders(name, openId), "X-Expected-Owner": openId, "Content-Type": "application/json" };
}

function seedAnswer(openId, name, score, challengeId) {
  const record = {
    id: crypto.randomUUID(),
    openId,
    user: { openId, name, identityType: "dingtalk" },
    filename: "answer.mp4",
    finishedAt: "2026-09-30T09:00:00.000Z",
    question: { challengeId, question: "Explain the figure." },
    evaluation: { status: "completed", overallScore: score },
  };
  appendJsonLine(config.metadataFile, record);
  fs.writeFileSync(path.join(config.recordingsDir, record.filename), "video");
  return record;
}

test("the pinned make-up challenge is group 2's lesson 1", () => {
  const pinned = testHelpers.catchupChallenge;
  assert.equal(pinned.id, PINNED_ID);
  assert.equal(pinned.group, "g2");
  assert.equal(pinned.requiresCamera, true);
  assert.equal(pinned.lessonNumber, 1);
  assert.equal(pinned.title, "Explaining an experimental figure");
  assert.equal(game.matchesChallengeId(pinned, PINNED_ID), true);
});

test("the make-up page is served to anonymous and assigned visitors, and redirects everyone else", async () => {
  // The link is shared directly, so an anonymous visitor gets the app shell: the
  // browser then opens the sign-in modal over a blank page instead of bouncing to
  // the board (which read as a broken link). The lesson itself is painted only
  // once /api/me reports the make-up flag.
  const anonymous = await fetch(`${base}/game/first-lesson?group=g2`, { redirect: "manual" });
  assert.equal(anonymous.status, 200);
  assert.match(anonymous.headers.get("content-type") || "", /text\/html/);
  assert.match(await anonymous.text(), /id="gameTopicTitle"/);

  const other = await fetch(`${base}/game/first-lesson`, {
    headers: sessionHeaders("陈云"),
    redirect: "manual",
  });
  assert.equal(other.status, 302);
  assert.equal(other.headers.get("location"), "/leaderboard");

  const assigned = await fetch(`${base}/game/first-lesson`, {
    headers: sessionHeaders(LEARNER_NAME),
    redirect: "manual",
  });
  assert.equal(assigned.status, 200);

  const second = await fetch(`${base}/game/first-lesson`, {
    headers: sessionHeaders(SECOND_LEARNER_NAME),
    redirect: "manual",
  });
  assert.equal(second.status, 200, "the second assigned learner is served the page");
});

test("the second assigned learner can play the pinned week", async () => {
  const learner = crypto.randomUUID();
  await fetch(`${base}/api/privacy-consent`, {
    method: "POST",
    headers: mutationHeaders(SECOND_LEARNER_NAME, learner),
    body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
  });

  const catalog = await fetch(`${base}/api/game/challenge?group=g2&challengeId=${PINNED_ID}`, {
    headers: sessionHeaders(SECOND_LEARNER_NAME, learner),
  });
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).challenge.id, PINNED_ID);

  const created = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders(SECOND_LEARNER_NAME, learner),
    body: JSON.stringify({ group: "g2", challengeId: PINNED_ID }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.question.challengeId, PINNED_ID);
  assert.equal(body.question.requiresCamera, true);

  const me = await (await fetch(`${base}/api/me`, {
    headers: sessionHeaders(SECOND_LEARNER_NAME, learner),
  })).json();
  assert.equal(me.catchupAccess, true);
});

test("the pinned challenge catalog is gated and cannot be pointed at another week", async () => {
  const pinnedQuery = `group=g2&challengeId=${PINNED_ID}`;
  assert.equal((await fetch(`${base}/api/game/challenge?${pinnedQuery}`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/game/challenge?${pinnedQuery}`, { headers: sessionHeaders("陈云") })).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/game/challenge?group=g2&challengeId=weekly-2026-10-13-g2`, {
      headers: sessionHeaders(LEARNER_NAME),
    })).status,
    400,
  );

  const allowed = await fetch(`${base}/api/game/challenge?${pinnedQuery}`, {
    headers: sessionHeaders(LEARNER_NAME),
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.challenge.id, PINNED_ID);
  assert.equal(payload.group, "g2");
  assert.equal(payload.challenge.requiresCamera, true);
  assert.deepEqual(payload.challenges.map((challenge) => challenge.id), [PINNED_ID]);

  // Without a pinned id the endpoint still serves the ordinary current week.
  const current = await (await fetch(`${base}/api/game/challenge?group=g2`, {
    headers: sessionHeaders(LEARNER_NAME),
  })).json();
  assert.equal(current.challenge.id, game.currentChallenge(new Date(), "g2").id);
});

test("only the assigned learner can generate a question for the past week", async () => {
  const opponent = crypto.randomUUID();
  const denied = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders("陈云", opponent),
    body: JSON.stringify({ group: "g2", challengeId: PINNED_ID }),
  });
  assert.equal(denied.status, 403);
  assert.equal(readJsonLines(config.questionsMetadataFile).filter((q) => q.openId === opponent).length, 0);

  const learner = crypto.randomUUID();
  await fetch(`${base}/api/privacy-consent`, {
    method: "POST",
    headers: mutationHeaders(LEARNER_NAME, learner),
    body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
  });

  const wrongWeek = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders(LEARNER_NAME, learner),
    body: JSON.stringify({ group: "g2", challengeId: "weekly-2026-10-13-g2" }),
  });
  assert.equal(wrongWeek.status, 400);

  const created = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders(LEARNER_NAME, learner),
    body: JSON.stringify({ group: "g2", challengeId: PINNED_ID }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.challenge.id, PINNED_ID);
  assert.equal(body.challenge.lessonNumber, 1);
  assert.equal(body.question.challengeId, PINNED_ID);
  assert.equal(body.user.openId, learner);

  const persisted = readJsonLines(config.questionsMetadataFile).filter((q) => q.openId === learner);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].question.challengeId, PINNED_ID);
});

test("the learner's make-up score appears on the group 2 lesson 1 board only", async () => {
  const openId = crypto.randomUUID();
  seedAnswer(openId, LEARNER_NAME, 87, PINNED_ID);

  const board = await (await fetch(`${base}/api/game/leaderboard?group=g2&challengeId=${PINNED_ID}`)).json();
  assert.equal(board.challenge.id, PINNED_ID);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].name, LEARNER_NAME);
  assert.equal(board.entries[0].score, 87);

  // The same learner's answer is not counted in group 1's lesson 1 board, and
  // the current week's board is untouched.
  const groupOne = await (await fetch(`${base}/api/game/leaderboard?group=g1&challengeId=weekly-2026-09-28`)).json();
  assert.equal(groupOne.entries.length, 0);
  const currentWeek = await (await fetch(`${base}/api/game/leaderboard?group=g2`)).json();
  assert.equal(currentWeek.entries.length, 0);
});

test("/api/me exposes the make-up flag only to the assigned learner", async () => {
  const assigned = await (await fetch(`${base}/api/me`, { headers: sessionHeaders(LEARNER_NAME) })).json();
  assert.equal(assigned.catchupAccess, true);
  const other = await (await fetch(`${base}/api/me`, { headers: sessionHeaders("陈云") })).json();
  assert.equal(other.catchupAccess, false);
});

test("an enrolled openId wins over the display name once CATCHUP_OPEN_IDS is set", async () => {
  // The environment gate is read once at require time, so the enrolled-openId
  // behaviour is exercised in a child process.
  const { execFileSync } = require("node:child_process");
  const probe = `
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = ${JSON.stringify(data)};
    process.env.SESSION_SECRET = "catchup-openid-probe";
    process.env.CATCHUP_OPEN_IDS = "enrolled-catchup-openid";
    const { testHelpers } = require(${JSON.stringify(path.join(__dirname, "..", "src", "app"))});
    console.log(JSON.stringify({
      renamed: testHelpers.canAccessCatchup({ openId: "someone-else", name: "张鳐", identityType: "dingtalk" }),
      renamedSecond: testHelpers.canAccessCatchup({ openId: "someone-else", name: "吴衍标", identityType: "dingtalk" }),
      enrolled: testHelpers.canAccessCatchup({ openId: "enrolled-catchup-openid", name: "随便", identityType: "dingtalk" }),
      anonymous: testHelpers.canAccessCatchup(null),
    }));
  `;
  const stdout = execFileSync("node", ["-e", probe], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  const verdict = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(verdict.renamed, false, "a renamed profile cannot reach the make-up page");
  assert.equal(verdict.renamedSecond, false, "the second name is not a back door once openIds are enrolled");
  assert.equal(verdict.enrolled, true, "the enrolled openId passes regardless of display name");
  assert.equal(verdict.anonymous, false);
});

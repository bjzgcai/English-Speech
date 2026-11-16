// Catchup Learner joined the course late and still has to answer group 2's lesson 1, which
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
  CATCHUP_NAMES: "Catchup Learner,Admin User",
  TITLE_ABSTRACT_NAMES: "Title Learner,Admin User",
  LAST_WEEK_NAMES: "Last Week Learner,Admin User",
  CATCHUP_OPEN_IDS: "",
  TITLE_ABSTRACT_OPEN_IDS: "",
  LAST_WEEK_OPEN_IDS: "",
});
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine, readJsonLines } = require("../src/storage");
const game = require("../src/game");

const PINNED_ID = "weekly-2026-09-28-g2";
const LEARNER_NAME = "Catchup Learner";
// Admin User plays the same make-up lesson, so the page answers to both names.
const SECOND_LEARNER_NAME = "Admin User";
// The second private page pins group 1's 2026-10-26 paper title/abstract task.
const TITLE_ABSTRACT_ID = "weekly-2026-10-26";
const TITLE_ABSTRACT_NAME = "Title Learner";
// The third private page pins group 1's week of 2026-11-09 (last week).
const LAST_WEEK_ID = "weekly-2026-11-09";
const LAST_WEEK_NAME = "Last Week Learner";

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
      renamed: testHelpers.canAccessCatchup({ openId: "someone-else", name: "Catchup Learner", identityType: "dingtalk" }),
      renamedSecond: testHelpers.canAccessCatchup({ openId: "someone-else", name: "Admin User", identityType: "dingtalk" }),
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

test("a named but unenrolled visitor is denied and logs the openId once", () => {
  const { spawnSync } = require("node:child_process");
  const probe = `
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = ${JSON.stringify(data)};
    process.env.SESSION_SECRET = "catchup-denied-probe";
    process.env.CATCHUP_OPEN_IDS = "enrolled-catchup-openid";
    process.env.CATCHUP_NAMES = "Catchup Learner";
    const { testHelpers } = require(${JSON.stringify(path.join(__dirname, "..", "src", "app"))});
    const user = { openId: "unenrolled-catchup", name: "Catchup Learner", identityType: "dingtalk" };
    console.log(JSON.stringify({
      first: testHelpers.canAccessCatchup(user),
      second: testHelpers.canAccessCatchup(user),
    }));
  `;
  const run = spawnSync("node", ["-e", probe], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  const verdict = JSON.parse(run.stdout.trim().split("\n").pop());
  assert.equal(verdict.first, false, "the name alone never grants access while openIds are enrolled");
  assert.equal(verdict.second, false);
  assert.equal(
    (run.stderr.match(/add openId unenrolled-catchup to CATCHUP_OPEN_IDS/g) || []).length,
    1,
    "the openId is logged once for enrollment",
  );
});

test("the second private page pins group 1's paper title and abstract week", () => {
  const pinned = testHelpers.titleAbstractChallenge;
  assert.equal(pinned.id, TITLE_ABSTRACT_ID);
  assert.equal(pinned.group, "g1");
  assert.equal(pinned.lessonNumber, 4);
  assert.equal(pinned.instructor, "He Yuan");
  assert.equal(pinned.title, "Writing a paper title and abstract for your research project");
  assert.equal(pinned.requiresCamera, true);
  assert.equal(game.matchesChallengeId(pinned, TITLE_ABSTRACT_ID), true);
});

test("the title/abstract page is served to its two learners and redirected for everyone else", async () => {
  const anonymous = await fetch(`${base}/game/title-abstract`, { redirect: "manual" });
  assert.equal(anonymous.status, 200);
  assert.match(await anonymous.text(), /id="gameTopicTitle"/);

  const other = await fetch(`${base}/game/title-abstract`, {
    headers: sessionHeaders("陈云"),
    redirect: "manual",
  });
  assert.equal(other.status, 302);
  assert.equal(other.headers.get("location"), "/leaderboard");

  for (const name of [TITLE_ABSTRACT_NAME, "Admin User"]) {
    const response = await fetch(`${base}/game/title-abstract`, {
      headers: sessionHeaders(name),
      redirect: "manual",
    });
    assert.equal(response.status, 200, name);
  }
});

test("the title/abstract week is gated per page and cannot be crossed", async () => {
  const pinnedQuery = `group=g1&challengeId=${TITLE_ABSTRACT_ID}`;
  assert.equal((await fetch(`${base}/api/game/challenge?${pinnedQuery}`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/game/challenge?${pinnedQuery}`, { headers: sessionHeaders("陈云") })).status,
    403,
  );

  const allowed = await fetch(`${base}/api/game/challenge?${pinnedQuery}`, {
    headers: sessionHeaders(TITLE_ABSTRACT_NAME),
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.challenge.id, TITLE_ABSTRACT_ID);
  assert.equal(payload.group, "g1");
  assert.equal(payload.challenge.title, "Writing a paper title and abstract for your research project");
  assert.deepEqual(payload.challenges.map((challenge) => challenge.id), [TITLE_ABSTRACT_ID]);

  // A learner allowed on the other private page still cannot borrow this week.
  const crossed = await fetch(`${base}/api/game/challenge?${pinnedQuery}`, {
    headers: sessionHeaders(LEARNER_NAME),
  });
  assert.equal(crossed.status, 400);
});

test("the title/abstract learners generate questions only for their pinned week", async () => {
  for (const name of [TITLE_ABSTRACT_NAME, "Admin User"]) {
    const learner = crypto.randomUUID();
    await fetch(`${base}/api/privacy-consent`, {
      method: "POST",
      headers: mutationHeaders(name, learner),
      body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
    });

    const otherWeek = await fetch(`${base}/api/game/question`, {
      method: "POST",
      headers: mutationHeaders(name, learner),
      body: JSON.stringify({ group: "g1", challengeId: "weekly-2026-11-02" }),
    });
    assert.equal(otherWeek.status, 400, `${name}: a different week is rejected`);

    const created = await fetch(`${base}/api/game/question`, {
      method: "POST",
      headers: mutationHeaders(name, learner),
      body: JSON.stringify({ group: "g1", challengeId: TITLE_ABSTRACT_ID }),
    });
    assert.equal(created.status, 201, name);
    const body = await created.json();
    assert.equal(body.challenge.id, TITLE_ABSTRACT_ID);
    assert.equal(body.question.challengeId, TITLE_ABSTRACT_ID);
    assert.equal(body.user.openId, learner);

    const persisted = readJsonLines(config.questionsMetadataFile).filter((q) => q.openId === learner);
    assert.equal(persisted.length, 1, name);
    assert.equal(persisted[0].question.challengeId, TITLE_ABSTRACT_ID);
  }
});

test("the title/abstract scores land on the group 1 2026-10-26 board", async () => {
  const openId = crypto.randomUUID();
  seedAnswer(openId, TITLE_ABSTRACT_NAME, 91, TITLE_ABSTRACT_ID);

  const board = await (await fetch(`${base}/api/game/leaderboard?group=g1&challengeId=${TITLE_ABSTRACT_ID}`)).json();
  assert.equal(board.challenge.id, TITLE_ABSTRACT_ID);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].name, TITLE_ABSTRACT_NAME);
  assert.equal(board.entries[0].score, 91);

  // Group 2's same-calendar-week board is a different task and stays untouched.
  const parallel = await (await fetch(`${base}/api/game/leaderboard?group=g2&challengeId=weekly-2026-10-26-g2`)).json();
  assert.equal(parallel.entries.length, 0);
});

test("/api/me lists only the private pages a session may open", async () => {
  const titleAbstract = await (await fetch(`${base}/api/me`, {
    headers: sessionHeaders(TITLE_ABSTRACT_NAME),
  })).json();
  assert.deepEqual(titleAbstract.privateGameRoutes, ["/game/title-abstract"]);
  assert.equal(titleAbstract.catchupAccess, false);

  const firstLesson = await (await fetch(`${base}/api/me`, {
    headers: sessionHeaders(LEARNER_NAME),
  })).json();
  assert.deepEqual(firstLesson.privateGameRoutes, ["/game/first-lesson"]);
  assert.equal(firstLesson.catchupAccess, true);

  const both = await (await fetch(`${base}/api/me`, {
    headers: sessionHeaders("Admin User"),
  })).json();
  assert.deepEqual(both.privateGameRoutes, [
    "/game/first-lesson",
    "/game/title-abstract",
    "/game/last-week",
  ]);

  const other = await (await fetch(`${base}/api/me`, { headers: sessionHeaders("陈云") })).json();
  assert.deepEqual(other.privateGameRoutes, []);
});

test("TITLE_ABSTRACT_OPEN_IDS replaces the name fallback once set", async () => {
  const { execFileSync } = require("node:child_process");
  const probe = `
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = ${JSON.stringify(data)};
    process.env.SESSION_SECRET = "title-abstract-openid-probe";
    process.env.TITLE_ABSTRACT_OPEN_IDS = "enrolled-title-abstract-openid";
    const { testHelpers } = require(${JSON.stringify(path.join(__dirname, "..", "src", "app"))});
    console.log(JSON.stringify({
      named: testHelpers.canAccessTitleAbstract({ openId: "someone-else", name: "Title Learner", identityType: "dingtalk" }),
      namedSecond: testHelpers.canAccessTitleAbstract({ openId: "someone-else", name: "Admin User", identityType: "dingtalk" }),
      enrolled: testHelpers.canAccessTitleAbstract({ openId: "enrolled-title-abstract-openid", name: "随便", identityType: "dingtalk" }),
      firstLessonGate: testHelpers.canAccessCatchup({ openId: "someone-else", name: "Title Learner", identityType: "dingtalk" }),
    }));
  `;
  const stdout = execFileSync("node", ["-e", probe], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  const verdict = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(verdict.named, false, "a renamed profile cannot reach the title/abstract page");
  assert.equal(verdict.namedSecond, false, "the second name is not a back door once openIds are enrolled");
  assert.equal(verdict.enrolled, true, "the enrolled openId passes regardless of display name");
  assert.equal(verdict.firstLessonGate, false, "the two private pages keep separate allow-lists");
});

test("the last-week page pins group 1's week of 2026-11-09", () => {
  const pinned = testHelpers.lastWeekChallenge;
  assert.equal(pinned.id, LAST_WEEK_ID);
  assert.equal(pinned.group, "g1");
  assert.equal(pinned.lessonNumber, 6);
  assert.equal(pinned.instructor, "Wang Xudong");
  assert.equal(pinned.title, "Explaining an experimental figure");
  assert.equal(pinned.requiresCamera, true);
  assert.equal(game.matchesChallengeId(pinned, LAST_WEEK_ID), true);
});

test("the last-week page is served to Last Week Learner and Admin User only", async () => {
  const anonymous = await fetch(`${base}/game/last-week`, { redirect: "manual" });
  assert.equal(anonymous.status, 200);
  assert.match(await anonymous.text(), /id="gameTopicTitle"/);

  const other = await fetch(`${base}/game/last-week`, {
    headers: sessionHeaders("陈云"),
    redirect: "manual",
  });
  assert.equal(other.status, 302);
  assert.equal(other.headers.get("location"), "/leaderboard");

  for (const name of [LAST_WEEK_NAME, "Admin User"]) {
    const response = await fetch(`${base}/game/last-week`, {
      headers: sessionHeaders(name),
      redirect: "manual",
    });
    assert.equal(response.status, 200, name);
  }
});

test("the last-week challenge is gated, cannot be crossed, and is stored on its own board", async () => {
  const pinnedQuery = `group=g1&challengeId=${LAST_WEEK_ID}`;
  assert.equal((await fetch(`${base}/api/game/challenge?${pinnedQuery}`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/game/challenge?${pinnedQuery}`, { headers: sessionHeaders("陈云") })).status,
    403,
  );

  const allowed = await fetch(`${base}/api/game/challenge?${pinnedQuery}`, {
    headers: sessionHeaders(LAST_WEEK_NAME),
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.challenge.id, LAST_WEEK_ID);
  assert.equal(payload.group, "g1");
  assert.equal(payload.challenge.title, "Explaining an experimental figure");
  assert.deepEqual(payload.challenges.map((challenge) => challenge.id), [LAST_WEEK_ID]);

  // Learners from the other private pages cannot borrow this week.
  for (const name of [LEARNER_NAME, TITLE_ABSTRACT_NAME]) {
    const crossed = await fetch(`${base}/api/game/challenge?${pinnedQuery}`, {
      headers: sessionHeaders(name),
    });
    assert.equal(crossed.status, 400, name);
  }

  const learner = crypto.randomUUID();
  await fetch(`${base}/api/privacy-consent`, {
    method: "POST",
    headers: mutationHeaders(LAST_WEEK_NAME, learner),
    body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
  });

  const wrongWeek = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders(LAST_WEEK_NAME, learner),
    body: JSON.stringify({ group: "g1", challengeId: "weekly-2026-11-16" }),
  });
  assert.equal(wrongWeek.status, 400);

  const created = await fetch(`${base}/api/game/question`, {
    method: "POST",
    headers: mutationHeaders(LAST_WEEK_NAME, learner),
    body: JSON.stringify({ group: "g1", challengeId: LAST_WEEK_ID }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.challenge.id, LAST_WEEK_ID);
  assert.equal(body.question.challengeId, LAST_WEEK_ID);
  assert.equal(body.user.openId, learner);

  const persisted = readJsonLines(config.questionsMetadataFile).filter((q) => q.openId === learner);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].question.challengeId, LAST_WEEK_ID);

  seedAnswer(learner, LAST_WEEK_NAME, 84, LAST_WEEK_ID);
  const board = await (await fetch(`${base}/api/game/leaderboard?group=g1&challengeId=${LAST_WEEK_ID}`)).json();
  assert.equal(board.challenge.id, LAST_WEEK_ID);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].name, LAST_WEEK_NAME);
  assert.equal(board.entries[0].score, 84);
});

test("LAST_WEEK_OPEN_IDS replaces the name fallback once set", async () => {
  const { execFileSync } = require("node:child_process");
  const probe = `
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = ${JSON.stringify(data)};
    process.env.SESSION_SECRET = "last-week-openid-probe";
    process.env.LAST_WEEK_OPEN_IDS = "enrolled-last-week-openid";
    const { testHelpers } = require(${JSON.stringify(path.join(__dirname, "..", "src", "app"))});
    console.log(JSON.stringify({
      named: testHelpers.canAccessLastWeek({ openId: "someone-else", name: "Last Week Learner", identityType: "dingtalk" }),
      namedSecond: testHelpers.canAccessLastWeek({ openId: "someone-else", name: "Admin User", identityType: "dingtalk" }),
      enrolled: testHelpers.canAccessLastWeek({ openId: "enrolled-last-week-openid", name: "随便", identityType: "dingtalk" }),
      titleAbstractGate: testHelpers.canAccessTitleAbstract({ openId: "someone-else", name: "Last Week Learner", identityType: "dingtalk" }),
    }));
  `;
  const stdout = execFileSync("node", ["-e", probe], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  const verdict = JSON.parse(stdout.trim().split("\n").pop());
  assert.equal(verdict.named, false, "a renamed profile cannot reach the last-week page");
  assert.equal(verdict.namedSecond, false, "the second name is not a back door once openIds are enrolled");
  assert.equal(verdict.enrolled, true, "the enrolled openId passes regardless of display name");
  assert.equal(verdict.titleAbstractGate, false, "each private page keeps its own allow-list");
});

const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-teacher-"));
Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: data, QUEUE_ENABLED: "false",
  SESSION_SECRET: "teacher-test-session", DINGTALK_CLIENT_ID: "test", DINGTALK_CLIENT_SECRET: "test",
  DINGTALK_CORP_ID: "test", DINGTALK_ALERT_ROBOT_CODE: "", DINGTALK_ALERT_USER_ID: "" });
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine } = require("../src/storage");
const game = require("../src/game");

let server, base;
test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(data, { recursive: true, force: true });
});

function sessionHeaders(name, openId = crypto.randomUUID()) {
  return { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId, name })}` };
}

function seedAnswer(openId, name, score, { answerId = crypto.randomUUID(), finishedAt = "2026-10-01T09:00:00.000Z", challengeId = null, filename = "answer.mp4" } = {}) {
  // The board serves the challenge that is current when the test runs.
  const challenge = game.currentChallenge(new Date(), "g1");
  const record = {
    id: answerId,
    openId,
    user: { openId, name, identityType: "dingtalk" },
    filename,
    finishedAt,
    question: { challengeId: challengeId || challenge.id, question: "A weekly question" },
    evaluation: { status: "completed", overallScore: score, transcript: "Hello everyone." },
  };
  appendJsonLine(config.metadataFile, record);
  // The media/transcript endpoints only resolve recordings that exist on disk.
  fs.writeFileSync(path.join(config.recordingsDir, filename), "video");
  return record;
}

test("the teacher page and APIs are allow-listed", async () => {
  const answerId = crypto.randomUUID();
  seedAnswer("student-1", "李雷", 88, { answerId });

  // Anonymous and non-listed visitors cannot even see the page.
  assert.equal((await fetch(base + "/teacher", { redirect: "manual" })).status, 302);
  assert.equal((await fetch(base + "/teacher", { headers: sessionHeaders("陈云"), redirect: "manual" })).status, 302);
  // Whitelisted names get the console.
  for (const name of ["王旭东", "邹欣", "吴衍标", "高坤", "柳君丽", "胡辰", "何源", "董圣娇", "赵晨"]) {
    const response = await fetch(base + "/teacher", { headers: sessionHeaders(name), redirect: "manual" });
    assert.equal(response.status, 200, name);
  }

  // API: 401 anonymous, 403 non-teacher, 200 teacher with playback fields.
  const teacher = sessionHeaders("王旭东");
  assert.equal((await fetch(base + "/api/teacher/leaderboard")).status, 401);
  const denied = await fetch(base + "/api/teacher/leaderboard", { headers: sessionHeaders("陈云") });
  assert.equal(denied.status, 403);

  const boardResponse = await fetch(base + "/api/teacher/leaderboard?group=g1", { headers: teacher });
  assert.equal(boardResponse.status, 200);
  const board = await boardResponse.json();
  assert.equal(board.group, "g1");
  assert.ok(Array.isArray(board.challenges) && board.challenges.length > 0);
  const entry = board.entries.find((item) => item.name === "李雷");
  assert.ok(entry, "the seeded student appears on the teacher board");
  assert.equal(entry.answerId, answerId);
  assert.equal(typeof entry.mediaType, "string");
  assert.equal(entry.finishedAt, "2026-10-01T09:00:00.000Z");
  assert.equal(entry.aiSuspicious.state, "pending", "an unanalyzed answer reports a pending verdict");

  // The public board never carries playback fields, even for a teacher.
  const publicBoard = await (await fetch(base + "/api/game/leaderboard?group=g1", { headers: teacher })).json();
  for (const item of publicBoard.entries) {
    assert.equal(item.answerId, undefined);
    assert.equal(item.mediaType, undefined);
  }

  // Media/transcript endpoints: teacher passes, others 403.
  assert.equal((await fetch(base + "/api/game/leaderboard-answers/" + answerId + "/media", { headers: sessionHeaders("陈云") })).status, 403);
  const transcript = await fetch(base + "/api/game/leaderboard-answers/" + answerId + "/transcript", { headers: teacher });
  assert.equal(transcript.status, 200);
  assert.equal((await transcript.json()).transcript, "Hello everyone.");

  // /api/me exposes the menu flag only for whitelisted names.
  const me = await (await fetch(base + "/api/me", { headers: teacher })).json();
  assert.equal(me.teacherAccess, true);
  const outsider = await (await fetch(base + "/api/me", { headers: sessionHeaders("陈云") })).json();
  assert.equal(outsider.teacherAccess, false);
});

test("the invitation-code guest may enter the teacher console", async () => {
  const code = "B19B59975BC0";
  appendJsonLine(config.invitationsMetadataFile, {
    id: crypto.randomUUID(),
    code,
    hash: crypto.createHash("sha256").update(code).digest("hex"),
    inviterOpenId: "inviter-1",
    usedBy: null,
    usedAt: null,
  });
  const redeem = await fetch(base + "/api/invitation/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "Co-Teacher" }),
  });
  assert.equal(redeem.status, 200);
  const cookie = redeem.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const guestHeaders = { Cookie: cookie };

  assert.equal((await fetch(base + "/teacher", { headers: guestHeaders, redirect: "manual" })).status, 200);
  const board = await fetch(base + "/api/teacher/leaderboard?group=g1", { headers: guestHeaders });
  assert.equal(board.status, 200);
  const me = await (await fetch(base + "/api/me", { headers: guestHeaders })).json();
  assert.equal(me.teacherAccess, true);
});

test("teachers can export the selected week and everything as CSV", async () => {
  seedAnswer("student-2", "韩梅梅", 92, { challengeId: null });
  const teacher = sessionHeaders("董圣娇");

  // Partition export: current week + group.
  const week = await fetch(base + "/api/teacher/export?group=g1", { headers: teacher });
  assert.equal(week.status, 200);
  assert.match(week.headers.get("Content-Type"), /text\/csv/);
  assert.match(week.headers.get("Content-Disposition"), /^attachment; filename="teacher-export-.*\.csv"$/);
  // Response.text() strips a leading UTF-8 BOM while decoding, so check raw bytes.
  const raw = Buffer.from(await week.arrayBuffer());
  assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], "the CSV opens with a UTF-8 BOM");
  const csv = raw.toString("utf8").replace(/^\uFEFF/, "");
  const lines = csv.trim().split(/\r\n/);
  assert.equal(lines[0], "Rank,Name,Score,Attempts,FinishedAt,Group,Week,AI-suspicious");
  const studentRow = lines.find(line => line.includes("韩梅梅"));
  assert.ok(studentRow, "the seeded student row exists");
  assert.match(studentRow, /^\d+,韩梅梅,92,1,/);

  // Non-teachers cannot export.
  assert.equal((await fetch(base + "/api/teacher/export?group=g1", { headers: sessionHeaders("陈云") })).status, 403);
  assert.equal((await fetch(base + "/api/teacher/export-all", { headers: sessionHeaders("陈云") })).status, 403);

  // Export-all covers both groups' boards with entries.
  const all = await fetch(base + "/api/teacher/export-all", { headers: teacher });
  assert.equal(all.status, 200);
  const allCsv = (await all.text()).replace(/^\uFEFF/, "");
  const allLines = allCsv.trim().split(/\r\n/);
  assert.equal(allLines[0], "Rank,Name,Score,Attempts,FinishedAt,Group,Week,AI-suspicious");
  assert.ok(allLines.some(line => line.includes("韩梅梅")), "export-all includes the g1 student");
});

test("a completed AI verdict marks the entry suspicious and flows into the CSV", async () => {
  const answerId = crypto.randomUUID();
  seedAnswer("student-3", "王小明", 76, { answerId });
  appendJsonLine(config.aiDetectionsFile, {
    id: answerId,
    state: "completed",
    attempts: 1,
    suspicious: true,
    confidence: 87,
    reason: "No fillers, perfectly steady rate, and frames show a TTS overlay.",
    completedAt: new Date().toISOString(),
  });

  const teacher = sessionHeaders("王旭东");
  const board = await (await fetch(base + "/api/teacher/leaderboard?group=g1", { headers: teacher })).json();
  const entry = board.entries.find((item) => item.name === "王小明");
  assert.equal(entry.aiSuspicious.state, "completed");
  assert.equal(entry.aiSuspicious.suspicious, true);
  assert.equal(entry.aiSuspicious.confidence, 87);

  const csv = await (await fetch(base + "/api/teacher/export?group=g1", { headers: teacher })).text();
  const row = csv.split(/\r\n/).find(line => line.includes("王小明"));
  assert.ok(row && /,yes$/.test(row), "the suspicious answer is flagged in the CSV");
});

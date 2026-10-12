const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";

const { testHelpers } = require("../src/app");

const { leaderboardAnswerMedia, canViewLeaderboardPlayback } = testHelpers;

function seedRecordings() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-board-media-"));
  const recordingsPath = path.join(tempDir, "recordings");
  fs.mkdirSync(recordingsPath);
  fs.writeFileSync(path.join(recordingsPath, "answer.mp4"), "video");
  fs.writeFileSync(path.join(recordingsPath, "audio.mp3"), "audio");
  return { tempDir, recordingsPath };
}

const completedGameAnswer = (overrides = {}) => ({
  id: "777c2d86-6d44-4d8b-ab1c-b823529ca1b5",
  openId: "user-1",
  filename: "answer.mp4",
  question: { challengeId: "weekly-2026-09-28", question: "Introduce yourself." },
  evaluation: { status: "completed", overallScore: 88, transcript: "Hello everyone." },
  finishedAt: "2026-10-01T09:00:00.000Z",
  ...overrides,
});

test("leaderboard answer media resolves completed challenge answers", () => {
  const { tempDir, recordingsPath } = seedRecordings();
  try {
    const media = leaderboardAnswerMedia(
      [completedGameAnswer()],
      "777c2d86-6d44-4d8b-ab1c-b823529ca1b5",
      recordingsPath,
    );
    assert.ok(media);
    assert.equal(media.mediaType, "video");
    assert.equal(media.mimeType, "video/mp4");
    assert.equal(media.filePath, path.join(recordingsPath, "answer.mp4"));
    assert.equal(media.record.evaluation.transcript, "Hello everyone.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("leaderboard answer media distinguishes audio-only answers", () => {
  const { tempDir, recordingsPath } = seedRecordings();
  try {
    const media = leaderboardAnswerMedia(
      [completedGameAnswer({ filename: "audio.mp3" })],
      "777c2d86-6d44-4d8b-ab1c-b823529ca1b5",
      recordingsPath,
    );
    assert.ok(media);
    assert.equal(media.mediaType, "audio");
    assert.equal(media.mimeType, "audio/mpeg");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("leaderboard answer media rejects answers outside the weekly challenge", () => {
  const { tempDir, recordingsPath } = seedRecordings();
  try {
    // Examine/practice answers have no challengeId and must not be playable.
    assert.equal(
      leaderboardAnswerMedia([completedGameAnswer({ question: { question: "Examine" } })],
        "777c2d86-6d44-4d8b-ab1c-b823529ca1b5", recordingsPath),
      null,
    );
    assert.equal(
      leaderboardAnswerMedia([completedGameAnswer({ evaluation: { status: "failed" } })],
        "777c2d86-6d44-4d8b-ab1c-b823529ca1b5", recordingsPath),
      null,
    );
    assert.equal(
      leaderboardAnswerMedia([completedGameAnswer({ filename: "../recordings/answer.mp4" })],
        "777c2d86-6d44-4d8b-ab1c-b823529ca1b5", recordingsPath),
      null,
    );
    assert.equal(
      leaderboardAnswerMedia([completedGameAnswer({ filename: "missing.mp4" })],
        "777c2d86-6d44-4d8b-ab1c-b823529ca1b5", recordingsPath),
      null,
    );
    assert.equal(leaderboardAnswerMedia([], "not-a-record", recordingsPath), null);
    assert.equal(leaderboardAnswerMedia([], "", recordingsPath), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("leaderboard playback is limited to the allow-listed DingTalk names", () => {
  const dingtalk = (name) => ({ openId: "user-1", name, identityType: "dingtalk" });

  for (const name of ["王旭东", "邹欣", "吴衍标", "高坤", "柳君丽", "胡辰", "何源"]) {
    assert.equal(canViewLeaderboardPlayback(dingtalk(name)), true, name);
  }
  // Whitespace around the session name is tolerated; near-misses are not.
  assert.equal(canViewLeaderboardPlayback(dingtalk(" 王旭东 ")), true);
  assert.equal(canViewLeaderboardPlayback(dingtalk("王旭 东")), false);

  assert.equal(canViewLeaderboardPlayback(dingtalk("陈云")), false);
  assert.equal(canViewLeaderboardPlayback(dingtalk("")), false);
  assert.equal(canViewLeaderboardPlayback(null), false);
  assert.equal(canViewLeaderboardPlayback({ openId: "guest:0f4a2f2e-6d44-4d8b-ab1c-b823529ca1b5", name: "王旭东", identityType: "guest" }), false);
});

test("guests who redeemed an allow-listed invitation code may watch", () => {
  const guest = (openId) => ({ openId, identityType: "guest", name: "Guest 12345678" });
  const openId = "guest:0f4a2f2e-6d44-4d8b-ab1c-b823529ca1b5";

  assert.equal(canViewLeaderboardPlayback(guest(openId), "B19B59975BC0"), true);
  // Case-insensitive against the configured code; wrong codes stay denied.
  assert.equal(canViewLeaderboardPlayback(guest(openId), "b19b59975bc0"), true);
  assert.equal(canViewLeaderboardPlayback(guest(openId), "B19B59975BC1"), false);
  assert.equal(canViewLeaderboardPlayback(guest(openId), ""), false);
});

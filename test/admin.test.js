const { listenForTest } = require("../scripts/test-http");
const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "admin-test-session-secret";
process.env.DINGTALK_APP_KEY = "admin-test-app-key";
process.env.DINGTALK_APP_SECRET = "admin-test-app-secret";
process.env.ADMIN_ACCESS_TOKEN = "admin-test-access-token-with-sufficient-entropy";

const { buildAdminStatistics } = require("../src/admin-statistics");
const { app, testHelpers } = require("../src/app");

function gameRecord({
  openId,
  challengeId,
  challengeTitle,
  startsAt,
  createdAt,
  finishedAt,
  status,
  score,
}) {
  return {
    openId,
    createdAt,
    finishedAt,
    bytes: 1024,
    question: {
      challengeId,
      challengeTitle,
      challengeStartsAt: startsAt,
    },
    evaluation: {
      status,
      overallScore: score,
    },
  };
}

test("admin statistics distinguish entrants, submitters, scored users, and repeat players", () => {
  const firstWeek = {
    id: "weekly-2026-07-22",
    title: "First weekly topic",
    startsAt: "2026-07-21T16:00:00.000Z",
    endsAt: "2026-07-28T16:00:00.000Z",
  };
  const currentWeek = {
    id: "weekly-2026-07-29",
    title: "Current weekly topic",
    startsAt: "2026-07-28T16:00:00.000Z",
    endsAt: "2026-08-04T16:00:00.000Z",
  };
  const question = (openId, challenge, createdAt) =>
    gameRecord({
      openId,
      challengeId: challenge.id,
      challengeTitle: challenge.title,
      startsAt: challenge.startsAt,
      createdAt,
    });
  const questions = [
    question("player-a", firstWeek, "2026-07-23T02:00:00.000Z"),
    question("player-b", firstWeek, "2026-07-23T03:00:00.000Z"),
    question("player-a", currentWeek, "2026-07-29T02:00:00.000Z"),
    question("player-c", currentWeek, "2026-07-29T03:00:00.000Z"),
  ];
  const recordings = [
    gameRecord({
      openId: "player-a",
      challengeId: firstWeek.id,
      challengeTitle: firstWeek.title,
      startsAt: firstWeek.startsAt,
      finishedAt: "2026-07-23T04:00:00.000Z",
      status: "completed",
      score: 80,
    }),
    gameRecord({
      openId: "player-a",
      challengeId: firstWeek.id,
      challengeTitle: firstWeek.title,
      startsAt: firstWeek.startsAt,
      finishedAt: "2026-07-24T04:00:00.000Z",
      status: "completed",
      score: 90,
    }),
    gameRecord({
      openId: "player-b",
      challengeId: firstWeek.id,
      challengeTitle: firstWeek.title,
      startsAt: firstWeek.startsAt,
      finishedAt: "2026-07-24T05:00:00.000Z",
      status: "failed",
    }),
    gameRecord({
      openId: "player-a",
      challengeId: currentWeek.id,
      challengeTitle: currentWeek.title,
      startsAt: currentWeek.startsAt,
      finishedAt: "2026-07-29T04:00:00.000Z",
      status: "completed",
      score: 70,
    }),
    gameRecord({
      openId: "player-c",
      challengeId: currentWeek.id,
      challengeTitle: currentWeek.title,
      startsAt: currentWeek.startsAt,
      finishedAt: "2026-07-29T05:00:00.000Z",
      status: "skipped",
    }),
  ];

  const statistics = buildAdminStatistics({
    questions,
    recordings,
    currentChallenge: currentWeek,
    now: new Date("2026-07-30T04:00:00.000Z"),
  });

  assert.deepEqual(statistics.overview, {
    allTimeEntrants: 3,
    allTimeSubmitters: 3,
    currentWeekEntrants: 2,
    currentWeekSubmitters: 2,
    currentWeekScoredParticipants: 1,
    currentWeekAttempts: 2,
    currentWeekAverageBestScore: 70,
    totalGameAttempts: 5,
    completedGameAttempts: 3,
    gameCompletionRate: 60,
    repeatParticipants: 1,
    entrantsWithoutSubmission: 0,
    storedMediaFiles: 5,
    totalStoredBytes: 5120,
  });
  assert.equal(statistics.weeklyBreakdown[0].challengeId, currentWeek.id);
  assert.equal(statistics.weeklyBreakdown[0].averageBestScore, 70);
  assert.equal(statistics.weeklyBreakdown[1].averageBestScore, 90);
  assert.equal(
    statistics.currentWeekScoreBands.find((band) => band.key === "competent").count,
    1,
  );
  assert.equal(statistics.dailyActivity.length, 14);
});

test("admin page requires DingTalk sign-in and remains outside the main app menu", async (context) => {
  const server = await listenForTest(app);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const signedOut = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  assert.equal(signedOut.status, 302);
  assert.equal(
    new URL(signedOut.headers.get("location"), baseUrl).searchParams.get("redirect"),
    "/admin",
  );

  const session = testHelpers.createSessionToken({
    openId: "admin-page-reader",
    name: "Admin Page Reader",
  });
  const signedIn = await fetch(`${baseUrl}/admin`, {
    headers: { Cookie: `englisheval_session=${session}` },
  });
  assert.equal(signedIn.status, 200);
  const page = await signedIn.text();
  assert.match(page, /Admin access token/);
  assert.doesNotMatch(page, /class="main-nav"/);
});

test("admin statistics API requires both DingTalk session and the separate access token", async (context) => {
  const server = await listenForTest(app);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = testHelpers.createSessionToken({
    openId: "admin-statistics-reader",
    name: "Admin Statistics Reader",
  });
  const sessionHeaders = { Cookie: `englisheval_session=${session}` };

  const signedOut = await fetch(`${baseUrl}/api/admin/statistics`);
  assert.equal(signedOut.status, 401);

  const missingToken = await fetch(`${baseUrl}/api/admin/statistics`, {
    headers: sessionHeaders,
  });
  assert.equal(missingToken.status, 403);

  const wrongToken = await fetch(`${baseUrl}/api/admin/statistics`, {
    headers: { ...sessionHeaders, "x-admin-access-token": "wrong-token" },
  });
  assert.equal(wrongToken.status, 403);

  const accepted = await fetch(`${baseUrl}/api/admin/statistics`, {
    headers: {
      ...sessionHeaders,
      "x-admin-access-token": process.env.ADMIN_ACCESS_TOKEN,
    },
  });
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(typeof body.statistics.overview.allTimeEntrants, "number");
  assert.equal(accepted.headers.get("cache-control"), "no-store");
});
